from fastapi import FastAPI, HTTPException
import os
from dotenv import load_dotenv
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Load environment variables
load_dotenv()

import models
from database import engine
from core.config import settings
from routers import auth, posts, admin, user

# Create database tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title=settings.PROJECT_NAME, version=settings.VERSION)

# Rate Limiting
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

def _cors_origins():
    origins = {
        "https://linkedin-assistant-frontend.vercel.app",
        "https://postly-li.vercel.app",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    }
    for key in ("FRONTEND_URL", "VERCEL_URL", "VERCEL_BRANCH_URL"):
        for origin in os.getenv(key, "").split(","):
            origin = origin.strip().rstrip("/")
            if origin:
                if "://" not in origin:
                    origin = f"https://{origin}"
                origins.add(origin)
    return sorted(origins)


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── API Routes FIRST (before static mount) ───────────────────────────────────

app.include_router(auth.router)
app.include_router(user.router)
app.include_router(posts.router)
app.include_router(admin.router)

from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from fastapi import Depends
from database import get_db
from utils.auth import get_current_session
from utils.encryption import decrypt_token
from services import ai_service
from db.supabase_client import supabase_db
import schemas

@app.on_event("startup")
async def startup_event():
    if settings.is_supabase_configured:
        print("⚡ [Supabase] Connected to Supabase PostgreSQL.")
        migration_res = supabase_db.run_migrations()
        print(f"⚡ [Supabase] Migration status: {migration_res.get('message', 'done')}")
    else:
        print("ℹ️ [Supabase] SUPABASE_URL not configured. Operating in local fallback mode.")

@app.post("/api/generate")
async def api_generate_post(
    request: schemas.AIDraftRequest,
    db: Session = Depends(get_db),
    session: models.Session = Depends(get_current_session)
):
    """
    Generate LinkedIn draft dynamically injecting the current user's authorized Gemini key per request.
    Retrieves key from Supabase 'profiles' table with local fallback.
    """
    user_key = None
    if session.user_id:
        profile = supabase_db.get_profile(str(session.user_id))
        if profile and profile.get("user_gemini_api_key"):
            try:
                user_key = decrypt_token(profile["user_gemini_api_key"])
            except Exception:
                user_key = None

    if not user_key and session.user_id:
        user = db.query(models.User).filter(models.User.id == session.user_id).first()
        user_key = user.get_decrypted_ai_key() if user else None

    if not user_key:
        raise HTTPException(
            status_code=400,
            detail={"code": "AI_AUTH_REQUIRED", "message": "Connect a Gemini API key in AI Settings to generate drafts."},
        )
    key_valid, key_error = await ai_service.validate_gemini_api_key(user_key)
    if not key_valid:
        raise HTTPException(
            status_code=401,
            detail={"code": "AI_AUTH_INVALID", "message": "Your Gemini API key could not be authorized. Update it in AI Settings.", "diagnostic": key_error},
        )

    metadata = {
        "resource_persons": request.resource_persons,
        "coordinators": request.coordinators,
        "mentors": request.mentors,
        "tone": request.tone
    }

    return StreamingResponse(
        ai_service.generate_linkedin_draft(
            topic=request.topic,
            tone=request.tone,
            prompt_type=request.prompt_type,
            metadata=metadata,
            api_key=user_key
        ),
        media_type="text/plain"
    )

@app.get("/health")
def health():
    return {"status": "ok", "project": settings.PROJECT_NAME, "version": settings.VERSION}

@app.get("/api/config")
def api_public_config():
    """Returns public client configuration including Supabase URL and Anon Key."""
    return {
        "supabase_url": settings.SUPABASE_URL,
        "supabase_anon_key": settings.SUPABASE_ANON_KEY,
        "is_supabase_configured": settings.is_supabase_configured,
        "is_supabase_auth_configured": settings.is_supabase_auth_configured,
    }

# Mount uploads
if not os.path.exists("uploads"):
    os.makedirs("uploads")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
