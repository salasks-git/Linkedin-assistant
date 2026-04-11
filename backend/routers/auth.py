import os
import datetime
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
import models
import schemas
from database import get_db
from utils.auth import get_password_hash, verify_password, get_current_session
from utils.encryption import encrypt_token, decrypt_token
from services.linkedin_service import linkedin_svc

router = APIRouter(prefix="/auth", tags=["auth"])

@router.get("/check")
async def check_auth(db: Session = Depends(get_db), request: Request = None):
    session_id = request.cookies.get("session_id")
    if not session_id:
        return {"status": "unauthenticated"}
        
    sess = db.query(models.Session).filter(models.Session.session_id == session_id).first()
    if not sess or sess.expires_at < datetime.datetime.utcnow():
        return {"status": "unauthenticated"}
    
    user = db.query(models.User).filter(models.User.id == sess.user_id).first() if sess.user_id else None
    
    has_linkedin = False
    if user and user.encrypted_token:
        try:
            token = decrypt_token(user.encrypted_token)
            await linkedin_svc.get_user_urn(token)
            has_linkedin = True
        except Exception as e:
            if "LINKEDIN_UNAUTHORIZED" in str(e):
                user.encrypted_token = None
                user.linkedin_user_id = None
                db.commit()
            else:
                has_linkedin = True

    return {
        "status": "authenticated", 
        "user": {
            "username": user.username if user else None,
            "name": user.name if user else None,
            "has_linkedin": has_linkedin
        } if user else None
    }

@router.post("/signup")
def signup(payload: schemas.UserSignup, db: Session = Depends(get_db)):
    if len(payload.password) < 6 or not any(c.isalpha() for c in payload.password) or not any(c.isdigit() for c in payload.password):
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters and include both letters and numbers.")
    
    username_lower = payload.username.lower()
    existing = db.query(models.User).filter(models.User.username == username_lower).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    new_user = models.User(
        username=username_lower,
        hashed_password=get_password_hash(payload.password)
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"status": "success", "message": "User created successfully."}

@router.post("/login")
def login(request: Request, response: Response, payload: schemas.UserLogin, db: Session = Depends(get_db)):
    username_lower = payload.username.lower()
    user = db.query(models.User).filter(models.User.username == username_lower).first()
    
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    expires = datetime.datetime.utcnow() + datetime.timedelta(days=7)
    new_session = models.Session(user_id=user.id, expires_at=expires)
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    
    response.set_cookie(
        key="session_id", 
        value=new_session.session_id, 
        httponly=True, 
        max_age=7*24*60*60, 
        samesite='lax',
        path="/"
    )
    return {"status": "success", "username": user.username, "name": user.name}

@router.post("/logout")
def logout(response: Response):
    response.delete_cookie("session_id", path="/")
    return {"status": "logged out"}

@router.get("/linkedin")
def linkedin_login():
    client_id = os.getenv("LINKEDIN_CLIENT_ID")
    redirect_uri = os.getenv("LINKEDIN_REDIRECT_URI", "http://localhost:8000/auth/linkedin/callback")
    if not client_id:
        raise HTTPException(status_code=500, detail="LinkedIn Client ID not configured")
    
    scope = "w_member_social profile openid email"
    auth_url = f"https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id={client_id}&redirect_uri={redirect_uri}&scope={scope}"
    return RedirectResponse(auth_url)

@router.get("/linkedin/callback")
async def linkedin_callback(code: str, request: Request, db: Session = Depends(get_db), session: models.Session = Depends(get_current_session)):
    client_id = os.getenv("LINKEDIN_CLIENT_ID")
    client_secret = os.getenv("LINKEDIN_CLIENT_SECRET")
    redirect_uri = os.getenv("LINKEDIN_REDIRECT_URI", "http://localhost:8000/auth/linkedin/callback")
    
    if not all([client_id, client_secret]):
        raise HTTPException(status_code=500, detail="LinkedIn credentials not configured")

    async with httpx.AsyncClient() as client:
        token_response = await client.post(
            "https://www.linkedin.com/oauth/v2/accessToken",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
        if token_response.status_code != 200:
            raise HTTPException(status_code=400, detail="Failed to retrieve token")
        
        token_data = token_response.json()
        access_token = token_data.get("access_token")
        
        urn_response = await client.get(
            "https://api.linkedin.com/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"}
        )
        urn_response.raise_for_status()
        urn_data = urn_response.json()
        linkedin_user_id = urn_data.get("sub")
        name = urn_data.get("name")
        
    encrypted = encrypt_token(access_token)
    expiry = datetime.datetime.utcnow() + datetime.timedelta(days=60)
    
    existing_associates = db.query(models.User).filter(
        models.User.linkedin_user_id == linkedin_user_id
    ).all()
    
    for assoc in existing_associates:
        if assoc.id != session.user_id:
            if not assoc.username:
                db.delete(assoc)
            else:
                assoc.linkedin_user_id = None
                assoc.encrypted_token = None
    
    db.commit()

    user = db.query(models.User).filter(models.User.id == session.user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
        
    user.linkedin_user_id = linkedin_user_id
    user.encrypted_token = encrypted
    user.name = name
    user.token_expires_at = expiry
    db.commit()

    return RedirectResponse(url="/")
