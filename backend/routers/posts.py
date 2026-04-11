import os
import json
import uuid
import re
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Body, File, Form, UploadFile, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import models
import schemas
from database import get_db
from utils.auth import get_current_session, get_current_user_token
from services import ai_service
from services.prompts import PROMPTS
from services.linkedin_service import linkedin_svc

router = APIRouter(prefix="/posts", tags=["posts"])

@router.get("/prompts")
def get_prompts():
    return {"prompts": list(PROMPTS.keys())}

@router.post("/", response_model=schemas.Post)
async def create_post(
    content: str = Form(...),
    images: Optional[List[UploadFile]] = File(None),
    db: Session = Depends(get_db),
    session: models.Session = Depends(get_current_session)
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
        user_id=session.user_id,
        content=content, 
        status="draft",
        image_paths=json.dumps(image_filenames) if image_filenames else None
    )
    db.add(db_post)
    db.commit()
    db.refresh(db_post)
    
    post_dict = schemas.Post.model_validate(db_post)
    post_dict.image_urls = [f"/uploads/{f}" for f in image_filenames]
    return post_dict

@router.get("/", response_model=list[schemas.Post])
def get_posts(db: Session = Depends(get_db), session: models.Session = Depends(get_current_session)):
    posts = db.query(models.Post).filter(models.Post.user_id == session.user_id).all()
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

@router.post("/extract-metadata")
async def extract_metadata(payload: dict = Body(...)):
    text = payload.get("text", "")
    if not text:
        return {}
    return await ai_service.extract_metadata(text)

@router.post("/refine")
async def refine_post(request: schemas.AIRefineRequest):
    return StreamingResponse(
        ai_service.refine_linkedin_draft(request.current_content, request.instruction),
        media_type="text/plain"
    )

@router.post("/generate")
async def generate_post(request: schemas.AIDraftRequest):
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

@router.post("/preview", response_model=schemas.PostPreview)
def preview_post(post: schemas.PostBase):
    content = post.content
    count = len(content)
    hashtags = re.findall(r"#\w+", content)
    
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

@router.post("/{post_id}/publish", response_model=schemas.Post)
async def publish_post(post_id: int, request: Request, db: Session = Depends(get_db), session: models.Session = Depends(get_current_session), token: str = Depends(get_current_user_token)):
    post = db.query(models.Post).filter(models.Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    try:
        images_to_upload = []
        if post.image_paths:
            filenames = json.loads(post.image_paths)
            for fname in filenames:
                path = os.path.join("uploads", fname)
                if os.path.exists(path):
                    with open(path, "rb") as f:
                        content = f.read()
                        class MockUploadFile:
                            def __init__(self, name, data):
                                self.filename = name
                                self.data = data
                            async def read(self):
                                return self.data
                        
                        images_to_upload.append(MockUploadFile(fname, content))

        result = await linkedin_svc.publish_post(post.content, images=images_to_upload, token=token)
        post.status = "posted"
        post.linkedin_post_id = result.get("post_urn", "unknown")
        db.commit()
        db.refresh(post)
        return post
    except Exception as e:
        if "LINKEDIN_UNAUTHORIZED" in str(e):
            usr = db.query(models.User).filter(models.User.id == session.user_id).first()
            if usr:
                usr.encrypted_token = None
                usr.linkedin_user_id = None
                db.commit()
        print(f"ERROR: LinkedIn Publish Failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{post_id}")
def delete_post(post_id: int, db: Session = Depends(get_db)):
    post = db.query(models.Post).filter(models.Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
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

@router.post("/publish-direct")
async def publish_direct(
    request: Request,
    text: str = Form(...),
    images: Optional[List[UploadFile]] = File(None),
    token: str = Depends(get_current_user_token),
    session: models.Session = Depends(get_current_session),
    db: Session = Depends(get_db)
):
    try:
        result = await linkedin_svc.publish_post(text, images, token=token)
        return {"status": "success", "result": result}
    except Exception as e:
        if "LINKEDIN_UNAUTHORIZED" in str(e):
            usr = db.query(models.User).filter(models.User.id == session.user_id).first()
            if usr:
                usr.encrypted_token = None
                usr.linkedin_user_id = None
                db.commit()
        print(f"ERROR: LinkedIn Publish Failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
