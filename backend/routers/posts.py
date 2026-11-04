import os
import json
import uuid
import re
import mimetypes
from typing import List, Optional, Union
from fastapi import APIRouter, Depends, HTTPException, Body, File, Form, UploadFile, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import models
import schemas
from database import get_db
from utils.auth import get_current_session, get_current_user_token
from utils.encryption import decrypt_token
from services import ai_service
from services.prompts import PROMPTS
from services.linkedin_service import linkedin_svc
from db.supabase_client import supabase_db

router = APIRouter(prefix="/posts", tags=["posts"])


@router.get("/prompts")
def get_prompts():
    return {"prompts": list(PROMPTS.keys())}


def _get_user_ai_key(user_id: Optional[str], db: Session) -> Optional[str]:
    """Helper to retrieve decrypted AI key from Supabase profiles, with fallback to local user model."""
    if not user_id:
        return None
    profile = supabase_db.get_profile(str(user_id))
    if profile and profile.get("user_gemini_api_key"):
        try:
            return decrypt_token(profile["user_gemini_api_key"])
        except Exception:
            pass

    user = db.query(models.User).filter(models.User.id == user_id).first()
    return user.get_decrypted_ai_key() if user else None


def _image_urls(paths):
    return [supabase_db.get_post_image_url(path) for path in (paths or [])]


@router.post("/", response_model=schemas.Post)
async def create_post(
    content: str = Form(...),
    images: Optional[List[UploadFile]] = File(None),
    db: Session = Depends(get_db),
    session: models.Session = Depends(get_current_session)
):
    """
    Creates a new draft post and persists it directly to the 'posts' table in Supabase.
    """
    user_id = str(session.user_id) if session.user_id else str(uuid.uuid4())
    image_paths = []
    if images:
        for img in images:
            if not img.filename:
                continue
            content_type = (img.content_type or "").lower()
            if content_type not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
                raise HTTPException(status_code=415, detail="Only JPEG, PNG, WebP, and GIF images are supported")
            image_bytes = await img.read(10 * 1024 * 1024 + 1)
            if len(image_bytes) > 10 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="Each image must be 10 MB or smaller")
            extension = mimetypes.guess_extension(content_type) or ".img"
            if extension == ".jpe":
                extension = ".jpg"
            filename = f"{uuid.uuid4()}{extension}"
            image_paths.append(supabase_db.store_post_image(user_id, filename, image_bytes, content_type))

    # 1. Mutate Supabase posts table
    created_post = supabase_db.create_post(
        user_id=user_id,
        content=content,
        status="draft",
        image_paths=image_paths
    )

    # 2. Also save to local SQLite model for redundancy & backward compatibility
    try:
        db_post = models.Post(
            user_id=user_id,
            content=content,
            status="draft",
            image_paths=json.dumps(image_paths) if image_paths else None
        )
        db.add(db_post)
        db.commit()
    except Exception:
        pass

    return schemas.Post(
        id=created_post["id"],
        content=created_post["content"],
        status=created_post.get("status", "draft"),
        scheduled_at=created_post.get("scheduled_at") or created_post.get("created_at"),
        created_at=created_post.get("created_at"),
        linkedin_post_id=created_post.get("linkedin_post_id"),
        image_urls=_image_urls(image_paths)
    )


@router.get("/", response_model=List[schemas.Post])
def get_posts(db: Session = Depends(get_db), session: models.Session = Depends(get_current_session)):
    """
    Retrieves all user posts directly querying the Supabase 'posts' table.
    """
    user_id = str(session.user_id) if session.user_id else ""
    supabase_posts = supabase_db.get_posts(user_id=user_id)

    results = []
    if supabase_posts is not None:
        for p in supabase_posts:
            raw_images = p.get("image_paths") or []
            if isinstance(raw_images, str):
                try:
                    raw_images = json.loads(raw_images)
                except Exception:
                    raw_images = []

            results.append(
                schemas.Post(
                    id=p["id"],
                    content=p["content"],
                    status=p.get("status", "draft"),
                    scheduled_at=p.get("scheduled_at") or p.get("created_at"),
                    created_at=p.get("created_at"),
                    linkedin_post_id=p.get("linkedin_post_id"),
                    image_urls=_image_urls(raw_images)
                )
            )
        return results

    # Fallback to SQLite only if Supabase returned None (e.g. fatal failure)
    posts = db.query(models.Post).filter(models.Post.user_id == session.user_id).all()
    for p in posts:
        post_obj = schemas.Post.model_validate(p)
        if p.image_paths:
            try:
                filenames = json.loads(p.image_paths)
                post_obj.image_urls = _image_urls(filenames)
            except Exception:
                post_obj.image_urls = []
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
async def refine_post(
    request: schemas.AIRefineRequest,
    db: Session = Depends(get_db),
    session: models.Session = Depends(get_current_session)
):
    user_key = _get_user_ai_key(session.user_id, db)
    return StreamingResponse(
        ai_service.refine_linkedin_draft(
            request.current_content,
            request.instruction,
            api_key=user_key
        ),
        media_type="text/plain"
    )


