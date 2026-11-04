from sqlalchemy import Column, Integer, String, DateTime, Text, Boolean
from sqlalchemy.orm import declarative_base
import datetime
import uuid

Base = declarative_base()

class Post(Base):
    # Supabase owns public.posts; this table is only the local fallback.
    __tablename__ = "local_posts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True, nullable=True) # ForeignKey would be better but let's keep it flexible for now
    content = Column(Text, nullable=False)
    scheduled_at = Column(DateTime, default=datetime.datetime.utcnow)
    status = Column(String, default="draft") # draft, scheduled, posted, failed
    linkedin_post_id = Column(String, nullable=True)
    image_paths = Column(Text, nullable=True) # JSON list of local file names
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    username = Column(String, unique=True, index=True, nullable=True)
    hashed_password = Column(String, nullable=True)
    linkedin_user_id = Column(String, unique=True, index=True, nullable=True)
    name = Column(String, nullable=True)
    encrypted_token = Column(Text, nullable=True)
    token_expires_at = Column(DateTime, nullable=True)

    # User-level AI Key Management (Encrypted)
    user_gemini_api_key = Column(Text, nullable=True)
    ai_provider = Column(String, default="gemini", nullable=True)
    ai_authorized_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    def get_decrypted_ai_key(self):
        """Decrypts and returns user's stored API key."""
        if not self.user_gemini_api_key:
            return None
        try:
            from utils.encryption import decrypt_token
            return decrypt_token(self.user_gemini_api_key)
        except Exception:
            return None

    def get_masked_ai_key(self):
        """Returns safe preview for UI/API display."""
        raw = self.get_decrypted_ai_key()
        if not raw:
            return None
        if len(raw) > 8:
            return f"{raw[:4]}...{raw[-4:]}"
        return "••••••••"

class Session(Base):
    __tablename__ = "sessions"

    session_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    user_id = Column(String, nullable=True) # If null, it's just a master gatekeeper session without a connected linkedin user
    is_master = Column(Boolean, default=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
