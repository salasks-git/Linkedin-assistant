from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List, Union

class PostBase(BaseModel):
    content: str

class PostCreate(PostBase):
    pass

class Post(PostBase):
    id: Union[str, int]
    scheduled_at: Optional[Union[datetime, str]] = None
    status: str
    linkedin_post_id: Optional[str] = None
    image_urls: List[str] = []
    created_at: Optional[Union[datetime, str]] = None

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

class UserSignup(BaseModel):
    username: str
    password: str

class UserLogin(BaseModel):
    username: str
    password: str

class UserAIAuthRequest(BaseModel):
    api_key: str
    provider: Optional[str] = "gemini"
    validate_key: Optional[bool] = True

class UserAIAuthResponse(BaseModel):
    status: str
    provider: str
    masked_key: str
    authorized_at: datetime
    message: str

class UserOut(BaseModel):
    id: str
    username: Optional[str]
    name: Optional[str]
    has_linkedin: bool
    has_ai_auth: bool = False
    ai_provider: Optional[str] = None
    masked_ai_key: Optional[str] = None
    ai_authorized_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class AdminLogin(BaseModel):
    password: str

class LinkedInHealth(BaseModel):
    username: str
    name: Optional[str]
    expires_in_days: Optional[int]
    status: str

class AdminStatus(BaseModel):
    backend: str
    database: str
    google_api: str
    linkedin_api: str
    members: List[LinkedInHealth] = []

class EnvUpdate(BaseModel):
    google_api_key: Optional[str] = None
    linkedin_access_token: Optional[str] = None
