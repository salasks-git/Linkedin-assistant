#!/bin/bash

# Configuration
BACKEND_PORT=8000
FRONTEND_PORT=8080
BACKEND_DIR="backend"
FRONTEND_DIR="frontend"

echo "🚀 Starting LinkedIn Assistant (Native Vanilla JS/CSS/HTML)..."

# 1. Cleanup existing processes
echo "🧹 Cleaning up existing processes on ports $BACKEND_PORT and $FRONTEND_PORT..."
lsof -i :$BACKEND_PORT -t | xargs kill -9 2>/dev/null
lsof -i :$FRONTEND_PORT -t | xargs kill -9 2>/dev/null

# 2. Start Backend (background)
echo "🐍 Starting Backend (FastAPI) on port $BACKEND_PORT..."
if [ -f "$BACKEND_DIR/.venv/bin/activate" ]; then
    (cd "$BACKEND_DIR" && export GRPC_DNS_RESOLVER=native && ./.venv/bin/uvicorn main:app --host 0.0.0.0 --port $BACKEND_PORT --reload) &
    BACKEND_PID=$!
else
    echo "❌ Error: Virtual environment (.venv) not found in $BACKEND_DIR/."
    exit 1
fi

# 3. Start Frontend (foreground)
echo "🌐 Starting Frontend (Vanilla JS) on port $FRONTEND_PORT..."
echo "👉 Access the app at: http://localhost:$FRONTEND_PORT"

# Use a trap to kill the backend when the frontend/script is stopped
trap "kill $BACKEND_PID 2>/dev/null; exit" INT TERM EXIT

(cd "$FRONTEND_DIR" && python3 -m http.server $FRONTEND_PORT)
