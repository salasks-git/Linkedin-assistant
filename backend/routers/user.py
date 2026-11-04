import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
import models
import schemas
from database import get_db
from utils.auth import get_current_session
from utils.encryption import encrypt_token, decrypt_token, mask_api_key
from services.ai_service import validate_gemini_api_key
from db.supabase_client import supabase_db

router = APIRouter(prefix="/api/user", tags=["user"])


def _get_user_from_session(session: models.Session, db: Session) -> models.User:
    if not session.user_id:
        raise HTTPException(
            status_code=401,
            detail="Session has no associated user. Please log in or create an account first."
        )
    user = db.query(models.User).filter(models.User.id == session.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User account not found")
    return user


@router.post("/ai-auth", response_model=schemas.UserAIAuthResponse)
async def store_or_validate_ai_auth(
    payload: schemas.UserAIAuthRequest,
    db: Session = Depends(get_db),
    session: models.Session = Depends(get_current_session)
):
    """
    Onboarding endpoint to securely store or validate a user's personal Gemini API key.
    - Validates key against Gemini API (if validate_key=True)
    - Encrypts key with AES-256 Fernet
    - Persists authorization status and encrypted key directly to the 'profiles' table in Supabase
    - Returns masked preview of the key (e.g. AIza...x123)
    """
    user = _get_user_from_session(session, db)
    raw_key = (payload.api_key or "").strip()

    if not raw_key:
        raise HTTPException(status_code=400, detail="Gemini API key cannot be blank.")

    # Validate against Gemini if requested
    if payload.validate_key:
        is_valid, error_msg = await validate_gemini_api_key(raw_key, preferred_model=payload.provider)
        if not is_valid:
            raise HTTPException(
                status_code=400,
                detail=f"Key validation failed: {error_msg}"
            )

    # Securely encrypt key before persistence
    encrypted_key = encrypt_token(raw_key)
    now = datetime.datetime.utcnow()

    # 1. Persist directly to Supabase profiles table
    user_email = f"{user.username}@local.dev" if user.username else None
    supabase_db.upsert_profile(
        user_id=str(user.id),
        email=user_email,
        user_gemini_api_key=encrypted_key,
        ai_authorized=True
    )

    # 2. Also keep local user record in sync for session compatibility
    user.user_gemini_api_key = encrypted_key
    user.ai_provider = payload.provider or "gemini"
    user.ai_authorized_at = now
    db.commit()
    db.refresh(user)

    return schemas.UserAIAuthResponse(
        status="success",
        provider=user.ai_provider or "gemini",
        masked_key=mask_api_key(raw_key),
        authorized_at=now,
        message="Gemini API key validated and securely stored in Supabase profiles."
    )


@router.get("/ai-auth")
def get_ai_auth_status(
    db: Session = Depends(get_db),
    session: models.Session = Depends(get_current_session)
):
    """
    Returns the current user's AI authorization status and masked key,
    querying the Supabase profiles table.
    """
    user = _get_user_from_session(session, db)

    # Query Supabase profiles table
    profile = supabase_db.get_profile(str(user.id))

    encrypted_key = None
    ai_authorized = False

    if profile:
        encrypted_key = profile.get("user_gemini_api_key")
        ai_authorized = bool(profile.get("ai_authorized") and encrypted_key)
    else:
        # Fallback to local user model if profile row not yet seeded
        encrypted_key = user.user_gemini_api_key
        ai_authorized = bool(encrypted_key)

    masked_key = None
    if encrypted_key:
        try:
            raw = decrypt_token(encrypted_key)
            if raw:
                masked_key = mask_api_key(raw)
        except Exception:
            masked_key = "••••••••"

    return {
        "has_ai_auth": ai_authorized,
        "provider": user.ai_provider or "gemini",
        "masked_key": masked_key,
        "authorized_at": user.ai_authorized_at
    }


@router.delete("/ai-auth")
def revoke_ai_auth(
    db: Session = Depends(get_db),
    session: models.Session = Depends(get_current_session)
):
    """
    Revokes the current user's AI authorization and clears their stored key
    in both Supabase profiles and local database.
    """
    user = _get_user_from_session(session, db)

    # Revoke in Supabase profiles
    supabase_db.revoke_ai_auth(str(user.id))

    # Revoke in local session user model
    user.user_gemini_api_key = None
    user.ai_provider = None
    user.ai_authorized_at = None
    db.commit()

    return {"status": "success", "message": "AI authorization revoked from Supabase profiles."}
