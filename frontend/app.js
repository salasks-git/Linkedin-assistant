const API_BASE = 'http://localhost:8000';

// DOM Elements
const aiTopic = document.getElementById('ai-topic');
const btnAIDraft = document.getElementById('btn-ai-draft');
const btnSavePost = document.getElementById('btn-save-post');
const postList = document.getElementById('post-list');
const postCount = document.getElementById('post-count');
const imageInput = document.getElementById('image-input');
const liPostText = document.getElementById('li-post-text');
const liImageGrid = document.getElementById('li-image-grid');
const metricsContainer = document.getElementById('metrics-container');

let isProcessing = false;
let selectedImages = [];
let postContentBuffer = ''; // SOURCE OF TRUTH — never read content from the DOM directly

// Dynamic references
const resourcePersonsInput = document.getElementById('resource-persons');
const mentorsInput = document.getElementById('mentors');
const coordinatorsInput = document.getElementById('coordinators');
const promptSelectorContainer = document.getElementById('dynamic-prompt-selector');

// Chat & Side Panel references
const chatPanel = document.getElementById('ai-chat-panel');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const btnChatSend = document.getElementById('btn-chat-send');
const btnChatToggle = document.getElementById('btn-chat-toggle');
const btnChatClose = document.getElementById('btn-chat-close');
const btnCopyPost = document.getElementById('btn-copy-post');
const btnPublishDirect = document.getElementById('btn-publish-direct');

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
    // Sync buffer when the user manually edits the contenteditable preview
    liPostText.addEventListener('input', () => {
        postContentBuffer = getDOMText(liPostText); // Keep buffer in sync with manual edits
        updateMetrics();
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

    // Panel Toggle
    btnChatToggle.addEventListener('click', () => {
        chatPanel.classList.add('active');
        document.body.classList.add('chat-open');
        chatInput.focus();
    });

    btnChatClose.addEventListener('click', () => {
        chatPanel.classList.remove('active');
        document.body.classList.remove('chat-open');
    });

    btnCopyPost.addEventListener('click', handleCopyContent);
    if (btnPublishDirect) {
        btnPublishDirect.addEventListener('click', publishToLinkedIn);
    }
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

/**
 * Serialize the contenteditable DOM to plain text, correctly handling
 * <br> and block-level elements as newlines (unlike innerText which is browser-inconsistent).
 */
function getDOMText(el) {
    let text = '';
    for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent;
        } else if (node.nodeName === 'BR') {
            text += '\n';
        } else if (node.nodeName === 'DIV' || node.nodeName === 'P') {
            // Block-level elements represent new lines
            const inner = node.textContent || '';
            text += '\n' + inner;
        } else {
            text += node.textContent || '';
        }
    }
    return text;
}

async function updateMetrics() {
    const content = postContentBuffer;
    if (!content.trim() || content === 'Draft your professional story...') {
        metricsContainer.innerHTML = '';
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/posts/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        const report = await response.json();
        renderMetrics(report);
    } catch (error) {
        console.error('Error fetching metrics:', error);
    }
}

function renderMetrics(report) {
    metricsContainer.innerHTML = `
        <div class="metric-item">
            <span class="metric-label">Character Count</span>
            <span class="metric-value" style="color: ${report.character_count > 3000 ? '#ef4444' : 'var(--text-primary)'}">
                ${report.character_count} / 3000
            </span>
        </div>
        <div class="metric-recommendation">
            <strong>AI Optimization</strong>
            <p>"${report.recommendation}"</p>
        </div>
    `;
}


function handleImageUpload(e) {
    const files = Array.from(e.target.files);
    selectedImages = files;
    renderImageGrid(files);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateLinkedInPreview(text) {
    postContentBuffer = text; // Keep buffer in sync
    if (!text.trim()) {
        liPostText.textContent = '';
        liPostText.innerHTML = 'Draft your professional story...';
        return;
    }
    
    // First escape HTML special characters
    const escaped = escapeHtml(text);
    
    // Then highlight hashtags safely — DOM is display only, buffer holds the raw text
    const formatted = escaped.replace(/#(\w+)/g, '<span class="li-hashtag">#$1</span>');
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
    // Reset buffer + clear DOM for fresh streaming
    postContentBuffer = '';
    liPostText.textContent = '';

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
                break;
            }
            
            // ✅ FIX: Append to JS buffer (source of truth), then update DOM for display
            postContentBuffer += chunk;
            liPostText.textContent = postContentBuffer;
            liPostText.scrollTop = liPostText.scrollHeight;
            updateMetrics();
        }
        
        // ✅ FIX: Flush the decoder — { stream: true } can hold back bytes for
        // multi-byte unicode characters at chunk boundaries. Without this flush,
        // the last few bytes of the AI response are silently dropped.
        const remaining = decoder.decode();
        if (remaining) {
            postContentBuffer += remaining;
        }
        
        // No destructive .trim() — preserve all whitespace the AI generated.
        // Buffer is already the final content. Update DOM one last time to apply hashtag highlighting.
        const finalEscaped = escapeHtml(postContentBuffer);
        liPostText.innerHTML = finalEscaped.replace(/#(\w+)/g, '<span class="li-hashtag">#$1</span>');
        updateMetrics();
        
    } catch (error) {
        console.error('Error generating AI draft:', error);
        postContentBuffer = '';
        liPostText.textContent = `[Error]: ${error.message} - Please check your backend connection or refresh your API keys.`;
    } finally {
        setLoading(false, 'btn-ai-draft', 'Draft with AI');
    }
}

