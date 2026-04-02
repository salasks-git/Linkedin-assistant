const API_BASE = 'http://localhost:8000';

const loginSection = document.getElementById('login-section');
const dashSection = document.getElementById('dashboard-section');
const loginError = document.getElementById('login-error');
const statusContainer = document.getElementById('status-container');
const actionFeedback = document.getElementById('action-feedback');

let adminToken = localStorage.getItem('admin_token_v1');

document.addEventListener('DOMContentLoaded', () => {
    if (adminToken) {
        showDashboard();
    } else {
        showLogin();
    }

    document.getElementById('btn-login').addEventListener('click', handleLogin);
    document.getElementById('btn-logout').addEventListener('click', handleLogout);
    document.getElementById('btn-save-keys').addEventListener('click', handleSaveKeys);
    
    // Allow 'Enter' to submit login
    document.getElementById('admin-password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });
});

function showLogin() {
    loginSection.classList.remove('hidden');
    dashSection.classList.add('hidden');
    document.getElementById('admin-password').value = '';
}

function showDashboard() {
    loginSection.classList.add('hidden');
    dashSection.classList.remove('hidden');
    fetchStatus();
}

async function handleLogin() {
    const password = document.getElementById('admin-password').value;
    const btn = document.getElementById('btn-login');
    btn.innerText = "Authenticating...";
    btn.disabled = true;
    loginError.classList.add('hidden');

    try {
        const response = await fetch(`${API_BASE}/admin/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        if (!response.ok) {
            throw new Error('Invalid credentials');
        }

        const data = await response.json();
        adminToken = data.token;
        localStorage.setItem('admin_token_v1', adminToken);
        showDashboard();
    } catch (err) {
        loginError.classList.remove('hidden');
    } finally {
        btn.innerText = "Authenticate";
        btn.disabled = false;
    }
}

function handleLogout() {
    adminToken = null;
    localStorage.removeItem('admin_token_v1');
    showLogin();
}

async function fetchStatus() {
    try {
        const response = await fetch(`${API_BASE}/admin/status`, {
            headers: { 'x-admin-token': adminToken }
        });

        if (response.status === 401) {
            handleLogout();
            return;
        }

        const data = await response.json();
        
        statusContainer.innerHTML = `
            <div class="status-item">
                <span class="status-label">Backend API</span>
                <span class="status-value">${data.backend}</span>
            </div>
            <div class="status-item">
                <span class="status-label">Database</span>
                <span class="status-value">${data.database}</span>
            </div>
            <div class="status-item">
                <span class="status-label">Google Gemini</span>
                <span class="status-value">${data.google_api}</span>
            </div>
            <div class="status-item">
                <span class="status-label">LinkedIn API</span>
                <span class="status-value">${data.linkedin_api}</span>
            </div>
        `;
    } catch (error) {
        statusContainer.innerHTML = `<div class="error-text">Failed to connect to backend server. Is it running?</div>`;
    }
}

async function handleSaveKeys() {
    const googleKey = document.getElementById('input-google-key').value.trim();
    const linkedinKey = document.getElementById('input-linkedin-key').value.trim();
    const btn = document.getElementById('btn-save-keys');

    if (!googleKey && !linkedinKey) {
        showFeedback('Please enter at least one key to update.', 'error-text');
        return;
    }

    btn.innerText = "Saving Configuration...";
    btn.disabled = true;

    try {
        const response = await fetch(`${API_BASE}/admin/keys`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-admin-token': adminToken
            },
            body: JSON.stringify({
                google_api_key: googleKey || null,
                linkedin_access_token: linkedinKey || null
            })
        });

        if (response.status === 401) {
            handleLogout();
            return;
        }
        
        if (!response.ok) throw new Error("Failed to update keys");

        showFeedback('Keys successfully updated to .env!', '#4ade80'); // Green success
        
        // Clear fields
        document.getElementById('input-google-key').value = '';
        document.getElementById('input-linkedin-key').value = '';
        
        // Refresh status to see changes
        fetchStatus();

    } catch (error) {
        showFeedback(error.message, 'var(--error-glow)');
    } finally {
        setTimeout(() => {
            btn.innerText = "Save & Restart Services";
            btn.disabled = false;
        }, 1000);
    }
}

function showFeedback(msg, color) {
    actionFeedback.innerText = msg;
    actionFeedback.style.color = color;
    actionFeedback.classList.remove('hidden');
    setTimeout(() => {
        actionFeedback.classList.add('hidden');
    }, 4000);
}
