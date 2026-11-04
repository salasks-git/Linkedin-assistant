import os
import json
import uuid
import datetime
import logging
from typing import Optional, Dict, Any, List
from pathlib import Path
from supabase import create_client, Client
from core.config import settings

logger = logging.getLogger("supabase_client")

# Cached client instances
_supabase_admin_client: Optional[Client] = None
_supabase_anon_client: Optional[Client] = None

# In-memory fallback database for local dev when remote Supabase credentials are not set
_local_db = {
    "profiles": {},
    "posts": {}
}


def get_supabase_admin_client() -> Optional[Client]:
    """
    Returns the Supabase client initialized with the SERVICE_ROLE_KEY.
    Used for backend service operations, administrative queries, and managing user data.
    """
    global _supabase_admin_client
    if _supabase_admin_client is not None:
        return _supabase_admin_client

    if settings.is_supabase_configured:
        try:
            _supabase_admin_client = create_client(
                settings.SUPABASE_URL,
                settings.SUPABASE_SERVICE_ROLE_KEY
            )
            logger.info("✅ Supabase admin client initialized successfully.")
            return _supabase_admin_client
        except Exception as e:
            logger.error(f"❌ Failed to initialize Supabase admin client: {e}")
            return None
    else:
        logger.warning("⚠️ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured. Using local fallback.")
        return None


def get_supabase_client() -> Optional[Client]:
    """Alias for get_supabase_admin_client for server-side operations."""
    return get_supabase_admin_client()


def get_supabase_anon_client() -> Optional[Client]:
    """
    Returns the Supabase client initialized with the ANON_KEY.
    Simulates client-side public role access.
    """
    global _supabase_anon_client
    if _supabase_anon_client is not None:
        return _supabase_anon_client

    if settings.SUPABASE_URL and settings.SUPABASE_ANON_KEY:
        try:
            _supabase_anon_client = create_client(
                settings.SUPABASE_URL,
                settings.SUPABASE_ANON_KEY
            )
            return _supabase_anon_client
        except Exception as e:
            logger.error(f"❌ Failed to initialize Supabase anon client: {e}")
            return None
    return None