async function handleAIRefine() {
    const instruction = chatInput.value.trim();
    const currentDraft = postContentBuffer; // ✅ FIX: Read from buffer, not DOM
    
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
        
        // ✅ FIX: Reset buffer and clear DOM for fresh refinement stream
        postContentBuffer = '';
        liPostText.textContent = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            
            if (chunk.includes('[SERVICE_ERROR]')) {
                const errorMsg = chunk.replace('[SERVICE_ERROR]', '').trim();
                showServiceAlert(errorMsg);
                break;
            }
            
            // ✅ FIX: Append to buffer, update DOM from buffer
            postContentBuffer += chunk;
            liPostText.textContent = postContentBuffer;
            updateMetrics();
        }

        // ✅ FIX: Flush TextDecoder to capture any remaining multi-byte chars
        const remaining = decoder.decode();
        if (remaining) {
            postContentBuffer += remaining;
        }

        // Final: apply hashtag highlighting
        const finalEscaped = escapeHtml(postContentBuffer);
        liPostText.innerHTML = finalEscaped.replace(/#(\w+)/g, '<span class="li-hashtag">#$1</span>');
        
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
    // ✅ FIX: Sync content from DOM innerText as a safety net before saving.
    // If the user edited the contenteditable after streaming, innerText is
    // the ground truth for what they actually see. Pick whichever is longer.
    const domText = liPostText.innerText || '';
    if (domText.length > postContentBuffer.length) {
        postContentBuffer = domText;
    }

    const content = postContentBuffer.trim();
    if (!content || isProcessing || content === 'Draft your professional story...') return;

    console.log(`DEBUG: Saving draft - length ${content.length}`);
    setLoading(true, 'btn-save-post', 'Saving...');
    
    const formData = new FormData();
    formData.append("content", content);
    
    // Add images if any
    if (selectedImages && selectedImages.length > 0) {
        selectedImages.forEach(file => {
            formData.append("images", file);
        });
    }

    try {
        const response = await fetch(`${API_BASE}/posts/`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error('Failed to save to database');

        // Success feedback
        const btn = document.getElementById('btn-save-post');
        btn.innerText = '✅ Saved to Queue';
        btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
        
        setTimeout(() => {
            btn.innerText = 'Save Draft to Queue';
            btn.style.background = '';
            setLoading(false, 'btn-save-post', 'Save Draft to Queue');
            
            // Clear buffer + DOM and refresh
            postContentBuffer = '';
            liPostText.innerHTML = 'Draft your professional story...';
            liImageGrid.innerHTML = '';
            liImageGrid.setAttribute('data-count', '0');
            selectedImages = [];
            metricsContainer.innerHTML = '';
            fetchPosts();
        }, 1500);

    } catch (error) {
        console.error('Error saving post:', error);
        alert('Failed to save draft. Is the backend running?');
        setLoading(false, 'btn-save-post', 'Save Draft to Queue');
    }
}

async function handlePublish(id, event) {
    if (isProcessing) return;

    const btn = event.currentTarget || event.target;
    const originalText = btn.innerHTML;
    
    setLoading(true);
    btn.disabled = true;
    btn.innerHTML = `<span class="loading-spinner"></span> Publishing...`;
    
    try {
        const response = await fetch(`${API_BASE}/posts/${id}/publish`, { method: 'POST' });
        if (!response.ok) throw new Error('Publishing failed');
        
        btn.innerHTML = `✅ Posted`;
        btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
        
        setTimeout(() => {
            fetchPosts();
        }, 1500);
    } catch (error) {
        console.error('Error publishing post:', error);
        btn.innerHTML = `❌ Failed`;
        btn.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.style.background = '';
            btn.disabled = false;
        }, 3000);
    } finally {
        setLoading(false);
    }
}

