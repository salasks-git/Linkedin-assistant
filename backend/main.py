from fastapi import FastAPI
import os
from dotenv import load_dotenv
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Load environment variables IMMEDIATELY
load_dotenv()

import models
from database import engine

# Import routers
from routers import auth, posts, admin

# Create database tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="LinkedIn Assistant API")

# Rate Limiting
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS fallback
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Connect routers
app.include_router(auth.router)
app.include_router(posts.router)
app.include_router(admin.router)

# Mount uploads for static access
if not os.path.exists("uploads"):
    os.makedirs("uploads")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# Frontend directory resolution
frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

# Mount the frontend to the root
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
