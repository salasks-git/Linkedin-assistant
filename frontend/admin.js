const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? `http://${window.location.hostname}:8000`
    : window.location.origin.replace(':8080', ':8000');

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

        const healthContainer = document.getElementById('member-health-container');
        if (data.members && data.members.length > 0) {
            let html = `
                <table class="health-table">
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>LinkedIn Name</th>
                            <th>Status</th>
                            <th>Expiry</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            data.members.forEach(m => {
                const badgeClass = m.status.includes('Active') ? 'badge-success' : 'badge-error';
                html += `
                    <tr>
                        <td class="premium-text">${m.username}</td>
                        <td style="color: #ccc">${m.name || '---'}</td>
                        <td><span class="status-badge-mini ${badgeClass}">${m.status}</span></td>
                        <td style="color: ${m.expires_in_days < 7 ? 'var(--error-glow)' : '#aaa'}">
                            ${m.expires_in_days !== null ? `${m.expires_in_days} days left` : 'Expired'}
                        </td>
                    </tr>
                `;
            });
            
            html += `</tbody></table>`;
            healthContainer.innerHTML = html;
        } else {
            healthContainer.innerHTML = '<div class="status-item">No active LinkedIn connections found.</div>';
        }
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
