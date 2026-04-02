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

// Dynamic references
const resourcePersonsInput = document.getElementById('resource-persons');
const mentorsInput = document.getElementById('mentors');
const coordinatorsInput = document.getElementById('coordinators');
const promptSelectorContainer = document.getElementById('dynamic-prompt-selector');

// Chat references
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const btnChatSend = document.getElementById('btn-chat-send');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    fetchPosts();
    loadPrompts(); // Load style chips from backend
    setupEventListeners();
});

async function loadPrompts() {
    try {
        const response = await fetch(`${API_BASE}/posts/prompts`);
        const data = await response.json();
        
        if (data.prompts && data.prompts.length > 0) {
            renderPromptChips(data.prompts);
        }
    } catch (error) {
        console.error('Error loading prompts:', error);
        promptSelectorContainer.innerHTML = '<span class="error-text">Failed to load styles.</span>';
    }
}

function renderPromptChips(prompts) {
    promptSelectorContainer.innerHTML = '';
    
    prompts.forEach((key, index) => {
        const label = document.createElement('label');
        label.className = 'prompt-option';
        
        const isChecked = key === 'humanized' ? 'checked' : '';
        // Prettify keys: project_learning -> Project Learning
        const displayTitle = key.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        
        label.innerHTML = `
            <input type="radio" name="prompt-type" value="${key}" ${isChecked}>
            <span class="prompt-chip">${displayTitle}</span>
        `;
        promptSelectorContainer.appendChild(label);
    });
}

function setupEventListeners() {
    // Sync Preview edit changes back to history logic
    liPostText.addEventListener('input', () => {
        handlePreview(); // Still triggers analysis
    });

    // AI Drafting - Enter to draft, Shift+Enter for new line
    aiTopic.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleAIDraft();
        }
    });

    btnAIDraft.addEventListener('click', handleAIDraft);

    // Saving
    btnSavePost.addEventListener('click', handleSavePost);

    // Image Input
    imageInput.addEventListener('change', handleImageUpload);

    // Chat Refinement
    btnChatSend.addEventListener('click', handleAIRefine);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAIRefine();
        }
    });
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
    const content = liPostText.innerText; // Get text from contenteditable
    
    if (!content.trim() || content === 'Draft your professional story...') {
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
    const selectedPromptEl = document.querySelector('input[name="prompt-type"]:checked');
    const selectedPrompt = selectedPromptEl ? selectedPromptEl.value : 'humanized';

    setLoading(true, 'btn-ai-draft', 'Processing...');
    liPostText.innerHTML = ''; // Clear for streaming

    // Smooth scroll to results immediately
    document.getElementById('linkedin-preview-container').scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    try {
        // Step 1: Extract Metadata (Mentors, etc.) if fields are empty
        if (!resourcePersonsInput.value.trim() && !mentorsInput.value.trim() && !coordinatorsInput.value.trim()) {
            try {
                const extractionRes = await fetch(`${API_BASE}/posts/extract-metadata`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: topic })
                });
                const meta = await extractionRes.json();
                if (meta.resource_persons) resourcePersonsInput.value = meta.resource_persons;
                if (meta.mentors) mentorsInput.value = meta.mentors;
                if (meta.coordinators) coordinatorsInput.value = meta.coordinators;
            } catch (e) {
                console.warn('Metadata extraction failed, continuing with draft...', e);
            }
        }

        // Step 2: Generate Draft
        const response = await fetch(`${API_BASE}/posts/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                topic,
                prompt_type: selectedPrompt,
                resource_persons: resourcePersonsInput.value.trim(),
                mentors: mentorsInput.value.trim(),
                coordinators: coordinatorsInput.value.trim()
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
            
            liPostText.innerText += chunk;
            
            // Re-trigger analysis
            handlePreview();
        }
        
        // Removed aiTopic.value = ''; (Persistent input)
    } catch (error) {
        console.error('Error generating AI draft:', error);
        liPostText.value = `Error: ${error.message}. Please check your connection.`;
    } finally {
        setLoading(false, 'btn-ai-draft', 'Draft with AI');
    }
}

async function handleAIRefine() {
    const instruction = chatInput.value.trim();
    const currentDraft = liPostText.innerText.trim();
    
    if (!instruction || !currentDraft || isProcessing) return;

    // UI Updates
    addChatMessage(instruction, 'user');
    chatInput.value = '';
    setLoading(true);

    // Ensure preview is in view
    document.getElementById('linkedin-preview-container').scrollIntoView({ behavior: 'smooth', block: 'center' });

    try {
        const response = await fetch(`${API_BASE}/posts/refine`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                current_content: currentDraft,
                instruction: instruction
            })
        });

        if (!response.body) throw new Error('Response body is null');
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        liPostText.innerHTML = ''; // Start overwriting with refinement
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            
            if (chunk.includes('[SERVICE_ERROR]')) {
                const errorMsg = chunk.replace('[SERVICE_ERROR]', '').trim();
                showServiceAlert(errorMsg);
                break;
            }
            
            liPostText.innerText += chunk;
            handlePreview(); // Analysis update
        }
        
        addChatMessage("Draft updated! Anything else?", 'ai');

    } catch (error) {
        console.error('Error refining draft:', error);
        addChatMessage("Sorry, I had trouble updating the draft. Please try again.", 'ai');
    } finally {
        setLoading(false);
    }
}

function addChatMessage(text, sender) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${sender}`;
    bubble.innerText = text;
    chatMessages.appendChild(bubble);
    
    // Auto-scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function handleSavePost() {
    const content = liPostText.innerText.trim();
    if (!content || isProcessing || content === 'Draft your professional story...') return;

    setLoading(true, 'btn-save-post', 'Saving...');
    try {
        await fetch(`${API_BASE}/posts/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        liPostText.innerHTML = 'Draft your professional story...';
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
