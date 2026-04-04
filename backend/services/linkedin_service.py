import re
import asyncio
import httpx
import unicodedata
from typing import Optional, List, Dict, Any
from fastapi import UploadFile


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

    def _get_headers(self, custom_token: str = None) -> Dict[str, str]:
        token = custom_token or os.getenv("LINKEDIN_ACCESS_TOKEN")
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
            return data["sub"]  # Returns the member sub ID like "MmJ2BQgTho"

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
            init_response.raise_for_status()
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
            upload_response.raise_for_status()

            return image_urn

    async def publish_post(self, text: str, images: List[UploadFile] = None, token: str = None) -> Dict[str, Any]:
        """Publish a post using LinkedIn's current Posts API (/rest/posts)."""
        person_id = await self.get_user_urn(token)
        author = f"urn:li:person:{person_id}"

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

            print(f"DEBUG LinkedIn Response: {response.status_code} - {response.text}")

            if response.status_code == 201:
                # Success — LinkedIn returns the post URN in the header
                post_urn = response.headers.get("x-restli-id", "unknown")
                return {"status": "published", "post_urn": post_urn}
            else:
                # Parse error details
                try:
                    error_data = response.json()
                    error_msg = error_data.get("message", response.text)
                except Exception:
                    error_msg = response.text
                raise Exception(f"LinkedIn API error ({response.status_code}): {error_msg}")


linkedin_svc = LinkedInService()
