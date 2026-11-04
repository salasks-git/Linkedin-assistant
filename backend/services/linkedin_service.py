import os
import re
import asyncio
import json
import logging
from urllib.parse import urlencode
import httpx
import unicodedata
from typing import Optional, List, Dict, Any
from fastapi import UploadFile
from core.config import settings

logger = logging.getLogger(__name__)


def sanitize_for_linkedin(text: str) -> str:
    """
    Sanitize text for LinkedIn API commentary field.
    1. Removes invisible/special Unicode control characters.
    2. Escapes characters that LinkedIn treats as special symbols (mentors, formatting).
       Without escaping, brackets and parentheses often trigger silent truncation.
    """
    # Remove invisible Unicode control characters (Cf/Cc) but keep newlines/tabs
    text = ''.join(
        c for c in text
        if unicodedata.category(c) not in ('Cf', 'Cc') or c in ('\n', '\t')
    )
    
    # Normalize line endings
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    
    # Remove zero-width marks
    text = re.sub(r'[\u200b\u200c\u200d\ufeff\u00ad\u2028\u2029]', '', text)
    
    # Escape special characters that trigger LinkedIn parser truncation: ()[]*@<>\~_
    # Prefixing with backslash tells LinkedIn to treat them as literals.
    text = re.sub(r'([()\[\]*@<>\~_])', r'\\\1', text)
    
    # Collapse 3+ consecutive newlines
    text = re.sub(r'\n{3,}', '\n\n', text)
    
    # Hard limit: 3000 chars (after escaping)
    return text[:3000].strip()