async function handleDeletePost(id) {
    if (!confirm("Are you sure you want to delete this draft and its images?")) return;

    try {
        const response = await fetch(`${API_BASE}/posts/${id}`, {
            method: 'DELETE'
        });
        if (response.ok) {
            fetchPosts();
        } else {
            alert("Failed to delete post.");
        }
    } catch (error) {
        console.error('Error deleting post:', error);
        alert("Error connecting to backend.");
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
        
        // Build image indicator if there are images
        let imagesHtml = '';
        if (post.image_urls && post.image_urls.length > 0) {
            imagesHtml = `<div class="post-queue-images">`;
            post.image_urls.forEach(url => {
                imagesHtml += `<img src="${API_BASE}${url}" class="queue-thumbnail">`;
            });
            imagesHtml += `</div>`;
        }
        
        card.innerHTML = `
            <div class="status-badge status-${post.status.toLowerCase()}">${post.status}</div>
            <button class="btn-delete-float" onclick="handleDeletePost(${post.id})" title="Delete Draft">✕</button>
            <p class="post-content">${post.content}</p>
            ${imagesHtml}
            <div class="post-footer">
                <div class="post-meta">
                    <span class="meta-label">Created</span>
                    <span class="meta-value">${new Date(post.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                </div>
                ${post.status.toLowerCase() === 'draft' ? 
                    `<button class="btn btn-action" onclick="handlePublish(${post.id}, event)">Post Now</button>` : ''}
            </div>
        `;
        postList.appendChild(card);
    });
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

async function handleCopyContent() {
    const content = postContentBuffer; // ✅ FIX: Read from buffer for accurate text
    try {
        await navigator.clipboard.writeText(content);
        
        // Visual feedback
        const originalText = btnCopyPost.innerText;
        btnCopyPost.innerText = '✅';
        btnCopyPost.classList.add('success');
        
        setTimeout(() => {
            btnCopyPost.innerText = originalText;
            btnCopyPost.classList.remove('success');
        }, 2000);
    } catch (err) {
        console.error('Failed to copy text: ', err);
    }
}

function setLoading(loading, btnId, text) {
    isProcessing = loading;
    if (btnId) {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.disabled = loading;
            if (btnId === 'btn-publish-direct') {
                btn.innerHTML = loading ? `<span class="li-action-icon">⏳</span><span>${text}</span>` : `<span class="li-action-icon">➡️</span><span>Publish</span>`;
            } else {
                btn.innerText = text;
            }
        }
    }
}

async function publishToLinkedIn() {
    if (isProcessing) return;
    
    // ✅ FIX: Sync from DOM innerText before publishing — ground truth for
    // what the user actually sees in the editable preview panel.
    const domText = liPostText.innerText || '';
    if (domText.length > postContentBuffer.length) {
        postContentBuffer = domText;
    }

    const content = postContentBuffer;
    if (!content.trim() || content === 'Draft your professional story...') {
        alert("Please draft some content before publishing.");
        return;
    }

    setLoading(true, 'btn-publish-direct', 'Publishing...');
    
    try {
        const formData = new FormData();
        formData.append("text", content);
        
        if (selectedImages && selectedImages.length > 0) {
            selectedImages.forEach(file => {
                formData.append("images", file);
            });
        }
        
        const response = await fetch(`${API_BASE}/posts/publish-direct`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.detail || 'Failed to publish to LinkedIn');
        }
        
        const result = await response.json();
        
        setLoading(false, 'btn-publish-direct', 'Publish');
        showResultPopup('success', 'Published to LinkedIn!', 'Your post is now live on your LinkedIn profile. 🎉');
        
    } catch (error) {
        console.error('Publishing error:', error);
        setLoading(false, 'btn-publish-direct', 'Publish');
        showResultPopup('error', 'Publishing Failed', `${error.message}\nMake sure your LINKEDIN_ACCESS_TOKEN is configured in backend/.env`);
    }
}

function showResultPopup(type, title, message) {
    // Remove any existing popup
    const existing = document.getElementById('result-popup-overlay');
    if (existing) existing.remove();

    const isSuccess = type === 'success';

    const overlay = document.createElement('div');
    overlay.id = 'result-popup-overlay';
    overlay.className = 'popup-overlay';
    overlay.innerHTML = `
        <div class="popup-card ${type}">
            <div class="popup-icon">${isSuccess ? '✅' : '❌'}</div>
            <h3 class="popup-title">${title}</h3>
            <p class="popup-message">${message}</p>
            <button class="popup-btn ${type}" id="popup-close-btn">Got it</button>
        </div>
    `;

    document.body.appendChild(overlay);

    // Close handlers
    const close = () => overlay.remove();
    document.getElementById('popup-close-btn').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

