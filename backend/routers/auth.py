import os
import datetime
import base64
import binascii
import hashlib
import hmac
import httpx
import json
import secrets
import time
from typing import Optional
from urllib.parse import urlsplit
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
import models
import schemas
from database import get_db
from utils.auth import (
    get_password_hash,
    verify_password,
    get_current_session,
    get_supabase_auth_user,
    sync_supabase_user_to_local,
)
from utils.encryption import encrypt_token, decrypt_token
from services.linkedin_service import linkedin_svc
from core.config import settings
from db.supabase_client import supabase_db

router = APIRouter(prefix="/auth", tags=["auth"])


def _create_linkedin_state(user_id: str) -> str:
    secret = settings.ENCRYPTION_KEY.strip()
    if not secret:
        raise HTTPException(status_code=503, detail="LinkedIn connection security is not configured")
    payload = json.dumps(
        {"user_id": str(user_id), "issued_at": int(time.time()), "nonce": secrets.token_urlsafe(24)},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    signature = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(payload + signature).decode("ascii").rstrip("=")


def _read_linkedin_state(state: str) -> str:
    secret = settings.ENCRYPTION_KEY.strip()
    try:
        encoded = state + "=" * (-len(state) % 4)
        raw = base64.urlsafe_b64decode(encoded.encode("ascii"))
        payload, signature = raw[:-32], raw[-32:]
        expected = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()
        if not secret or not hmac.compare_digest(signature, expected):
            raise ValueError("Invalid LinkedIn sign-in state")
        data = json.loads(payload.decode("utf-8"))
        issued_at = int(data["issued_at"])
        if abs(int(time.time()) - issued_at) > 600:
            raise ValueError("LinkedIn sign-in expired; please try again")
        user_id = data.get("user_id")
        if not user_id:
            raise ValueError("LinkedIn sign-in state has no user")
        return str(user_id)
    except (ValueError, TypeError, KeyError, UnicodeDecodeError, json.JSONDecodeError, binascii.Error) as exc:
        raise HTTPException(status_code=400, detail="LinkedIn sign-in expired or invalid. Please try again.") from exc


def _linkedin_authorization_url(request: Request, user_id: str) -> str:
    callback_uri = str(request.url_for("linkedin_callback"))
    state = _create_linkedin_state(user_id)
    return linkedin_svc.get_authorization_url(redirect_uri=callback_uri, state=state)

@router.get("/check")
async def check_auth(request: Request, response: Response, db: Session = Depends(get_db)):
    auth_user = get_supabase_auth_user(request)
    google_metadata = {}
    if auth_user is not None:
        user = sync_supabase_user_to_local(auth_user, db)
        now = datetime.datetime.utcnow()
        session_id = request.cookies.get("session_id")
        app_session = db.query(models.Session).filter(models.Session.session_id == session_id).first() if session_id else None
        if not app_session or app_session.user_id != user.id or app_session.expires_at <= now:
            app_session = models.Session(
                user_id=user.id,
                expires_at=now + datetime.timedelta(days=7),
            )
            db.add(app_session)
            db.commit()
            db.refresh(app_session)
        response.set_cookie(
            key="session_id",
            value=app_session.session_id,
            httponly=True,
            max_age=7 * 24 * 60 * 60,
            samesite="none" if settings.APP_ENV == "production" else "lax",
            secure=settings.APP_ENV == "production" or request.url.scheme == "https",
            path="/",
        )
        raw_metadata = getattr(auth_user, "user_metadata", None)
        if isinstance(raw_metadata, dict):
            google_metadata = raw_metadata
        full_name = google_metadata.get("full_name") or google_metadata.get("name") or user.name
        avatar_url = google_metadata.get("avatar_url") or google_metadata.get("picture")
        profile = supabase_db.upsert_google_auth_profile(
            user_id=str(user.id),
            email=getattr(auth_user, "email", None),
            full_name=full_name,
            avatar_url=avatar_url,
        )
        has_linkedin = False
    else:
        session_id = request.cookies.get("session_id")
        sess = db.query(models.Session).filter(models.Session.session_id == session_id).first() if session_id else None
        if not sess or sess.expires_at <= datetime.datetime.utcnow() or not sess.user_id:
            response.delete_cookie("session_id", path="/")
            return {
                "status": "unauthenticated",
                "user": None,
                "supabase": {"url": settings.SUPABASE_URL, "anon_key": settings.SUPABASE_ANON_KEY},
            }
        user = db.query(models.User).filter(models.User.id == sess.user_id).first()
        if not user:
            response.delete_cookie("session_id", path="/")
            return {"status": "unauthenticated", "user": None}
        # Older builds created this account automatically as a development
        # bypass. Require an explicit login instead of treating that cookie as
        # a real authenticated session.
        if user.id == "00000000-0000-0000-0000-000000000001":
            db.query(models.Session).filter(models.Session.user_id == user.id).delete()
            db.commit()
            response.delete_cookie("session_id", path="/")
            return {
                "status": "unauthenticated",
                "user": None,
                "supabase": {"url": settings.SUPABASE_URL, "anon_key": settings.SUPABASE_ANON_KEY},
            }
        profile = supabase_db.get_profile(str(user.id))
        if not profile:
            profile = supabase_db.upsert_profile(
                user_id=str(user.id),
                email=f"{user.username}@local.dev" if user.username else None,
                user_gemini_api_key=user.user_gemini_api_key,
                ai_authorized=bool(user.user_gemini_api_key),
            )
        has_linkedin = False

    has_ai_auth = bool(profile.get("ai_authorized")) or bool(user.user_gemini_api_key)
    linkedin_status = "disconnected"

    if user and user.encrypted_token:
        try:
            token = decrypt_token(user.encrypted_token)
            await linkedin_svc.get_user_urn(token)
            has_linkedin = True
            linkedin_status = "connected"
        except Exception as e:
            if "LINKEDIN_UNAUTHORIZED" in str(e):
                user.encrypted_token = None
                user.linkedin_user_id = None
                db.commit()
                linkedin_status = "disconnected"
            else:
                # Keep the token for retry, but never show a green status when
                # LinkedIn could not verify it (version/API/network failures).
                has_linkedin = False
                linkedin_status = "error"

    display_name = (profile.get("full_name") if profile else None) or user.name
    auth_email = getattr(auth_user, "email", None) if auth_user is not None else None
    avatar_url = profile.get("avatar_url") if auth_user is not None and profile else None

    return {
        "status": "authenticated", 
        "user": {
            "id": str(user.id) if user else None,
            "username": user.username if user else None,
            "name": display_name if user else None,
            "email": auth_email,
            "avatar_url": avatar_url,
            "has_linkedin": has_linkedin,
            "linkedin_status": linkedin_status,
            "has_ai_auth": has_ai_auth,
            "masked_ai_key": user.get_masked_ai_key() if user else None,
            "ai_provider": user.ai_provider if user else None,
        } if user else None,
        "supabase": {
            "url": settings.SUPABASE_URL,
            "anon_key": settings.SUPABASE_ANON_KEY
        }
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
        samesite='none' if settings.APP_ENV == "production" else 'lax',
        secure=settings.APP_ENV == "production" or request.url.scheme == "https",
        path="/"
    )
    return {"status": "success", "username": user.username, "name": user.name}

@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    session_id = request.cookies.get("session_id")
    if session_id:
        db.query(models.Session).filter(models.Session.session_id == session_id).delete()
        db.commit()
    response.delete_cookie("session_id", path="/")
    return {"status": "logged out"}

@router.get("/linkedin")
def linkedin_login(request: Request, session: models.Session = Depends(get_current_session)):
    try:
        return RedirectResponse(_linkedin_authorization_url(request, str(session.user_id)))
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/linkedin/start")
def linkedin_start(request: Request, session: models.Session = Depends(get_current_session)):
    """Start LinkedIn OAuth from a credentialed frontend fetch, then navigate to LinkedIn."""
    try:
        return {"authorization_url": _linkedin_authorization_url(request, str(session.user_id))}
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/linkedin/callback")
async def linkedin_callback(
    request: Request,
    db: Session = Depends(get_db),
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
):
    if error or not code or not state:
        raise HTTPException(status_code=400, detail="LinkedIn sign-in was cancelled or did not return a code. Please try again.")
    user_id = _read_linkedin_state(state)
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="The account that started LinkedIn sign-in is no longer available. Please sign in again.")

    try:
        callback_uri = str(request.url_for("linkedin_callback"))
        token_data = await linkedin_svc.exchange_code_for_token(code, redirect_uri=callback_uri)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"LinkedIn token exchange failed: {str(e)}")

    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="Failed to retrieve access token from LinkedIn")

    async with httpx.AsyncClient() as client:
        urn_response = await client.get(
            f"{linkedin_svc.api_base}/v2/userinfo",
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
        if assoc.id != user.id:
            if not assoc.username:
                db.delete(assoc)
            else:
                assoc.linkedin_user_id = None
                assoc.encrypted_token = None
    
    db.commit()

    user.linkedin_user_id = linkedin_user_id
    user.encrypted_token = encrypted
    user.name = name
    user.token_expires_at = expiry
    db.commit()

    frontend_url = settings.FRONTEND_URL
    if settings.APP_ENV == "production":
        parsed_frontend_url = urlsplit(frontend_url)
        if (
            parsed_frontend_url.scheme != "https"
            or parsed_frontend_url.hostname not in {
                "linkedin-assistant-frontend.vercel.app",
                "postly-li.vercel.app",
            }
            or parsed_frontend_url.path not in ("", "/")
        ):
            frontend_url = "https://postly-li.vercel.app"
    return RedirectResponse(url=f"{frontend_url}/")
