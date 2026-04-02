---
description: Verify connectivity between Vanilla JS frontend and FastAPI backend.
---

# Full-Stack Verification Workflow

This workflow ensures that the MicroSaaS components are communicating correctly.

## Backend Verification
1. Open [http://localhost:8000/docs](http://localhost:8000/docs).
2. Execute a GET request to `/posts/`.
3. Confirm a successful `200` response, even if the list is empty `[]`.

## Frontend Verification
1. Navigate to `http://localhost:8080`.
2. Create a "Test Post" in the draft editor.
3. Refresh the page to ensure the draft persists (verifying SQLite storage).

## End-to-End Test
1. Click the "Post Now" button on a draft.
2. Confirm the status changes from `draft` to `posted` in the UI.
3. Check backend logs for the `DEBUG: Posting to LinkedIn...` message.