class LinkedInService:
    def __init__(self):
        self.api_base = "https://api.linkedin.com"
        # System-level client credentials managed strictly by server/admin environment
        self.client_id = settings.LINKEDIN_CLIENT_ID
        self.client_secret = settings.LINKEDIN_CLIENT_SECRET
        self.redirect_uri = settings.LINKEDIN_REDIRECT_URI

    def get_authorization_url(
        self,
        scope: str = "w_member_social profile openid email",
        redirect_uri: Optional[str] = None,
    ) -> str:
        """Construct authorization URL using system-level OAuth credentials."""
        if not self.client_id:
            raise ValueError("LINKEDIN_CLIENT_ID is not configured in system settings.")
        params = {
            "response_type": "code",
            "client_id": self.client_id,
            "redirect_uri": redirect_uri or self.redirect_uri,
            "scope": scope,
        }
        return f"https://www.linkedin.com/oauth/v2/authorization?{urlencode(params)}"

    async def exchange_code_for_token(
        self, code: str, redirect_uri: Optional[str] = None
    ) -> Dict[str, Any]:
        """Exchange authorization code for access token using system-level credentials."""
        if not all([self.client_id, self.client_secret]):
            raise ValueError("LINKEDIN_CLIENT_ID or LINKEDIN_CLIENT_SECRET is not configured in system settings.")

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://www.linkedin.com/oauth/v2/accessToken",
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "redirect_uri": redirect_uri or self.redirect_uri
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            )
            if response.status_code != 200:
                raise Exception(f"Failed to retrieve token from LinkedIn ({response.status_code}): {response.text}")
            return response.json()

    def _get_headers(self, custom_token: str = None) -> Dict[str, str]:
        token = (custom_token or settings.LINKEDIN_ACCESS_TOKEN or "").strip()
        if not token:
            raise ValueError("LINKEDIN_ACCESS_TOKEN is not set in the environment or passed.")
        return {
            "Authorization": f"Bearer {token}",
            "LinkedIn-Version": "202504",
            "X-Restli-Protocol-Version": "2.0.0",
            "Content-Type": "application/json",
        }

    async def get_user_urn(self, token: str = None) -> str:
        """Fetch the authenticated user's URN via OpenID userinfo."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.api_base}/v2/userinfo",
                headers=self._get_headers(token)
            )
            if response.status_code == 401:
                raise Exception("LINKEDIN_UNAUTHORIZED")
            response.raise_for_status()
            data = response.json()
        subject = data["sub"]  # OpenID subject is the member ID.
        return subject.removeprefix("urn:li:person:")

    @staticmethod
    def _raise_linkedin_error(response: httpx.Response, operation: str) -> None:
        try:
            body = response.json()
            body_text = json.dumps(body, ensure_ascii=False)
        except (ValueError, TypeError):
            body_text = response.text
        logger.error("LinkedIn %s failed: status=%s response=%s", operation, response.status_code, body_text)
        raise httpx.HTTPStatusError(
            f"LinkedIn {operation} failed ({response.status_code}): {body_text}",
            request=response.request,
            response=response,
        )

    async def upload_image(self, person_id: str, file: UploadFile, token: str = None) -> str:
        """Upload an image using the new Images API and return the image URN."""
        headers = self._get_headers(token)

        # Step 1: Initialize Upload
        init_payload = {
            "initializeUploadRequest": {
                "owner": f"urn:li:person:{person_id}"
            }
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            init_response = await client.post(
                f"{self.api_base}/rest/images?action=initializeUpload",
                headers=headers,
                json=init_payload
            )
            if not init_response.is_success:
                self._raise_linkedin_error(init_response, "image upload initialization")
            init_data = init_response.json()

            image_urn = init_data["value"]["image"]
            upload_url = init_data["value"]["uploadUrl"]

            # Step 2: Upload Binary
            file_content = await file.read()
            import mimetypes
            content_type = mimetypes.guess_type(file.filename)[0] or "application/octet-stream"

            # Binary upload URLs do NOT require Authorization or LinkedIn API headers
            upload_headers = {
                "Content-Type": content_type,
            }
            upload_response = await client.put(
                upload_url,
                content=file_content,
                headers=upload_headers
            )
            if not upload_response.is_success:
                self._raise_linkedin_error(upload_response, "image binary upload")

            return image_urn

    async def publish_post(self, text: str, images: List[UploadFile] = None, token: str = None) -> Dict[str, Any]:
        """Publish a post using LinkedIn's current Posts API (/rest/posts)."""
        person_id = await self.get_user_urn(token)
        author = person_id if person_id.startswith("urn:li:") else f"urn:li:person:{person_id}"

        # Upload images if provided (Parallel)
        image_urns = []
        if images and len(images) > 0:
            # Create a list of upload tasks to run in parallel
            upload_tasks = [
                self.upload_image(person_id, img, token) 
                for img in images if img.filename
            ]
            if upload_tasks:
                image_urns = await asyncio.gather(*upload_tasks)

        # ✅ FIX: Sanitize text before sending to prevent LinkedIn silent truncation
        # on invisible Unicode characters (zero-width spaces, non-breaking spaces,
        # line separators, etc.) that AI models like Gemini routinely output.
        sanitized_text = sanitize_for_linkedin(text)

        # DEBUG: Log exactly what is being sent so truncation is visible in logs
        print(f"DEBUG: LinkedIn Publish Triggered")
        print(f"DEBUG: Original Length: {len(text)} chars | Sanitized Length: {len(sanitized_text)} chars")
        print(f"DEBUG: Payload Start: {sanitized_text[:80]}...")
        print(f"DEBUG: Payload End:   ...{sanitized_text[-80:]}")

        # Build the post payload with sanitized text (single clean payload)
        post_payload = {
            "author": author,
            "commentary": sanitized_text,
            "visibility": "PUBLIC",
            "distribution": {
                "feedDistribution": "MAIN_FEED",
                "targetEntities": [],
                "thirdPartyDistributionChannels": []
            },
            "lifecycleState": "PUBLISHED",
            "isReshareDisabledByAuthor": False
        }

        # Add images if uploaded
        if image_urns:
            if len(image_urns) == 1:
                post_payload["content"] = {
                    "media": {
                        "id": image_urns[0]
                    }
                }
            else:
                post_payload["content"] = {
                    "multiImage": {
                        "images": [{"id": urn} for urn in image_urns]
                    }
                }

        headers = self._get_headers(token)

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{self.api_base}/rest/posts",
                headers=headers,
                json=post_payload
            )

            if response.status_code in (200, 201):
                # Success — LinkedIn returns the post URN in the header
                post_urn = response.headers.get("x-restli-id", "unknown")
                return {"status": "published", "post_urn": post_urn}
            self._raise_linkedin_error(response, "post publish")


linkedin_svc = LinkedInService()
