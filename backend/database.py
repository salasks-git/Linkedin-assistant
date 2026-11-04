import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.config import settings

SQLALCHEMY_DATABASE_URL = settings.DATABASE_URL or os.getenv("DATABASE_URL", "sqlite:///./posts.db")

if settings.APP_ENV == "production" and not SQLALCHEMY_DATABASE_URL.startswith(("postgresql://", "postgres://")):
    raise RuntimeError("Production requires a persistent PostgreSQL DATABASE_URL")

if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
    )
else:
    # Render/Neon Postgres URLs sometimes start with postgres:// but sqlalchemy requires postgresql://
    if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
        SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)
    engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
