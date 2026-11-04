import os
from sqlalchemy import create_engine
from models import Base, Post, User, Session as UserSession
from database import SQLALCHEMY_DATABASE_URL
from dotenv import load_dotenv

# Ensure environment is loaded (esp. for Neon DB URL)
# Note: models.py needs Base to be accessible
from models import Base

def reset_database():
    load_dotenv()
    db_url = os.getenv("DATABASE_URL", SQLALCHEMY_DATABASE_URL)
    
    if db_url.startswith("sqlite"):
        # For sqlite, we can just delete the file, but let's be consistent
        if os.path.exists("./posts.db"):
            os.remove("./posts.db")
            print("🗑️ Deleted posts.db")
    
    print(f"🔄 Connecting to {db_url.split('@')[-1]}...") # Don't log full URL with pass
    
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)
        
    engine = create_engine(db_url)
    
    print("🧹 Dropping all tables...")
    Base.metadata.drop_all(bind=engine)
    
    print("✨ Recreating all tables...")
    Base.metadata.create_all(bind=engine)
    
    print("✅ Database reset complete.")

if __name__ == "__main__":
    reset_database()
