const API_BASE = 'http://localhost:8000';

// DOM Elements
const postContent = document.getElementById('post-content');
const aiTopic = document.getElementById('ai-topic');
const btnAIDraft = document.getElementById('btn-ai-draft');
const btnSavePost = document.getElementById('btn-save-post');
const postList = document.getElementById('post-list');
const postCount = document.getElementById('post-count');
const reportContainer = document.getElementById('report-container');
const imageInput = document.getElementById('image-input');
const liPostText = document.getElementById('li-post-text');
const liImageGrid = document.getElementById('li-image-grid');

let isProcessing = false;
let selectedImages = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    fetchPosts();
    setupEventListeners();
});

function setupEventListeners() {
    // Real-time Preview logic
    let debounceTimer;
    postContent.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(handlePreview, 500);
    });

    // AI Drafting
    btnAIDraft.addEventListener('click', handleAIDraft);

    // Saving
    btnSavePost.addEventListener('click', handleSavePost);

    // Image Input
    imageInput.addEventListener('change', handleImageUpload);
}

// API Functions
async function fetchPosts() {
    try {
        const response = await fetch(`${API_BASE}/posts/`);
        const posts = await response.json();
        renderPosts(posts);
    } catch (error) {
        console.error('Error fetching posts:', error);
    }
}

async function handlePreview() {
    const content = postContent.value;
    
    // Update LinkedIn Preview immediately
    updateLinkedInPreview(content);

    if (!content.trim()) {
        reportContainer.innerHTML = '<p class="placeholder-text">Start typing to see real-time professional analysis...</p>';
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/posts/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        const report = await response.json();
        renderReport(report);
    } catch (error) {
        console.error('Error fetching preview:', error);
    }
}

function handleImageUpload(e) {
    const files = Array.from(e.target.files);
    selectedImages = files;
    renderImageGrid(files);
}

function updateLinkedInPreview(text) {
    if (!text.trim()) {
        liPostText.innerHTML = 'Draft your professional story...';
        return;
    }
    
    // Highlight hashtags
    const formatted = text.replace(/#(\w+)/g, '<span class="li-hashtag">#$1</span>');
    liPostText.innerHTML = formatted;
}

function renderImageGrid(files) {
    liImageGrid.innerHTML = '';
    liImageGrid.setAttribute('data-count', files.length);

    if (files.length === 0) return;

    files.slice(0, 4).forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const div = document.createElement('div');
            div.className = 'media-item-wrapper';
            if (index === 3 && files.length > 4) {
                div.className += ' media-overlay';
                div.innerHTML = `
                    <img src="${e.target.result}" class="media-item">
                    <div class="media-more">+${files.length - 4}</div>
                `;
            } else {
                div.innerHTML = `<img src="${e.target.result}" class="media-item">`;
            }
            liImageGrid.appendChild(div);
        };
        reader.readAsDataURL(file);
    });
}

