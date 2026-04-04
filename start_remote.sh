#!/bin/bash

# Configuration
APP_DIR="/Users/salas/Desktop/linkdin asist"

echo "=========================================="
echo " Starting LinkedIn Assistant (Single Server)"
echo "=========================================="

# 1. Kill old processes
echo "[1/3] Cleaning up old processes..."
kill -9 $(lsof -t -i:8000) 2>/dev/null
pkill ngrok

# 2. Start Unified Server locally
echo "[2/3] Starting Unified Backend+Frontend Server..."
cd "$APP_DIR/backend"
nohup .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 > /tmp/server.log 2>&1 &

# 3. Start Ngrok
echo "[3/3] Starting ngrok tunnel..."
cd "$APP_DIR"
nohup ngrok http 8000 > /tmp/ngrok.log 2>&1 &

# Wait for ngrok to establish connection
sleep 4

# 4. Extract URL via Python and inject configuration
echo "[4/4] Establishing configuration..."

python3 - << 'EOF'
import urllib.request
import json
import re
import os

APP_DIR = "/Users/salas/Desktop/linkdin asist"
ENV_FILE = os.path.join(APP_DIR, "backend/.env")

try:
    req = urllib.request.Request("http://127.0.0.1:4040/api/tunnels")
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode())
        
    tunnels = data.get("tunnels", [])
    public_url = ""
    
    if len(tunnels) > 0:
        public_url = tunnels[0]["public_url"]
            
    if not public_url:
        print("ERROR: Could not find ngrok tunnel.")
        exit(1)
        
    # Upgrade to HTTPS if ngrok returns HTTP
    public_url = public_url.replace("http://", "https://")
    
    # 2. Update backend/.env LINKEDIN_REDIRECT_URI
    with open(ENV_FILE, "r") as f:
        env_content = f.read()
        
    redirect_val = f"{public_url}/auth/linkedin/callback"
    if "LINKEDIN_REDIRECT_URI" in env_content:
        env_content = re.sub(
            r'LINKEDIN_REDIRECT_URI=.*',
            f'LINKEDIN_REDIRECT_URI={redirect_val}',
            env_content
        )
    else:
        env_content += f"\nLINKEDIN_REDIRECT_URI={redirect_val}\n"
        
    with open(ENV_FILE, "w") as f:
        f.write(env_content)
        
    print("\n✅ Setup Complete!")
    print("======================================================")
    print(f"👉 Application URL:   {public_url}")
    print("======================================================")
    print("")
    print("IMPORTANT MANUAL STEP:")
    print("Please copy the URL below and paste it into your LinkedIn Developer Console")
    print("under 'Authorized redirect URLs for your app':")
    print(f"--> {redirect_val} <--")
    
except Exception as e:
    print(f"Python script error: {e}")
EOF
