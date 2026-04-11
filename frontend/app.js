// Dynamic API Detection
const API_BASE = "";


// DOM Elements
const el = {
    authOverlay: document.getElementById('gatekeeper-overlay'),
    linkedinOverlay: document.getElementById('linkedin-connect-overlay'),
    // Auth Form
    tabLogin: document.getElementById('tab-login'),
    tabSignup: document.getElementById('tab-signup'),
    authTitle: document.getElementById('auth-title'),
    signupReminder: document.getElementById('signup-reminder'),
    authPasswordHint: document.getElementById('auth-password-hint'),
    authUsername: document.getElementById('auth-username'),
    authPassword: document.getElementById('auth-password'),
    authMasterKey: document.getElementById('auth-master-key'),
    btnAuthSubmit: document.getElementById('btn-auth-submit'),
    authError: document.getElementById('auth-error'),
    showPasswordToggle: document.getElementById('show-password-toggle'),
    // Header & User
    btnHeaderConnect: document.getElementById('btn-header-connect'),
    btnLogout: document.getElementById('btn-logout'),
    appPreviewAvatar: document.getElementById('app-preview-avatar'),
    appPreviewName: document.getElementById('app-preview-name'),
    liPostAvatar: document.getElementById('li-post-avatar'),
    liPostName: document.getElementById('li-post-name'),
    // Editor
    topicInput: document.getElementById('ai-topic'),
    btnDraft: document.getElementById('btn-ai-draft'),
    imageInput: document.getElementById('image-input'),
    promptSelector: document.getElementById('dynamic-prompt-selector'),
    // Metadata
    resourcePersons: document.getElementById('resource-persons'),
    mentors: document.getElementById('mentors'),
    coordinators: document.getElementById('coordinators'),
    // Chat
    chatInput: document.getElementById('chat-input'),
    btnChatSend: document.getElementById('btn-chat-send'),
    chatMessages: document.getElementById('chat-messages'),
    // Preview
    postText: document.getElementById('li-post-text'),
    imageGrid: document.getElementById('li-image-grid'),
    btnCopy: document.getElementById('btn-copy-post'),
    btnSave: document.getElementById('btn-save-post'),
    btnPublish: document.getElementById('btn-publish-direct'),
    // Queue
    btnOpenQueue: document.getElementById('btn-open-queue'),
    btnCloseQueue: document.getElementById('btn-close-queue'),
    queueModal: document.getElementById('queue-modal'),
    queueCount: document.getElementById('queue-count'),
    modalQueueCount: document.getElementById('modal-queue-count'),
    postList: document.getElementById('post-list')
};

// State
let authMode = 'login';
let selectedImages = [];
let postContentBuffer = '';
let isProcessing = false;
let userHasLinkedIn = false;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupAuthListeners();
    setupAppListeners();
    checkAuthStatus();
});

// --- Auth APIs ---
async function checkAuthStatus() {
    try {
        const res = await fetch(`${API_BASE}/auth/check`, {credentials: 'include'});
        const data = await res.json();
        
        if (data.status === 'authenticated') {
            el.authOverlay.style.display = 'none';
            userHasLinkedIn = data.user && data.user.has_linkedin;
            
            if (userHasLinkedIn) {
                el.linkedinOverlay.style.display = 'none';
                fetchPosts(); // Load queue
            } else {
                el.linkedinOverlay.style.display = 'flex';
            }
            
            loadPrompts();
            updateUserInfo(data.user);
        } else {
            el.authOverlay.style.display = 'flex';
            el.linkedinOverlay.style.display = 'none';
        }
    } catch (error) {
        console.error("Auth check failed:", error);
    }
}

function updateUserInfo(user) {
    if (!user) return;
    const name = user.name || user.username || "User";
    const initial = name.charAt(0).toUpperCase();

    el.appPreviewName.textContent = name;
    el.appPreviewAvatar.textContent = initial;
    el.liPostName.textContent = name;
    el.liPostAvatar.textContent = initial;

    if (user.has_linkedin) {
        el.btnHeaderConnect.textContent = "Linked ✅";
        el.btnHeaderConnect.style.display = 'block';
        el.btnHeaderConnect.classList.add('linked');
        el.btnHeaderConnect.onclick = null;
    } else {
        el.btnHeaderConnect.textContent = "Connect LinkedIn";
        el.btnHeaderConnect.style.display = 'block';
        el.btnHeaderConnect.classList.remove('linked');
        el.btnHeaderConnect.onclick = () => window.location.href = `${API_BASE}/auth/linkedin`;
    }
}

