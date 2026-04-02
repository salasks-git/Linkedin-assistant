---
name: Native Development Skill
description: Strategies for running and managing MicroSaaS applications locally without Docker.
---

# Native Development Strategy

This skill defines the operational standards and technical optimizations for local (non-containerized) development of the LinkedIn Assistant.

## Virtual Environment Management
- **Folder**: Always use `.venv/` (per user preference).
- **Activation**: Ensure `pip install -r requirements.txt` is run within the active environment.
- **Isolation**: Avoid installing global packages that might conflict with the FastAPI stack.

## Port Assignment & Strategy
- **Backend**: Default to **Port 8000**.
- **Frontend**: Default to **Port 8080** (via `python3 -m http.server`).
- **Conflict Resolution**: If a port is occupied, use `lsof -i :<PORT>` to identify and `kill -9 <PID>` the blocking process.

## Local Persistence (SQLite)
- **Database Path**: `backend/posts.db` by default.
- **Environment**: Use `DATABASE_URL=sqlite:///./posts.db` for local isolation.
- **Migration**: Restarting the FastAPI server automatically creates missing tables via `models.Base.metadata.create_all`.

## AI Service Connectivity
- **Google Gemini API**: Ensure the `GOOGLE_API_KEY` is set in your `.env` file within the `backend/` directory.
- **Model Isolation**: Use `MODEL_NAME=gemini-1.5-flash` for specialized LinkedIn content generation.

## Native Execution Logic
- Always execute backend and frontend in separate background processes to allow parallel logs monitoring.
