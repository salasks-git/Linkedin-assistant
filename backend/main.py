from fastapi import FastAPI
import os
import sys
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
from routers import auth, posts, admin

# Create database tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="LinkedIn Assistant API")

# Rate Limiting
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

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

# Resolve Frontend Path
# Try 1: Sibling of backend folder (Standard)
# Try 2: Inside current folder (If Root Dir is set)
# Try 3: Absolute app root
base_path = os.path.dirname(os.path.abspath(__file__))
potential_paths = [
    os.path.join(base_path, "..", "frontend"),
    os.path.join(base_path, "frontend"),
    "/app/frontend",
    "./frontend"
]

frontend_dir = None
for p in potential_paths:
    if os.path.exists(p) and os.path.isdir(p):
        frontend_dir = os.path.abspath(p)
        print(f"✅ FOUND FRONTEND AT: {frontend_dir}")
        break

if not frontend_dir:
    print(f"❌ ERROR: Frontend directory not found in: {potential_paths}")
    # Fallback to current dir to prevent crash, but will show 404
    frontend_dir = base_path

# Mount uploads
if not os.path.exists("uploads"):
    os.makedirs("uploads")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# Mount frontend
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")

@app.get("/health")
def health():
    return {"status": "ok", "frontend_path": frontend_dir, "cwd": os.getcwd()}

@app.get("/debug/ai")
def debug_ai():
    """Test the AI connection and return the raw error for diagnosis."""
    key = os.getenv("GOOGLE_API_KEY")
    if not key:
        return {"error": "NO API KEY FOUND IN ENVIRONMENT"}
    
    # Show partial key to confirm it's the right one
    key_preview = key[:8] + "..." + key[-4:]
    
    try:
        from google import genai
        client = genai.Client(api_key=key, http_options={"api_version": "v1"})
        response = client.models.generate_content(model="gemini-2.0-flash", contents="Say: Hello World")
        return {"status": "SUCCESS", "key_preview": key_preview, "response": response.text}
    except Exception as e:
        return {"status": "FAILED", "key_preview": key_preview, "raw_error": str(e)}
