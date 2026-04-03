from fastapi import FastAPI, Depends, HTTPException, Body, File, Form, UploadFile, Header
from fastapi.responses import StreamingResponse
import os
from dotenv import set_key, load_dotenv
from typing import List, Optional
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import text
import models, schemas, database
from database import engine, get_db
from services import ai_service
from services.prompts import PROMPTS
from services.linkedin_service import linkedin_svc
import re

from fastapi.staticfiles import StaticFiles
import uuid
import json

# Load environment variables early so admin creds can be read
load_dotenv()

# Create database tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="LinkedIn Assistant API")

# Mount uploads for static access
if not os.path.exists("uploads"):
    os.makedirs("uploads")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# Add CORS middleware — scoped to localhost only
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:3000",  # Keep for any tooling
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "LinkedIn Assistant Backend is running!"}

@app.get("/posts/prompts")
def get_prompts():
    """Returns the list of available prompt keys."""
    return {"prompts": list(PROMPTS.keys())}

@app.post("/posts/", response_model=schemas.Post)
async def create_post(
    content: str = Form(...),
    images: Optional[List[UploadFile]] = File(None),
    db: Session = Depends(get_db)
):
    image_filenames = []
    if images:
        for img in images:
            if img.filename:
                ext = os.path.splitext(img.filename)[1]
                filename = f"{uuid.uuid4()}{ext}"
                filepath = os.path.join("uploads", filename)
                with open(filepath, "wb") as f:
                    f.write(await img.read())
                image_filenames.append(filename)
    
    db_post = models.Post(
        content=content, 
        status="draft",
        image_paths=json.dumps(image_filenames) if image_filenames else None
    )
    db.add(db_post)
    db.commit()
    db.refresh(db_post)
    
    # Manually populate image_urls for response
    post_dict = schemas.Post.model_validate(db_post)
    post_dict.image_urls = [f"/uploads/{f}" for f in image_filenames]
    return post_dict

@app.get("/posts/", response_model=list[schemas.Post])
def get_posts(db: Session = Depends(get_db)):
    posts = db.query(models.Post).all()
    results = []
    for p in posts:
        post_obj = schemas.Post.model_validate(p)
        if p.image_paths:
            filenames = json.loads(p.image_paths)
            post_obj.image_urls = [f"/uploads/{f}" for f in filenames]
        else:
            post_obj.image_urls = []
        results.append(post_obj)
    return results

@app.post("/posts/extract-metadata")
async def extract_metadata(payload: dict = Body(...)):
    """Extract metadata roles from description text."""
    text = payload.get("text", "")
    if not text:
        return {}
    return await ai_service.extract_metadata(text)

@app.post("/posts/refine")
async def refine_post(request: schemas.AIRefineRequest):
    """Refine an existing draft based on user instruction."""
    return StreamingResponse(
        ai_service.refine_linkedin_draft(request.current_content, request.instruction),
        media_type="text/plain"
    )

@app.post("/posts/generate")
async def generate_post(request: schemas.AIDraftRequest):
    # Extract metadata for student-style prompts
    metadata = {
        "resource_persons": request.resource_persons,
        "coordinators": request.coordinators,
        "mentors": request.mentors,
        "tone": request.tone
    }
    
    return StreamingResponse(
        ai_service.generate_linkedin_draft(
            request.topic, 
            request.tone, 
            request.prompt_type,
            metadata=metadata
        ),
        media_type="text/plain"
    )

@app.post("/posts/preview", response_model=schemas.PostPreview)
def preview_post(post: schemas.PostBase):
    content = post.content
    count = len(content)
    hashtags = re.findall(r"#\w+", content)
    
    # RTCFR logic: check if it starts with a hook (question or strong statement)
    has_hook = content.strip().endswith('?') or any(content.split('\n')[0].lower().startswith(x) for x in ['why', 'how', 'when', 'if', 'the'])
    
    is_compliant = count < 3000 and len(hashtags) >= 1
    
    recommendation = "Great post! Good hook and length."
    if count > 2800:
        recommendation = "Warning: Approaching 3000 character limit."
    elif len(hashtags) < 3:
        recommendation = "Consider adding 2-3 niche hashtags to increase reach."
        
    return {
        "content": content,
        "character_count": count,
        "has_hashtags": len(hashtags) > 0,
        "suggested_hashtags": ["#marketing", "#saas", "#careers", "#ai"],
        "is_rtcfr_compliant": is_compliant,
        "recommendation": recommendation
    }

