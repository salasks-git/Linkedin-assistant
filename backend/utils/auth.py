import bcrypt
from fastapi import Request, Depends, HTTPException
from sqlalchemy.orm import Session
import datetime
import models
from database import get_db

def get_password_hash(password: str) -> str:
    """Hashes a password with a fresh salt."""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plain password against its hash."""
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False

def get_current_session(request: Request, db: Session = Depends(get_db)):
    session_id = request.cookies.get("session_id")
    if not session_id:
        raise HTTPException(status_code=401, detail="Unauthorized: No session cookie")
    
    sess = db.query(models.Session).filter(models.Session.session_id == session_id).first()
    if not sess or sess.expires_at < datetime.datetime.utcnow():
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    
    return sess

def get_current_user_token(session: models.Session = Depends(get_current_session), db: Session = Depends(get_db)):
    from utils.encryption import decrypt_token # localized to avoid circular deps
    if not session.user_id:
        raise HTTPException(status_code=401, detail="No LinkedIn User connected to this session. Please connect your LinkedIn account.")
    usr = db.query(models.User).filter(models.User.id == session.user_id).first()
    if not usr:
        raise HTTPException(status_code=401, detail="User not found")
    return decrypt_token(usr.encrypted_token)
