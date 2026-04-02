from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List

class PostBase(BaseModel):
    content: str

class PostCreate(PostBase):
    pass

class Post(PostBase):
    id: int
    scheduled_at: datetime
    status: str
    linkedin_post_id: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

class PostPreview(BaseModel):
    content: str
    character_count: int
    has_hashtags: bool
    suggested_hashtags: List[str]
    is_rtcfr_compliant: bool
    recommendation: str

class AIDraftRequest(BaseModel):
    topic: str
    tone: Optional[str] = "professional"
    prompt_type: Optional[str] = "humanized"
    resource_persons: Optional[str] = ""
    coordinators: Optional[str] = ""
    mentors: Optional[str] = ""

class AIRefineRequest(BaseModel):
    current_content: str
    instruction: str