@router.post("/generate")
async def generate_post(
    request: schemas.AIDraftRequest,
    db: Session = Depends(get_db),
    session: models.Session = Depends(get_current_session)
):
    metadata = {
        "resource_persons": request.resource_persons,
        "coordinators": request.coordinators,
        "mentors": request.mentors,
        "tone": request.tone
    }

    user_key = _get_user_ai_key(session.user_id, db)
    if not user_key:
        raise HTTPException(status_code=400, detail={"code": "AI_AUTH_REQUIRED", "message": "Connect a Gemini API key in AI Settings to generate drafts."})
    key_valid, key_error = await ai_service.validate_gemini_api_key(user_key)
    if not key_valid:
        raise HTTPException(status_code=401, detail={"code": "AI_AUTH_INVALID", "message": "Your Gemini API key could not be authorized. Update it in AI Settings.", "diagnostic": key_error})

    return StreamingResponse(
        ai_service.generate_linkedin_draft(
            request.topic,
            request.tone,
            request.prompt_type,
            metadata=metadata,
            api_key=user_key
        ),
        media_type="text/plain"
    )


@router.post("/preview", response_model=schemas.PostPreview)
def preview_post(post: schemas.PostBase):
    content = post.content
    count = len(content)
    hashtags = re.findall(r"#\w+", content)

    has_hook = content.strip().endswith('?') or any(
        content.split('\n')[0].lower().startswith(x) for x in ['why', 'how', 'when', 'if', 'the']
    )

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
async def publish_post(
    post_id: Union[str, int],
    request: Request,
    db: Session = Depends(get_db),
    session: models.Session = Depends(get_current_session),
    token: str = Depends(get_current_user_token)
):
    """
    Publishes a post to LinkedIn and mutates status in the Supabase 'posts' table.
    """
    post_id_str = str(post_id)
    user_id = str(session.user_id) if session.user_id else ""
    post_data = supabase_db.get_post(post_id_str, user_id=user_id)
    
    # Fallback to local DB if not found in Supabase
    db_post = None
    if not post_data and post_id_str.isdigit():
        db_post = db.query(models.Post).filter(
            models.Post.id == int(post_id_str), models.Post.user_id == user_id
        ).first()

    if not post_data and not db_post:
        raise HTTPException(status_code=404, detail="Post not found")

    content = post_data["content"] if post_data else db_post.content
    raw_images = post_data.get("image_paths") if post_data else db_post.image_paths
    if isinstance(raw_images, str):
        try:
            raw_images = json.loads(raw_images)
        except Exception:
            raw_images = []

    try:
        images_to_upload = []
        if raw_images:
            for fname in raw_images:
                data = supabase_db.download_post_image(fname)

                class MockUploadFile:
                    def __init__(self, name, d):
                        self.filename = name
                        self.data = d

                    async def read(self):
                        return self.data

                images_to_upload.append(MockUploadFile(os.path.basename(fname), data))

        result = await linkedin_svc.publish_post(content, images=images_to_upload, token=token)
        post_urn = result.get("post_urn", "unknown")

        # Mutate Supabase status
        updated_post = supabase_db.update_post(
            post_id=post_id_str,
            user_id=user_id,
            status="published",
            linkedin_post_id=post_urn
        )

        if db_post:
            db_post.status = "posted"
            db_post.linkedin_post_id = post_urn
            db.commit()

        return schemas.Post(
            id=post_id,
            content=content,
            status="published",
            scheduled_at=post_data.get("scheduled_at") if post_data else db_post.scheduled_at,
            created_at=post_data.get("created_at") if post_data else db_post.created_at,
            linkedin_post_id=post_urn,
            image_urls=_image_urls(raw_images)
        )
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
def delete_post(
    post_id: Union[str, int],
    db: Session = Depends(get_db),
    session: models.Session = Depends(get_current_session)
):
    """
    Deletes a post and its associated image files from Supabase 'posts' table.
    """
    post_id_str = str(post_id)
    user_id = str(session.user_id) if session.user_id else ""
    post_data = supabase_db.get_post(post_id_str, user_id=user_id)
    
    # Check image files to clean up
    raw_images = post_data.get("image_paths") if post_data else None
    if isinstance(raw_images, str):
        try:
            raw_images = json.loads(raw_images)
        except Exception:
            raw_images = []

    db_post = None
    if not post_data and post_id_str.isdigit():
        db_post = db.query(models.Post).filter(
            models.Post.id == int(post_id_str), models.Post.user_id == user_id
        ).first()
    if not post_data and not db_post:
        raise HTTPException(status_code=404, detail="Post not found")

    if raw_images:
        supabase_db.delete_post_images(raw_images)

    # Delete from Supabase
    supabase_db.delete_post(post_id_str, user_id=user_id)

    # Also delete from local db if present
    if post_id_str.isdigit():
        db_post = db_post or db.query(models.Post).filter(
            models.Post.id == int(post_id_str), models.Post.user_id == user_id
        ).first()
        if db_post:
            db.delete(db_post)
            db.commit()
    elif post_data and post_data.get("content"):
        try:
            db_posts = db.query(models.Post).filter(
                models.Post.content == post_data["content"], models.Post.user_id == user_id
            ).all()
            for dp in db_posts:
                db.delete(dp)
            db.commit()
        except Exception:
            pass

    return {"status": "success", "message": "Post and associated files deleted from Supabase"}


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
