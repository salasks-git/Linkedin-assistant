---
description: Run the LinkedIn Assistant MicroSaaS locally using native Python and static servers (No Docker).
---

// turbo-all

# Native Operational Workflow (No Docker)

This workflow provides step-by-step instructions to run the LinkedIn Assistant MicroSaaS natively on your machine using Python and a simple static server.

## Prerequisites
- **Python 3.10+** installed.
- **Google API Key** configured in `.env` (if you want AI drafting features).

## 1. Backend Setup
1. Open a terminal in the `backend/` directory.
2. Initialize a virtual environment:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Start the FastAPI server:
   ```bash
   uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```

## 2. Frontend Setup
1. Open a separate terminal in the `frontend/` directory.
2. Start a lightweight static server (native to Python):
   ```bash
   python3 -m http.server 8080
   ```

## 3. Deployment Check
- **Main Application**: [http://localhost:8080](http://localhost:8080)
- **API Documentation**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Local Database**: Check `backend/posts.db` or `backend/data/posts.db` (if configured via env).

## Troubleshooting
- **CORS Errors**: Ensure the backend `main.py` allows origin `http://localhost:8080`.
- **Port 8000/8080 Busy**: Use `lsof -i :8000` to find and kill the process, or change the port in the startup command.