function setupAuthListeners() {
    if(el.showPasswordToggle) {
        el.showPasswordToggle.addEventListener('change', (e) => {
            const type = e.target.checked ? 'text' : 'password';
            el.authPassword.type = type;
            el.authMasterKey.type = type;
        });
    }

    const switchAuthMode = (mode) => {
        authMode = mode;
        if (mode === 'signup') {
            el.tabSignup.classList.add('active');
            el.tabLogin.classList.remove('active');
            el.authTitle.textContent = "Create Account";
            el.signupReminder.style.display = 'block';
            el.authPasswordHint.style.display = 'block';
            el.btnAuthSubmit.textContent = "Create & Join";
        } else {
            el.tabLogin.classList.add('active');
            el.tabSignup.classList.remove('active');
            el.authTitle.textContent = "Welcome Back";
            el.signupReminder.style.display = 'none';
            el.authPasswordHint.style.display = 'none';
            el.btnAuthSubmit.textContent = "Unlock Dashboard";
        }
    };

    el.tabLogin.addEventListener('click', () => switchAuthMode('login'));
    el.tabSignup.addEventListener('click', () => switchAuthMode('signup'));

    el.btnAuthSubmit.addEventListener('click', async () => {
        const username = el.authUsername.value.trim();
        const password = el.authPassword.value;

        el.authError.style.display = 'none';
        if (!username || !password) {
            showAuthError("Please fill all fields");
            return;
        }

        const originalText = el.btnAuthSubmit.textContent;
        el.btnAuthSubmit.disabled = true;
        el.btnAuthSubmit.textContent = 'Processing...';

        try {
            const endpoint = authMode === 'signup' ? '/auth/signup' : '/auth/login';
            const res = await fetch(`${API_BASE}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
                credentials: 'include'
            });
            const data = await res.json();
            
            if (res.ok) {
                if (authMode === 'signup') {
                    showAuthError("✅ Account created! Now log in.", '#4ade80');
                    switchAuthMode('login');
                } else {
                    el.authOverlay.style.display = 'none';
                    updateUserInfo({ username, name: data.name });
                    checkAuthStatus();
                }
            } else {
                showAuthError(data.detail || "Authentication Failed");
            }
        } catch (e) {
            showAuthError("Network error.");
        } finally {
            el.btnAuthSubmit.disabled = false;
            el.btnAuthSubmit.textContent = originalText;
        }
    });

    el.btnLogout.addEventListener('click', async () => {
        await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
        window.location.reload();
    });
}

function showAuthError(msg, color = '#ff5555') {
    el.authError.textContent = msg;
    el.authError.style.color = color;
    el.authError.style.display = 'block';
}

// --- App APIs ---
async function loadPrompts() {
    try {
        const res = await fetch(`${API_BASE}/posts/prompts`);
        const data = await res.json();
        el.promptSelector.innerHTML = '';
        data.prompts.forEach((key) => {
            const label = document.createElement('label');
            label.className = 'prompt-option';
            const displayTitle = key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            label.innerHTML = `
                <input type="radio" name="prompt-type" value="${key}" ${key === 'humanized' ? 'checked' : ''}>
                <span class="prompt-chip">${displayTitle}</span>
            `;
            el.promptSelector.appendChild(label);
        });
    } catch(e) { console.error('Failed to load prompts'); }
}

function setupAppListeners() {
    el.btnDraft.addEventListener('click', generateDraft);
    el.btnChatSend.addEventListener('click', refineDraft);
    el.chatInput.addEventListener('keypress', e => e.key === 'Enter' && refineDraft());
    el.postText.addEventListener('input', () => postContentBuffer = el.postText.innerText);
    el.btnCopy.addEventListener('click', () => navigator.clipboard.writeText(postContentBuffer));
    
    el.imageInput.addEventListener('change', (e) => {
        selectedImages = Array.from(e.target.files);
        updateImageGrid();
    });

    el.btnSave.addEventListener('click', saveDraft);
    el.btnPublish.addEventListener('click', publishDirectly);

    el.btnOpenQueue.addEventListener('click', () => el.queueModal.style.display = 'flex');
    el.btnCloseQueue.addEventListener('click', () => el.queueModal.style.display = 'none');
}

async function generateDraft() {
    if (isProcessing) return;
    const topic = el.topicInput.value.trim();
    if (!topic) return alert('Please enter a topic.');

    isProcessing = true;
    el.btnDraft.disabled = true;
    el.btnDraft.innerHTML = '✨ Drafting...';

    const selectedPrompt = document.querySelector('input[name="prompt-type"]:checked')?.value || 'humanized';
    
    try {
        const res = await fetch(`${API_BASE}/posts/generate`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                topic, prompt_type: selectedPrompt, tone: 'professional',
                resource_persons: el.resourcePersons.value,
                mentors: el.mentors.value, coordinators: el.coordinators.value
            }),
            credentials: 'include'
        });
        
        await streamResponse(res, el.postText);
        addChatBubble("Draft generated! How should we perfect it?", "ai");
    } catch(e) {
        alert("Failed to draft.");
    } finally {
        isProcessing = false;
        el.btnDraft.disabled = false;
        el.btnDraft.innerHTML = '✨ Draft with AI';
    }
}

async function refineDraft() {
    if (isProcessing) return;
    const instruction = el.chatInput.value.trim();
    if (!instruction || !postContentBuffer) return;

    addChatBubble(instruction, "user");
    el.chatInput.value = '';
    
    isProcessing = true;
    try {
        const res = await fetch(`${API_BASE}/posts/refine`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ current_content: postContentBuffer, instruction }),
            credentials: 'include'
        });
        await streamResponse(res, el.postText);
        addChatBubble("Updated! Any other changes?", "ai");
    } catch {
        addChatBubble("Error refining draft.", "ai");
    } finally {
        isProcessing = false;
    }
}

async function streamResponse(res, targetEl) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    postContentBuffer = '';
    targetEl.innerText = '';
    
    while(true) {
        const {done, value} = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, {stream: true});
        postContentBuffer += chunk;
        targetEl.innerText = postContentBuffer;
    }
}

function addChatBubble(msg, sender) {
    const div = document.createElement('div');
    div.className = `chat-bubble ${sender}`;
    div.textContent = msg;
    el.chatMessages.appendChild(div);
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
}

function updateImageGrid() {
    el.imageGrid.innerHTML = '';
    el.imageGrid.setAttribute('data-count', selectedImages.length);
    selectedImages.forEach(file => {
        const url = URL.createObjectURL(file);
        const img = document.createElement('img');
        img.src = url;
        el.imageGrid.appendChild(img);
    });
}

// --- Queue & Publish APIs ---
async function fetchPosts() {
    try {
        const res = await fetch(`${API_BASE}/posts/`, { credentials: 'include' });
        const posts = await res.json();
        renderQueue(posts);
    } catch (e) { console.error('Failed to load queue', e); }
}

function renderQueue(posts) {
    el.postList.innerHTML = '';
    el.queueCount.textContent = posts.length;
    el.modalQueueCount.textContent = posts.length;

    posts.forEach(post => {
        const div = document.createElement('div');
        div.className = 'post-item';
        div.innerHTML = `
            <div class="status-badge ${post.status === 'posted' ? 'status-posted' : 'status-draft'}">${post.status}</div>
            <button class="btn-delete-float" onclick="deletePost(${post.id})">✕</button>
            <p class="post-content" style="margin-top: 35px;">${post.content.substring(0, 150)}...</p>
            ${post.image_urls.length ? `<div style="display:flex; gap:5px; margin-top:10px;">${post.image_urls.map(u => `<img src="${u}" style="width:50px; height:50px; object-fit:cover; border-radius:8px;">`).join('')}</div>` : ''}
            <div style="margin-top: 15px; display:flex; justify-content:space-between;">
                ${post.status === 'draft' && userHasLinkedIn ? `<button class="btn-primary-sm" onclick="publishQueuePost(${post.id})">Publish</button>` : ''}
            </div>
        `;
        el.postList.appendChild(div);
    });
}

async function saveDraft() {
    if (!postContentBuffer) return alert('Nothing to save.');
    el.btnSave.disabled = true;
    el.btnSave.textContent = 'Saving...';
    
    const formData = new FormData();
    formData.append("content", postContentBuffer);
    selectedImages.forEach(img => formData.append("images", img));

    try {
        await fetch(`${API_BASE}/posts/`, {
            method: 'POST', body: formData, credentials: 'include'
        });
        fetchPosts();
        alert('Draft saved!');
    } finally {
        el.btnSave.disabled = false;
        el.btnSave.textContent = 'Save Draft';
    }
}

async function publishDirectly() {
    if (!userHasLinkedIn) return alert('Connect LinkedIn first.');
    if (!postContentBuffer) return alert('Nothing to publish.');
    
    el.btnPublish.disabled = true;
    el.btnPublish.textContent = 'Publishing...';
    
    const formData = new FormData();
    formData.append("text", postContentBuffer);
    selectedImages.forEach(img => formData.append("images", img));

    try {
        const res = await fetch(`${API_BASE}/posts/publish-direct`, {
            method: 'POST', body: formData, credentials: 'include'
        });
        if (res.ok) {
            alert('Published successfully!');
            fetchPosts();
        } else {
            const err = await res.json();
            alert('Failed: ' + err.detail);
        }
    } finally {
        el.btnPublish.disabled = false;
        el.btnPublish.textContent = 'Publish Now';
    }
}

window.deletePost = async (id) => {
    if(!confirm("Delete this draft?")) return;
    await fetch(`${API_BASE}/posts/${id}`, {method: 'DELETE', credentials: 'include'});
    fetchPosts();
};

window.publishQueuePost = async (id) => {
    try {
        const res = await fetch(`${API_BASE}/posts/${id}/publish`, {method: 'POST', credentials: 'include'});
        if (res.ok) {
            alert("Published from queue.");
            fetchPosts();
        } else {
            alert("Publish failed.");
        }
    } catch { alert("Network Error"); }
};