@app.post("/posts/{post_id}/publish", response_model=schemas.Post)
async def publish_post(post_id: int, db: Session = Depends(get_db)):
    post = db.query(models.Post).filter(models.Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    try:
        # Load images from local uploads if they exist
        images_to_upload = []
        if post.image_paths:
            filenames = json.loads(post.image_paths)
            for fname in filenames:
                path = os.path.join("uploads", fname)
                if os.path.exists(path):
                    # We create a dummy UploadFile-like object for the service
                    with open(path, "rb") as f:
                        content = f.read()
                        from io import BytesIO
                        # Create a wrapper that matches UploadFile enough for our service
                        class MockUploadFile:
                            def __init__(self, name, data):
                                self.filename = name
                                self.data = data
                            async def read(self):
                                return self.data
                        
                        images_to_upload.append(MockUploadFile(fname, content))

        result = await linkedin_svc.publish_post(post.content, images=images_to_upload)
        post.status = "posted"
        post.linkedin_post_id = result.get("post_urn", "unknown")
        db.commit()
        db.refresh(post)
        return post
    except Exception as e:
        print(f"ERROR: LinkedIn Publish Failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/posts/{post_id}")
def delete_post(post_id: int, db: Session = Depends(get_db)):
    post = db.query(models.Post).filter(models.Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Clean up files from disk
    if post.image_paths:
        try:
            filenames = json.loads(post.image_paths)
            for fname in filenames:
                path = os.path.join("uploads", fname)
                if os.path.exists(path):
                    os.remove(path)
        except Exception as e:
            print(f"ERROR deleting files for post {post_id}: {e}")
            
    db.delete(post)
    db.commit()
    return {"status": "success", "message": "Post and associated files deleted"}

@app.post("/posts/publish-direct")
async def publish_direct(
    text: str = Form(...),
    images: Optional[List[UploadFile]] = File(None)
):
    """Directly publish a post to LinkedIn with optional images."""
    try:
        print(f"DEBUG: Publishing to LinkedIn: Text length {len(text)}, Images: {len(images) if images else 0}")
        result = await linkedin_svc.publish_post(text, images)
        return {"status": "success", "result": result}
    except Exception as e:
        print(f"ERROR: LinkedIn Publish Failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# Admin Control Panel APIs
# ==========================================
# Credentials loaded from .env — never hardcoded in source
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "changeme")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "changeme_token")

def verify_admin(x_admin_token: str = Header(...)):
    if x_admin_token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")

@app.post("/admin/login")
def admin_login(login: schemas.AdminLogin):
    if login.password == ADMIN_PASSWORD:
        return {"token": ADMIN_TOKEN}
    raise HTTPException(status_code=401, detail="Invalid password")

@app.get("/admin/status")
def admin_status(token: str = Depends(verify_admin), db: Session = Depends(get_db)):
    # Check DB — use sqlalchemy.text() to avoid deprecation warning
    try:
        db.execute(text("SELECT 1"))
        db_status = "🟢 Online"
    except:
        db_status = "🔴 Offline"
        
    google_key = os.getenv("GOOGLE_API_KEY")
    linkedin_key = os.getenv("LINKEDIN_ACCESS_TOKEN")
    
    return {
        "backend": "🟢 Online",
        "database": db_status,
        "google_api": "🟢 Configured" if google_key and "your_" not in google_key else "🔴 Missing/Default",
        "linkedin_api": "🟢 Configured" if linkedin_key and "your_" not in linkedin_key else "🔴 Missing/Default"
    }

@app.post("/admin/keys")
def admin_update_keys(env_update: schemas.EnvUpdate, token: str = Depends(verify_admin)):
    env_file = os.path.join(os.path.dirname(__file__), ".env")
    
    # Ensure file exists
    if not os.path.exists(env_file):
        open(env_file, 'a').close()
        
    if env_update.google_api_key:
        set_key(env_file, "GOOGLE_API_KEY", env_update.google_api_key)
        os.environ["GOOGLE_API_KEY"] = env_update.google_api_key
        
    if env_update.linkedin_access_token:
        set_key(env_file, "LINKEDIN_ACCESS_TOKEN", env_update.linkedin_access_token)
        os.environ["LINKEDIN_ACCESS_TOKEN"] = env_update.linkedin_access_token
        
    # Reload the environment
    load_dotenv(env_file)
    
    return {"status": "success", "message": "API keys updated successfully"}
