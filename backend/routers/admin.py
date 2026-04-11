import os
import datetime
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
import models
import schemas
from database import get_db

router = APIRouter(prefix="/admin", tags=["admin"])

ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "changeme")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "changeme_token")

def verify_admin(x_admin_token: str = Header(...)):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")

@router.post("/login")
def admin_login(login: schemas.AdminLogin):
    if login.password == ADMIN_PASSWORD:
        return {"token": ADMIN_TOKEN}
    raise HTTPException(status_code=401, detail="Invalid password")

@router.get("/status")
def admin_status(token: str = Depends(verify_admin), db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        db_status = "🟢 Online"
    except:
        db_status = "🔴 Offline"
        
    google_key = os.getenv("GOOGLE_API_KEY")
    linkedin_key = os.getenv("LINKEDIN_ACCESS_TOKEN")
    
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