class SupabaseDBService:
    """
    Centralized database service providing unified operations for 'profiles' and 'posts'
    via the Supabase Python SDK, with graceful fallback support for local testing.
    """

    def __init__(self):
        self.client: Optional[Client] = get_supabase_admin_client()

    def _refresh_client(self):
        if self.client is None and settings.is_supabase_configured:
            self.client = get_supabase_admin_client()

    # =========================================================================
    # PROFILES OPERATIONS
    # =========================================================================

    def get_profile(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Fetch a user profile by user UUID."""
        self._refresh_client()
        if self.client:
            try:
                res = self.client.table("profiles").select("*").eq("id", user_id).execute()
                if res.data and len(res.data) > 0:
                    return res.data[0]
                return None
            except Exception as e:
                logger.error(f"Error fetching profile from Supabase: {e}")
                # Fall through to local fallback

        # Local fallback
        return _local_db["profiles"].get(user_id)

    def upsert_profile(
        self,
        user_id: str,
        email: Optional[str] = None,
        user_gemini_api_key: Optional[str] = None,
        ai_authorized: Optional[bool] = None
    ) -> Dict[str, Any]:
        """Insert or update a profile record."""
        self._refresh_client()
        now_str = datetime.datetime.utcnow().isoformat()

        data: Dict[str, Any] = {
            "id": user_id,
            "updated_at": now_str
        }
        # Other profile operations should preserve OAuth identity fields.
        existing_profile = self.get_profile(user_id)
        if existing_profile:
            data["full_name"] = existing_profile.get("full_name")
            data["avatar_url"] = existing_profile.get("avatar_url")
        if email is not None:
            data["email"] = email
        if user_gemini_api_key is not None:
            data["user_gemini_api_key"] = user_gemini_api_key
        if ai_authorized is not None:
            data["ai_authorized"] = ai_authorized

        if self.client:
            try:
                res = self.client.table("profiles").upsert(data).execute()
                if res.data and len(res.data) > 0:
                    return res.data[0]
            except Exception as e:
                logger.error(f"Error upserting profile in Supabase: {e}")

        # Local fallback
        existing = _local_db["profiles"].get(user_id, {
            "id": user_id,
            "created_at": now_str,
            "ai_authorized": False,
            "user_gemini_api_key": None,
            "email": None
        })
        existing.update({k: v for k, v in data.items() if v is not None})
        _local_db["profiles"][user_id] = existing
        return existing

    def upsert_google_auth_profile(
        self,
        user_id: str,
        email: Optional[str],
        full_name: Optional[str],
        avatar_url: Optional[str],
    ) -> Dict[str, Any]:
        """Create/update public profile fields from a verified Supabase Auth user."""
        self._refresh_client()
        if not self.client:
            raise RuntimeError("Supabase admin client is not configured")

        existing = self.get_profile(user_id) or {}
        data = {
            "id": user_id,
            "email": email,
            "full_name": full_name,
            "avatar_url": avatar_url,
            # Preserve a user's AI setup when their Google profile is refreshed.
            "ai_authorized": bool(existing.get("ai_authorized", False)),
            "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }
        try:
            res = self.client.table("profiles").upsert(data, on_conflict="id").execute()
            if res.data:
                return res.data[0]
            refreshed = self.get_profile(user_id)
            if refreshed:
                return refreshed
            raise RuntimeError("Supabase did not return the saved profile")
        except Exception as e:
            logger.error("Error upserting verified Google profile in Supabase: %s", e)
            raise RuntimeError("Could not save the authenticated profile to Supabase") from e

    def update_ai_auth(self, user_id: str, encrypted_key: Optional[str], ai_authorized: bool) -> Dict[str, Any]:
        """Update a user's AI authorization status and encrypted Gemini key."""
        return self.upsert_profile(
            user_id=user_id,
            user_gemini_api_key=encrypted_key,
            ai_authorized=ai_authorized
        )

    def revoke_ai_auth(self, user_id: str) -> Dict[str, Any]:
        """Revoke user AI authorization and clear stored key."""
        self._refresh_client()
        now_str = datetime.datetime.utcnow().isoformat()
        update_data = {
            "user_gemini_api_key": None,
            "ai_authorized": False,
            "updated_at": now_str
        }

        if self.client:
            try:
                res = self.client.table("profiles").update(update_data).eq("id", user_id).execute()
                if res.data and len(res.data) > 0:
                    return res.data[0]
            except Exception as e:
                logger.error(f"Error revoking AI auth in Supabase: {e}")

        # Local fallback
        profile = _local_db["profiles"].get(user_id, {"id": user_id})
        profile.update(update_data)
        _local_db["profiles"][user_id] = profile
        return profile

    # =========================================================================
    # POSTS / QUEUE OPERATIONS
    # =========================================================================

    def create_post(
        self,
        user_id: str,
        content: str,
        status: str = "draft",
        scheduled_at: Optional[str] = None,
        image_paths: Optional[List[str]] = None,
        linkedin_post_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Create a new post in the posts/queue table."""
        self._refresh_client()
        post_id = str(uuid.uuid4())
        now_str = datetime.datetime.utcnow().isoformat()

        post_data = {
            "id": post_id,
            "user_id": user_id,
            "content": content,
            "status": status,
            "scheduled_at": scheduled_at or now_str,
            "created_at": now_str,
            "updated_at": now_str,
            "image_paths": image_paths or [],
            "linkedin_post_id": linkedin_post_id
        }

        if self.client:
            try:
                res = self.client.table("posts").insert(post_data).execute()
                if res.data and len(res.data) > 0:
                    return res.data[0]
            except Exception as e:
                logger.error(f"Error creating post in Supabase: {e}")

        # Local fallback
        _local_db["posts"][post_id] = post_data
        return post_data

    def get_posts(self, user_id: str, status: Optional[str] = None) -> List[Dict[str, Any]]:
        """Retrieve all posts for a user, optionally filtered by status (draft, scheduled, published)."""
        self._refresh_client()
        if self.client:
            try:
                query = self.client.table("posts").select("*").eq("user_id", user_id)
                if status:
                    query = query.eq("status", status)
                res = query.order("created_at", desc=True).execute()
                if res.data is not None:
                    return res.data
            except Exception as e:
                logger.error(f"Error querying posts from Supabase: {e}")

        # Local fallback
        results = [
            p for p in _local_db["posts"].values()
            if p.get("user_id") == user_id and (status is None or p.get("status") == status)
        ]
        results.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return results

    def get_post(self, post_id: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Retrieve a specific post by ID."""
        self._refresh_client()
        if self.client:
            try:
                query = self.client.table("posts").select("*").eq("id", post_id)
                if user_id:
                    query = query.eq("user_id", user_id)
                res = query.execute()
                if res.data and len(res.data) > 0:
                    return res.data[0]
                return None
            except Exception as e:
                logger.error(f"Error fetching post {post_id} from Supabase: {e}")

        # Local fallback
        post = _local_db["posts"].get(post_id)
        if post and (user_id is None or post.get("user_id") == user_id):
            return post
        return None

    def update_post(self, post_id: str, user_id: Optional[str] = None, **kwargs) -> Optional[Dict[str, Any]]:
        """Update fields of an existing post."""
        self._refresh_client()
        kwargs["updated_at"] = datetime.datetime.utcnow().isoformat()

        if self.client:
            try:
                query = self.client.table("posts").update(kwargs).eq("id", post_id)
                if user_id:
                    query = query.eq("user_id", user_id)
                res = query.execute()
                if res.data and len(res.data) > 0:
                    return res.data[0]
            except Exception as e:
                logger.error(f"Error updating post {post_id} in Supabase: {e}")

        # Local fallback
        post = _local_db["posts"].get(post_id)
        if post and (user_id is None or post.get("user_id") == user_id):
            post.update(kwargs)
            _local_db["posts"][post_id] = post
            return post
        return None

    def delete_post(self, post_id: str, user_id: Optional[str] = None) -> bool:
        """Delete a post by ID."""
        self._refresh_client()
        deleted = False

        if self.client:
            try:
                query = self.client.table("posts").delete().eq("id", post_id)
                if user_id:
                    query = query.eq("user_id", user_id)
                res = query.execute()
                deleted = bool(res.data and len(res.data) > 0)
            except Exception as e:
                logger.error(f"Error deleting post {post_id} in Supabase: {e}")

        # Local fallback
        if post_id in _local_db["posts"]:
            if user_id is None or _local_db["posts"][post_id].get("user_id") == user_id:
                del _local_db["posts"][post_id]
                deleted = True

        return deleted

    # =========================================================================
    # POST IMAGE STORAGE
    # =========================================================================

    def store_post_image(self, user_id: str, filename: str, content: bytes, content_type: str) -> str:
        """Store an image in a private Supabase Storage bucket; use disk only locally."""
        self._refresh_client()
        object_path = f"{user_id}/{filename}"
        if self.client:
            try:
                self.client.storage.from_("post-images").upload(
                    path=object_path,
                    file=content,
                    file_options={
                        "content-type": content_type,
                        "cache-control": "3600",
                        "upsert": "false",
                    },
                )
                return object_path
            except Exception as exc:
                logger.error("Could not store post image in Supabase Storage: %s", exc)
                raise RuntimeError("Could not store the post image") from exc

        local_path = Path(__file__).resolve().parent.parent / "uploads" / object_path
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(content)
        return object_path

    def get_post_image_url(self, object_path: str) -> str:
        """Return a short-lived URL for a private image, or its local dev URL."""
        self._refresh_client()
        if self.client:
            try:
                response = self.client.storage.from_("post-images").create_signed_url(object_path, 86400)
                data = response if isinstance(response, dict) else vars(response)
                signed_url = data.get("signedURL") or data.get("signedUrl")
                if not signed_url:
                    raise RuntimeError("Supabase Storage did not return a signed URL")
                if signed_url.startswith("/"):
                    return f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1{signed_url}"
                return signed_url
            except Exception as exc:
                logger.error("Could not create signed URL for post image: %s", exc)
                raise RuntimeError("Could not access the post image") from exc
        return f"/uploads/{object_path}"

    def download_post_image(self, object_path: str) -> bytes:
        """Read an image for LinkedIn publishing."""
        self._refresh_client()
        if self.client:
            try:
                return self.client.storage.from_("post-images").download(object_path)
            except Exception as exc:
                logger.error("Could not download post image from Supabase Storage: %s", exc)
                raise RuntimeError("Could not load the post image") from exc
        local_path = Path(__file__).resolve().parent.parent / "uploads" / object_path
        return local_path.read_bytes()

    def delete_post_images(self, object_paths: List[str]) -> None:
        """Remove post images from Supabase Storage or local development storage."""
        if not object_paths:
            return
        self._refresh_client()
        if self.client:
            try:
                self.client.storage.from_("post-images").remove(object_paths)
            except Exception as exc:
                logger.error("Could not delete post images from Supabase Storage: %s", exc)
                raise RuntimeError("Could not remove the post images") from exc
            return
        local_root = Path(__file__).resolve().parent.parent / "uploads"
        for object_path in object_paths:
            try:
                (local_root / object_path).unlink(missing_ok=True)
            except OSError as exc:
                logger.warning("Could not remove local post image %s: %s", object_path, exc)

    # =========================================================================
    # MIGRATIONS & SCHEMA RUNNER
    # =========================================================================

    def run_migrations(self, schema_file: Optional[str] = None) -> Dict[str, Any]:
        """
        Executes SQL migration script against the PostgreSQL database if DATABASE_URL
        points to a Postgres instance (e.g. Supabase connection string).
        """
        if not schema_file:
            schema_file = str(Path(__file__).parent / "schema.sql")

        if not os.path.exists(schema_file):
            return {"status": "error", "message": f"Schema file not found at {schema_file}"}

        with open(schema_file, "r") as f:
            sql_script = f.read()

        db_url = settings.DATABASE_URL
        if db_url and (db_url.startswith("postgresql://") or db_url.startswith("postgres://")):
            try:
                import psycopg2
                # Clean URL for psycopg2 if needed
                pg_url = db_url.replace("postgres://", "postgresql://", 1)
                conn = psycopg2.connect(pg_url)
                conn.autocommit = True
                cursor = conn.cursor()
                cursor.execute(sql_script)
                cursor.close()
                conn.close()
                logger.info("✅ Database schema migration executed successfully via psycopg2.")
                return {"status": "success", "message": "Migration executed on PostgreSQL database."}
            except Exception as e:
                logger.error(f"❌ Failed to execute migration via psycopg2: {e}")
                return {"status": "error", "message": str(e)}

        return {
            "status": "ready",
            "message": "Schema SQL is prepared at backend/db/schema.sql. Run via Supabase SQL Editor or direct Postgres connection."
        }


# Global singleton instance
supabase_db = SupabaseDBService()
