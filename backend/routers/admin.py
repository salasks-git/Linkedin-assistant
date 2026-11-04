import os
import datetime
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
import models
import schemas
from database import get_db

from core.config import settings

router = APIRouter(prefix="/admin", tags=["admin"])

def verify_admin(x_admin_token: str = Header(...)):
    if not settings.ADMIN_TOKEN:
        raise HTTPException(status_code=503, detail="Admin access is not configured")
    if x_admin_token != settings.ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")

@router.post("/login")
def admin_login(login: schemas.AdminLogin):
    if not settings.ADMIN_PASSWORD or not settings.ADMIN_TOKEN:
        raise HTTPException(status_code=503, detail="Admin access is not configured")
    if login.password == settings.ADMIN_PASSWORD:
        return {"token": settings.ADMIN_TOKEN}
    raise HTTPException(status_code=401, detail="Invalid password")

@router.get("/status")
def admin_status(token: str = Depends(verify_admin), db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        db_status = "🟢 Online"
    except:
        db_status = "🔴 Offline"
        
    google_key = settings.GOOGLE_API_KEY
    linkedin_configured = bool(settings.LINKEDIN_CLIENT_ID and settings.LINKEDIN_CLIENT_SECRET)
    
    members_health = []
    users = db.query(models.User).all()
    
    now = datetime.datetime.utcnow()
    for u in users:
        days_left = None
        status = "⚪ Disconnected"
        if u.token_expires_at:
            delta = u.token_expires_at - now
            days_left = max(0, delta.days)
            status = "🟢 Active" if days_left > 0 else "🔴 Expired"
        elif u.encrypted_token:
            status = "🟢 Connected"
        
        members_health.append(schemas.LinkedInHealth(
            username=u.username or "unnamed",
            name=u.name,
            expires_in_days=days_left,
            status=status
        ))
    
    return {
        "backend": "🟢 Online",
        "database": db_status,
        "google_api": "🟢 Configured (Fallback)" if google_key and "your_" not in google_key else "⚪ Per-User Mode (Optional Fallback Unset)",
        "linkedin_api": "🟢 System OAuth Configured" if linkedin_configured else "🔴 Missing System Credentials",
        "members": members_health
    }

@router.post("/keys")
def admin_update_keys(env_update: schemas.EnvUpdate, token: str = Depends(verify_admin)):
    from dotenv import set_key, load_dotenv
    env_file = os.path.join(os.path.dirname(__file__), "..", ".env")
    
    if not os.path.exists(env_file):
        open(env_file, 'a').close()
        
    if env_update.google_api_key:
        set_key(env_file, "GOOGLE_API_KEY", env_update.google_api_key)
        os.environ["GOOGLE_API_KEY"] = env_update.google_api_key
        
    if env_update.linkedin_access_token:
        set_key(env_file, "LINKEDIN_ACCESS_TOKEN", env_update.linkedin_access_token)
        os.environ["LINKEDIN_ACCESS_TOKEN"] = env_update.linkedin_access_token
        
    load_dotenv(env_file)
    return {"status": "success", "message": "API keys updated successfully"}
