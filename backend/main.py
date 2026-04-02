from fastapi import FastAPI, Depends, HTTPException, Body
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import models, schemas, database
from database import engine, get_db
from services import ai_service
import re

# Create database tables
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="LinkedIn Assistant API")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://localhost:80",
        "http://localhost:8080",
        "http://127.0.0.1",
        "http://127.0.0.1:80",
        "http://127.0.0.1:8080",
        "*", # Temporary allow all for easy native development
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "LinkedIn Assistant Backend is running!"}

@app.post("/posts/", response_model=schemas.Post)
def create_post(post: schemas.PostCreate, db: Session = Depends(get_db)):
    db_post = models.Post(content=post.content, status="draft")
    db.add(db_post)
    db.commit()
    db.refresh(db_post)
    return db_post

@app.get("/posts/", response_model=list[schemas.Post])
def get_posts(db: Session = Depends(get_db)):
    return db.query(models.Post).all()

@app.post("/posts/generate")
async def generate_post(request: schemas.AIDraftRequest):
    return StreamingResponse(
        ai_service.generate_linkedin_draft(request.topic, request.tone, request.prompt_type),
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
def publish_post(post_id: int, db: Session = Depends(get_db)):
    post = db.query(models.Post).filter(models.Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Simulate LinkedIn posting
    print(f"DEBUG: Posting to LinkedIn: {post.content}")
    post.status = "posted"
    post.linkedin_post_id = f"urn:li:share:{post_id}"
    db.commit()
    db.refresh(post)
    return post
