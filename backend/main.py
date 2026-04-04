from fastapi import FastAPI, Depends, HTTPException, Body, File, Form, UploadFile, Header, Request, Response
from fastapi.responses import StreamingResponse, RedirectResponse
import os
from dotenv import set_key, load_dotenv

# Load environment variables IMMEDIATELY — before local modules like database/models are imported
load_dotenv()

from typing import List, Optional
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text
import models, schemas, database
from database import engine, get_db
from services import ai_service
from services.prompts import PROMPTS
from services.linkedin_service import linkedin_svc
from utils.encryption import encrypt_token, decrypt_token
import re

import httpx
import datetime
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from fastapi.staticfiles import StaticFiles
import uuid
import json
import bcrypt

def get_password_hash(password: str) -> str:
    """Hashes a password with a fresh salt."""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plain password against its hash."""
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False

# Create database tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="LinkedIn Assistant API")

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

def get_current_session(request: Request, db: Session = Depends(get_db)):
    session_id = request.cookies.get("session_id")
    if not session_id:
        raise HTTPException(status_code=401, detail="Unauthorized: No session cookie")
    
    sess = db.query(models.Session).filter(models.Session.session_id == session_id).first()
    if not sess or sess.expires_at < datetime.datetime.utcnow():
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    
    return sess

def get_current_user_token(session: models.Session = Depends(get_current_session), db: Session = Depends(get_db)):
    if not session.user_id:
        raise HTTPException(status_code=401, detail="No LinkedIn User connected to this session. Please connect your LinkedIn account.")
    usr = db.query(models.User).filter(models.User.id == session.user_id).first()
    if not usr:
        raise HTTPException(status_code=401, detail="User not found")
    return decrypt_token(usr.encrypted_token)

import os

# Create database tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="LinkedIn Assistant API")

# Mount uploads for static access
if not os.path.exists("uploads"):
    os.makedirs("uploads")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# Frontend directory resolution
frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

@app.get("/posts/prompts")
def get_prompts():
    """Returns the list of available prompt keys."""
    return {"prompts": list(PROMPTS.keys())}

@app.post("/posts/", response_model=schemas.Post)
async def create_post(
    content: str = Form(...),
    images: Optional[List[UploadFile]] = File(None),
    db: Session = Depends(get_db),
    session: models.Session = Depends(get_current_session)
):
    image_filenames = []
    if images:
        for img in images:
            if img.filename:
                ext = os.path.splitext(img.filename)[1]
                filename = f"{uuid.uuid4()}{ext}"
                filepath = os.path.join("uploads", filename)
                with open(filepath, "wb") as f:
                    f.write(await img.read())
                image_filenames.append(filename)
    
    db_post = models.Post(
        user_id=session.user_id,
        content=content, 
        status="draft",
        image_paths=json.dumps(image_filenames) if image_filenames else None
    )
    db.add(db_post)
    db.commit()
    db.refresh(db_post)
    
    # Manually populate image_urls for response
    post_dict = schemas.Post.model_validate(db_post)
    post_dict.image_urls = [f"/uploads/{f}" for f in image_filenames]
    return post_dict

@app.get("/posts/", response_model=list[schemas.Post])
def get_posts(db: Session = Depends(get_db), session: models.Session = Depends(get_current_session)):
    # Only return posts belonging to the logged-in user
    posts = db.query(models.Post).filter(models.Post.user_id == session.user_id).all()
    results = []
    for p in posts:
        post_obj = schemas.Post.model_validate(p)
        if p.image_paths:
            filenames = json.loads(p.image_paths)
            post_obj.image_urls = [f"/uploads/{f}" for f in filenames]
        else:
            post_obj.image_urls = []
        results.append(post_obj)
    return results

@app.post("/posts/extract-metadata")
async def extract_metadata(payload: dict = Body(...)):
    """Extract metadata roles from description text."""
    text = payload.get("text", "")
    if not text:
        return {}
    return await ai_service.extract_metadata(text)

@app.post("/posts/refine")
async def refine_post(request: schemas.AIRefineRequest):
    """Refine an existing draft based on user instruction."""
    return StreamingResponse(
        ai_service.refine_linkedin_draft(request.current_content, request.instruction),
        media_type="text/plain"
    )

@app.post("/posts/generate")
async def generate_post(request: schemas.AIDraftRequest):
    # Extract metadata for student-style prompts
    metadata = {
        "resource_persons": request.resource_persons,
        "coordinators": request.coordinators,
        "mentors": request.mentors,
        "tone": request.tone
    }
    
    return StreamingResponse(
        ai_service.generate_linkedin_draft(
            request.topic, 
            request.tone, 
            request.prompt_type,
            metadata=metadata
        ),
        media_type="text/plain"
    )

@app.post("/posts/preview", response_model=schemas.PostPreview)
def preview_post(post: schemas.PostBase):
    content = post.content
    count = len(content)
    hashtags = re.findall(r"#\w+", content)
    
    # RTCFR logic: check if it starts with a hook (question or strong statement)
    has_hook = content.strip().endswith('?') or any(content.split('\n')[0].lower().startswith(x) for x in ['why', 'how', 'when', 'if', 'the'])
    
    is_compliant = count < 3000 and len(hashtags) >= 1
    
    recommendation = "Great post! Good hook and length."
    if count > 2800:
        recommendation = "Warning: Approaching 3000 character limit."
    elif len(hashtags) < 3:
        recommendation = "Consider adding 2-3 niche hashtags to increase reach."
        
    return {
        "content": content,
        "character_count": count,
        "has_hashtags": len(hashtags) > 0,
        "suggested_hashtags": ["#marketing", "#saas", "#careers", "#ai"],
        "is_rtcfr_compliant": is_compliant,
        "recommendation": recommendation
    }

@app.post("/posts/{post_id}/publish", response_model=schemas.Post)
async def publish_post(post_id: int, request: Request, db: Session = Depends(get_db), session: models.Session = Depends(get_current_session), token: str = Depends(get_current_user_token)):
    post = db.query(models.Post).filter(models.Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    try:
        # Load images from local uploads if they exist
        images_to_upload = []
        if post.image_paths:
            filenames = json.loads(post.image_paths)
            for fname in filenames:
                path = os.path.join("uploads", fname)
                if os.path.exists(path):
                    # We create a dummy UploadFile-like object for the service
                    with open(path, "rb") as f:
                        content = f.read()
                        from io import BytesIO
                        # Create a wrapper that matches UploadFile enough for our service
                        class MockUploadFile:
                            def __init__(self, name, data):
                                self.filename = name
                                self.data = data
                            async def read(self):
                                return self.data
                        
                        images_to_upload.append(MockUploadFile(fname, content))

        result = await linkedin_svc.publish_post(post.content, images=images_to_upload, token=token)
        post.status = "posted"
        post.linkedin_post_id = result.get("post_urn", "unknown")
        db.commit()
        db.refresh(post)
        return post
    except Exception as e:
        if "LINKEDIN_UNAUTHORIZED" in str(e):
            # Token is invalid, clear it
            usr = db.query(models.User).filter(models.User.id == session.user_id).first()
            if usr:
                usr.encrypted_token = None
                usr.linkedin_user_id = None
                db.commit()
        print(f"ERROR: LinkedIn Publish Failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/posts/{post_id}")
def delete_post(post_id: int, db: Session = Depends(get_db)):
    post = db.query(models.Post).filter(models.Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Clean up files from disk
    if post.image_paths:
        try:
            filenames = json.loads(post.image_paths)
            for fname in filenames:
                path = os.path.join("uploads", fname)
                if os.path.exists(path):
                    os.remove(path)
        except Exception as e:
            print(f"ERROR deleting files for post {post_id}: {e}")
            
    db.delete(post)
    db.commit()
    return {"status": "success", "message": "Post and associated files deleted"}

@app.post("/posts/publish-direct")
async def publish_direct(
    request: Request,
    text: str = Form(...),
    images: Optional[List[UploadFile]] = File(None),
    token: str = Depends(get_current_user_token),
    session: models.Session = Depends(get_current_session),
    db: Session = Depends(get_db)
):
    """Directly publish a post to LinkedIn with optional images."""
    try:
        print(f"DEBUG: Publishing to LinkedIn: Text length {len(text)}, Images: {len(images) if images else 0}")
        result = await linkedin_svc.publish_post(text, images, token=token)
        return {"status": "success", "result": result}
    except Exception as e:
        if "LINKEDIN_UNAUTHORIZED" in str(e):
            # Token is invalid, clear it
            usr = db.query(models.User).filter(models.User.id == session.user_id).first()
            if usr:
                usr.encrypted_token = None
                usr.linkedin_user_id = None
                db.commit()
        print(f"ERROR: LinkedIn Publish Failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# Admin Control Panel APIs
# ==========================================
# Credentials loaded from .env — never hardcoded in source
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "changeme")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "changeme_token")

def verify_admin(x_admin_token: str = Header(...)):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")

@app.post("/admin/login")
def admin_login(login: schemas.AdminLogin):
    if login.password == ADMIN_PASSWORD:
        return {"token": ADMIN_TOKEN}
    raise HTTPException(status_code=401, detail="Invalid password")

@app.get("/admin/status")
def admin_status(token: str = Depends(verify_admin), db: Session = Depends(get_db)):
    # Check DB — use sqlalchemy.text() to avoid deprecation warning
    try:
        db.execute(text("SELECT 1"))
        db_status = "🟢 Online"
    except:
        db_status = "🔴 Offline"
        
    google_key = os.getenv("GOOGLE_API_KEY")
    linkedin_key = os.getenv("LINKEDIN_ACCESS_TOKEN")
    
    # Collect LinkedIn Health status for all connected users
    members_health = []
    users = db.query(models.User).filter(models.User.encrypted_token != None).all()
    
    now = datetime.datetime.utcnow()
    for u in users:
        days_left = None
        status = "🔴 Expired"
        if u.token_expires_at:
            delta = u.token_expires_at - now
            days_left = max(0, delta.days)
            if days_left > 0:
                status = "🟢 Active"
        
        members_health.append(schemas.LinkedInHealth(
            username=u.username,
            name=u.name,
            expires_in_days=days_left,
            status=status
        ))
    
    return {
        "backend": "🟢 Online",
        "database": db_status,
        "google_api": "🟢 Configured" if google_key and "your_" not in google_key else "🔴 Missing/Default",
        "linkedin_api": "🟢 Configured" if linkedin_key and "your_" not in linkedin_key else "🔴 Missing/Default",
        "members": members_health
    }

@app.post("/admin/keys")
def admin_update_keys(env_update: schemas.EnvUpdate, token: str = Depends(verify_admin)):
    env_file = os.path.join(os.path.dirname(__file__), ".env")
    
    # Ensure file exists
    if not os.path.exists(env_file):
        open(env_file, 'a').close()
        
    if env_update.google_api_key:
        set_key(env_file, "GOOGLE_API_KEY", env_update.google_api_key)
        os.environ["GOOGLE_API_KEY"] = env_update.google_api_key
        
    if env_update.linkedin_access_token:
        set_key(env_file, "LINKEDIN_ACCESS_TOKEN", env_update.linkedin_access_token)
        os.environ["LINKEDIN_ACCESS_TOKEN"] = env_update.linkedin_access_token
        
    # Reload the environment
    load_dotenv(env_file)
    
    return {"status": "success", "message": "API keys updated successfully"}

# ==========================================
# Auth & OAuth Routes
# ==========================================

@app.get("/auth/check")
async def check_auth(db: Session = Depends(get_db), request: Request = None):
    session_id = request.cookies.get("session_id")
    if not session_id:
        return {"status": "unauthenticated"}
        
    sess = db.query(models.Session).filter(models.Session.session_id == session_id).first()
    if not sess or sess.expires_at < datetime.datetime.utcnow():
        return {"status": "unauthenticated"}
    
    user = db.query(models.User).filter(models.User.id == sess.user_id).first() if sess.user_id else None
    
    # Silent LinkedIn Connection Persistence check
    has_linkedin = False
    if user and user.encrypted_token:
        try:
            token = decrypt_token(user.encrypted_token)
            # Ping LinkedIn silently to verify the token is still alive
            await linkedin_svc.get_user_urn(token)
            has_linkedin = True
        except Exception as e:
            if "LINKEDIN_UNAUTHORIZED" in str(e):
                print(f"DEBUG: Token for user {user.username} expired. Clearing from DB.")
                user.encrypted_token = None
                user.linkedin_user_id = None
                db.commit()
            else:
                # Log other network errors but assume connection is ok to avoid blips
                print(f"DEBUG: LinkedIn silent check skipped due to network/error: {e}")
                has_linkedin = True

    return {
        "status": "authenticated", 
        "user": {
            "username": user.username if user else None,
            "name": user.name if user else None,
            "has_linkedin": has_linkedin
        } if user else None
    }

@app.post("/auth/signup")
def signup(payload: schemas.UserSignup, db: Session = Depends(get_db)):
    MASTER_PASSWORD = os.getenv("MASTER_PASSWORD", "changeme")
    if payload.master_key != MASTER_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid Master Key")
    
    # Password validation: minimum 6 chars, letters and numbers
    if len(payload.password) < 6 or not any(c.isalpha() for c in payload.password) or not any(c.isdigit() for c in payload.password):
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters and include both letters and numbers.")
    
    # Case-insensitive username check
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
    return {"status": "success", "message": "User created successfully. You can now log in."}

@app.post("/auth/login")
def login(request: Request, response: Response, payload: schemas.UserLogin, db: Session = Depends(get_db)):
    MASTER_PASSWORD = os.getenv("MASTER_PASSWORD", "changeme")
    if payload.master_key != MASTER_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid Master Key")
    
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

@app.post("/auth/logout")
def logout(response: Response):
    response.delete_cookie("session_id", path="/")
    return {"status": "logged out"}

@app.get("/auth/linkedin")
def linkedin_login():
    client_id = os.getenv("LINKEDIN_CLIENT_ID")
    redirect_uri = os.getenv("LINKEDIN_REDIRECT_URI", "http://localhost:8000/auth/linkedin/callback")
    if not client_id:
        raise HTTPException(status_code=500, detail="LinkedIn Client ID not configured")
    
    scope = "w_member_social profile openid email"
    auth_url = f"https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id={client_id}&redirect_uri={redirect_uri}&scope={scope}"
    return RedirectResponse(auth_url)

@app.get("/auth/linkedin/callback")
async def linkedin_callback(code: str, request: Request, db: Session = Depends(get_db), session: models.Session = Depends(get_current_session)):
    client_id = os.getenv("LINKEDIN_CLIENT_ID")
    client_secret = os.getenv("LINKEDIN_CLIENT_SECRET")
    redirect_uri = os.getenv("LINKEDIN_REDIRECT_URI", "http://localhost:8000/auth/linkedin/callback")
    
    if not all([client_id, client_secret]):
        raise HTTPException(status_code=500, detail="LinkedIn credentials not configured")

    # Exchange code for token
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
        
        # Get user urn
        urn_response = await client.get(
            "https://api.linkedin.com/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"}
        )
        urn_response.raise_for_status()
        urn_data = urn_response.json()
        linkedin_user_id = urn_data.get("sub")
        name = urn_data.get("name")
        
    # Encrypt and save
    encrypted = encrypt_token(access_token)
    expiry = datetime.datetime.utcnow() + datetime.timedelta(days=60) # Standard LinkedIn token life
    
    # 1. First, find anyone that already has this linkedin_user_id
    # We must clear them out to satisfy the UNIQUE constraint in the database
    existing_associates = db.query(models.User).filter(
        models.User.linkedin_user_id == linkedin_user_id
    ).all()
    
    for assoc in existing_associates:
        if assoc.id != session.user_id:
            # If it's a ghost account (no username), just delete it
            if not assoc.username:
                db.delete(assoc)
            else:
                # If it's a real user, just disconnect their LinkedIn
                assoc.linkedin_user_id = None
                assoc.encrypted_token = None
    
    # Commit the cleanup immediately to avoid UNIQUE constraint violation on the next update
    db.commit()

    # 2. Re-fetch current user to attach the new identity
    user = db.query(models.User).filter(models.User.id == session.user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
        
    user.linkedin_user_id = linkedin_user_id
    user.encrypted_token = encrypted
    user.name = name
    user.token_expires_at = expiry
    
    db.commit()

    # Redirect back to the frontend dashboard
    return RedirectResponse(url="/")
# Finally, mount the frontend to the root
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