async function handleAIDraft() {
    const topic = aiTopic.value.trim();
    if (!topic || isProcessing) return;

    // Get selected prompt type
    const selectedPrompt = document.querySelector('input[name="prompt-type"]:checked').value;

    setLoading(true, 'btn-ai-draft', 'Drafting...');
    postContent.value = ''; // Clear for streaming
    
    try {
        const response = await fetch(`${API_BASE}/posts/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                topic,
                prompt_type: selectedPrompt 
            })
        });

        if (!response.body) throw new Error('Response body is null');
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            
            // Check for service-level errors
            if (chunk.includes('[SERVICE_ERROR]')) {
                const errorMsg = chunk.replace('[SERVICE_ERROR]', '').trim();
                showServiceAlert(errorMsg);
                break; // Stop processing the stream on error
            }
            
            postContent.value += chunk;
            
            // Re-trigger preview and LinkedIn layout update for each chunk
            handlePreview();
        }
        
        aiTopic.value = '';
    } catch (error) {
        console.error('Error generating AI draft:', error);
        postContent.value = `Error: ${error.message}. Please check your connection.`;
    } finally {
        setLoading(false, 'btn-ai-draft', 'Draft with AI');
    }
}

async function handleSavePost() {
    const content = postContent.value.trim();
    if (!content || isProcessing) return;

    setLoading(true, 'btn-save-post', 'Saving...');
    try {
        await fetch(`${API_BASE}/posts/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        postContent.value = '';
        reportContainer.innerHTML = '<p class="placeholder-text">Start typing to see real-time professional analysis...</p>';
        fetchPosts();
    } catch (error) {
        console.error('Error saving post:', error);
    } finally {
        setLoading(false, 'btn-save-post', 'Save to Queue');
    }
}

async function handlePublish(id) {
    if (isProcessing) return;

    setLoading(true);
    try {
        await fetch(`${API_BASE}/posts/${id}/publish`, { method: 'POST' });
        fetchPosts();
    } catch (error) {
        console.error('Error publishing post:', error);
    } finally {
        setLoading(false);
    }
}

// Rendering Logic
function renderPosts(posts) {
    postList.innerHTML = '';
    postCount.innerText = `${posts.length} Items`;

    if (posts.length === 0) {
        postList.innerHTML = `
            <div class="glass-card" style="grid-column: 1 / -1; text-align: center; padding: 4rem;">
                <p style="color: var(--text-secondary); font-size: 1.2rem; margin: 0;">
                    Your queue is empty. Start drafting to see your content here!
                </p>
            </div>
        `;
        return;
    }

    posts.slice().reverse().forEach((post, index) => {
        const card = document.createElement('div');
        card.className = 'post-item glass-card';
        card.style.animationDelay = `${0.1 + (index * 0.05)}s`;
        
        card.innerHTML = `
            <div class="status-badge status-${post.status.toLowerCase()}">${post.status}</div>
            <p class="post-content">${post.content}</p>
            <div class="post-footer">
                <div class="post-meta">
                    <span class="meta-label">Created</span>
                    <span class="meta-value">${new Date(post.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                </div>
                ${post.status.toLowerCase() === 'draft' ? 
                    `<button class="btn btn-action" onclick="handlePublish(${post.id})">Post Now</button>` : ''}
            </div>
        `;
        postList.appendChild(card);
    });
}

function renderReport(report) {
    reportContainer.innerHTML = `
        <div class="report-item">
            <span class="report-label">Hook Analysis</span>
            <span class="report-value" style="color: ${report.is_rtcfr_compliant ? '#4ade80' : '#fbbf24'}">
                ${report.is_rtcfr_compliant ? 'Strong Hook' : 'Weak Hook'}
            </span>
        </div>
        <div class="report-item">
            <span class="report-label">Character Count</span>
            <span class="report-value" style="color: ${report.character_count > 3000 ? '#ef4444' : 'var(--text-primary)'}">
                ${report.character_count} / 3000
            </span>
        </div>
        <div class="recommendation-box">
            <strong>Recommendation</strong>
            <p>"${report.recommendation}"</p>
        </div>
    `;
}

// UI Helpers
function showServiceAlert(message) {
    // Remove existing alert if any
    const existing = document.querySelector('.service-alert');
    if (existing) existing.remove();

    const alert = document.createElement('div');
    alert.className = 'service-alert';
    alert.innerHTML = `
        <span class="alert-icon">⚠️</span>
        <div class="alert-content">
            <strong>Google API Message</strong>
            <p>${message}</p>
        </div>
    `;
    
    // Insert at top of post-editor
    const editor = document.querySelector('.post-editor');
    editor.insertBefore(alert, editor.firstChild);

    // Auto-remove after 8 seconds
    setTimeout(() => {
        if (alert.parentNode) alert.remove();
    }, 8000);
}

function setLoading(loading, btnId, text) {
    isProcessing = loading;
    if (btnId) {
        const btn = document.getElementById(btnId);
        btn.disabled = loading;
        btn.innerText = text;
    }
}
