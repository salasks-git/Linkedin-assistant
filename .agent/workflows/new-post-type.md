---
description: Add a new supported content type (e.g. image, poll) to the platform.
---

# New Content Type Workflow

A systematic approach for expanding the capabilities of the LinkedIn Assistant.

## 1. Backend Model Migration
- [ ] Add the new column or table in `backend/models.py`.
- [ ] Run a migration or restart the app to update the `posts.db` schema.

## 2. API Schema Update
- [ ] Update `backend/schemas.py` to include the new field in `PostBase` and `PostCreate`.
- [ ] Ensure the field is marked as `Optional` if not all posts will use it.

## 3. Frontend Integration
- [ ] Update `frontend/index.html` to include the new input fields (e.g., file input for images).
- [ ] Update `frontend/app.js` to handle the new field in `PostCreate` and `PostPreview` requests.
- [ ] Update `frontend/style.css` to handle any new visual components.

## 4. UI Rendering
- [ ] Modify the `renderPosts` function in `frontend/app.js` to build the new DOM elements (e.g. `<img>` tags).
- [ ] Apply Premium UI Design tokens to maintain the glassmorphism aesthetic.
