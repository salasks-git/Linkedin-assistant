import os
import httpx
from typing import Optional, List, Dict, Any
from fastapi import UploadFile

class LinkedInService:
    def __init__(self):
        self.api_base = "https://api.linkedin.com"

    def _get_headers(self) -> Dict[str, str]:
        token = os.getenv("LINKEDIN_ACCESS_TOKEN")
        if not token:
            raise ValueError("LINKEDIN_ACCESS_TOKEN is not set in the environment.")
        return {
            "Authorization": f"Bearer {token}",
            "LinkedIn-Version": "202504",
            "X-Restli-Protocol-Version": "2.0.0",
            "Content-Type": "application/json",
        }

    async def get_user_urn(self) -> str:
        """Fetch the authenticated user's URN via OpenID userinfo."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.api_base}/v2/userinfo",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            return data["sub"]  # Returns the member sub ID like "MmJ2BQgTho"

    async def upload_image(self, person_id: str, file: UploadFile) -> str:
        """Upload an image using the new Images API and return the image URN."""
        headers = self._get_headers()

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

    async def publish_post(self, text: str, images: List[UploadFile] = None) -> Dict[str, Any]:
        """Publish a post using LinkedIn's current Posts API (/rest/posts)."""
        person_id = await self.get_user_urn()
        author = f"urn:li:person:{person_id}"

        # Upload images if provided
        image_urns = []
        if images and len(images) > 0:
            for image_file in images:
                if image_file.filename:  # Skip empty file entries
                    urn = await self.upload_image(person_id, image_file)
                    image_urns.append(urn)

        # Build the post payload
        post_payload = {
            "author": author,
            "commentary": text,
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
            post_payload["content"] = {
                "multiImage": {
                    "images": [{"id": urn} for urn in image_urns]
                }
            }

        headers = self._get_headers()

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
                except:
                    error_msg = response.text
                raise Exception(f"LinkedIn API error ({response.status_code}): {error_msg}")

linkedin_svc = LinkedInService()
