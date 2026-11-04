import os
from pathlib import Path
from dotenv import load_dotenv

# Base directory for backend
BASE_DIR = Path(__file__).resolve().parent.parent

# Load environment variables from backend/.env if present
env_path = BASE_DIR / ".env"
load_dotenv(dotenv_path=env_path)


class Settings:
    PROJECT_NAME: str = "LinkedIn Assistant API"
    VERSION: str = "1.0.0"
    APP_ENV: str = os.getenv("APP_ENV", "development").lower()
    FRONTEND_URL: str = os.getenv(
        "FRONTEND_URL", "https://linkedin-assistant-frontend.vercel.app"
    ).strip().rstrip("/")

    # Server & Database Settings
    DATABASE_URL: str = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR}/posts.db")
    ENCRYPTION_KEY: str = os.getenv("ENCRYPTION_KEY", "")
    ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "")
    ADMIN_TOKEN: str = os.getenv("ADMIN_TOKEN", "")

    # Supabase (PostgreSQL) Configuration
    # The project URL is public client configuration. Keep it as a fallback so
    # auth can initialize if the host omits this non-secret environment value.
    SUPABASE_URL: str = os.getenv(
        "SUPABASE_URL", "https://nuuzxooibsqrpwgruygu.supabase.co"
    ).strip() or "https://nuuzxooibsqrpwgruygu.supabase.co"
    SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    SUPABASE_ANON_KEY: str = os.getenv("SUPABASE_ANON_KEY", "")

    @property
    def is_supabase_configured(self) -> bool:
        """Returns True if valid Supabase URL and service role key are provided."""
        service_key = self.SUPABASE_SERVICE_ROLE_KEY.strip()
        return bool(
            self.SUPABASE_URL
            and service_key
            and not service_key.lower().startswith("your_")
            and "placeholder" not in service_key.lower()
            and not self.SUPABASE_URL.startswith("https://your-project-id")
            and not self.SUPABASE_URL.rstrip("/").endswith("/rest/v1")
        )

    @property
    def is_supabase_auth_configured(self) -> bool:
        """Returns True when browser Auth has a project URL and publishable key."""
        anon_key = self.SUPABASE_ANON_KEY.strip()
        return bool(
            self.SUPABASE_URL
            and anon_key
            and not anon_key.lower().startswith("your_")
            and "placeholder" not in anon_key.lower()
            and not self.SUPABASE_URL.startswith("https://your-project-id")
            and not self.SUPABASE_URL.rstrip("/").endswith("/rest/v1")
        )

    # System-Wide LinkedIn OAuth Credentials (Managed strictly by Server/Admin)
    LINKEDIN_CLIENT_ID: str = os.getenv("LINKEDIN_CLIENT_ID", "")
    LINKEDIN_CLIENT_SECRET: str = os.getenv("LINKEDIN_CLIENT_SECRET", "")
    LINKEDIN_REDIRECT_URI: str = os.getenv(
        "LINKEDIN_REDIRECT_URI",
        "http://localhost:8000/auth/linkedin/callback"
    )
    # Optional system fallback access token
    LINKEDIN_ACCESS_TOKEN: str = os.getenv("LINKEDIN_ACCESS_TOKEN", "")

    # System-Level AI Fallback (Optional default; users manage their own keys via /api/user/ai-auth)
    GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")
    DEFAULT_AI_MODEL: str = os.getenv("MODEL_NAME", "gemini-3.6-flash")


settings = Settings()
