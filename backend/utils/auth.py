import bcrypt
from fastapi import Request, Depends, HTTPException
from sqlalchemy.orm import Session
import datetime
import models
from database import get_db
from core.config import settings


def _value(value, key, default=None):
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)


def get_supabase_auth_user(request: Request):
    """Validate a Supabase access token with Supabase Auth and return its user."""
    authorization = request.headers.get("Authorization", "")
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="A valid Bearer token is required")
    if not settings.is_supabase_auth_configured:
        raise HTTPException(status_code=503, detail="Supabase Auth is not configured")

    from db.supabase_client import get_supabase_anon_client
    client = get_supabase_anon_client()
    if client is None:
        raise HTTPException(status_code=503, detail="Supabase Auth client is unavailable")
    try:
        response = client.auth.get_user(token.strip())
        user = _value(response, "user")
        if not user or not _value(user, "id"):
            raise ValueError("Supabase Auth returned no user")
        return user
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Supabase access token is invalid or expired") from exc


def sync_supabase_user_to_local(auth_user, db: Session) -> models.User:
    """Keep the existing local LinkedIn/session model usable for Supabase users."""
    user_id = str(_value(auth_user, "id"))
    metadata = _value(auth_user, "user_metadata", {}) or {}
    full_name = (
        _value(metadata, "full_name")
        or _value(metadata, "name")
        or _value(auth_user, "email")
        or "Google user"
    )
    user = db.query(models.User).filter(models.User.id == user_id).first()
    changed = False
    if user is None:
        user = models.User(
            id=user_id,
            username=f"google_{user_id.replace('-', '')[:20]}",
            name=full_name,
        )
        db.add(user)
        changed = True
    elif full_name and user.name != full_name:
        user.name = full_name
        changed = True
    if changed:
        try:
            db.commit()
            db.refresh(user)
        except Exception as exc:
            db.rollback()
            raise HTTPException(status_code=500, detail="Could not synchronize the authenticated user") from exc
    return user

def get_password_hash(password: str) -> str:
    """Hashes a password with a fresh salt."""
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plain password against its hash."""
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False

def get_or_create_default_user(db: Session):
    """Bypasses login for development by ensuring a default 'creator' user and active session exist."""
    user = db.query(models.User).filter(models.User.username == "creator").first()
    if not user:
        user = models.User(
            id="00000000-0000-0000-0000-000000000001",
            username="creator",
            name="Creator",
            hashed_password=get_password_hash("creator123")
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    sess = db.query(models.Session).filter(
        models.Session.user_id == user.id,
        models.Session.expires_at > datetime.datetime.utcnow()
    ).first()
    if not sess:
        sess = models.Session(
            user_id=user.id,
            expires_at=datetime.datetime.utcnow() + datetime.timedelta(days=30)
        )
        db.add(sess)
        db.commit()
        db.refresh(sess)
    return user, sess

def get_current_session(request: Request, db: Session = Depends(get_db)):
    auth_user = get_supabase_auth_user(request)
    if auth_user is not None:
        user = sync_supabase_user_to_local(auth_user, db)
        # This transient session lets existing route handlers use the same user_id
        # abstraction without storing or trusting a second session token.
        return models.Session(
            session_id=f"supabase:{user.id}",
            user_id=user.id,
            expires_at=datetime.datetime.utcnow() + datetime.timedelta(hours=1),
        )

    session_id = request.cookies.get("session_id")
    if session_id:
        sess = db.query(models.Session).filter(models.Session.session_id == session_id).first()
        if sess and sess.expires_at > datetime.datetime.utcnow():
            return sess

    raise HTTPException(status_code=401, detail="Authentication required")

def get_current_user_token(session: models.Session = Depends(get_current_session), db: Session = Depends(get_db)):
    from utils.encryption import decrypt_token # localized to avoid circular deps
    if not session.user_id:
        raise HTTPException(status_code=401, detail="No LinkedIn User connected to this session. Please connect your LinkedIn account.")
    usr = db.query(models.User).filter(models.User.id == session.user_id).first()
    if not usr:
        raise HTTPException(status_code=401, detail="User not found")
    return decrypt_token(usr.encrypted_token)
