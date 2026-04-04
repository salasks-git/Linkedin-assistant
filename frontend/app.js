// Dynamic API Detection — empty string forces relative paths, meaning it works on localhost AND ngrok seamlessly.
const API_BASE = "";


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
const linkedinPreview = document.getElementById('linkedin-preview-container');

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
    checkAuthStatus();
    setupEventListeners();
});

async function checkAuthStatus() {
    try {
        const res = await fetch(`${API_BASE}/auth/check`, {credentials: 'include'});
        const data = await res.json();
        
        if (data.status === 'authenticated') {
            document.getElementById('gatekeeper-overlay').style.display = 'none';
            if (data.user && data.user.has_linkedin) {
                document.getElementById('linkedin-connect-overlay').style.display = 'none';
                fetchPosts();
            } else {
                // Silent state: Show connect overlay but no warning alerts for user
                document.getElementById('linkedin-connect-overlay').style.display = 'flex';
            }
            
            // Always load prompts once authenticated so the editor is ready
            loadPrompts();
            
            // Update Header Title and LinkedIn Preview with username
            const headerTitle = document.getElementById('app-header-title');
            const previewName = document.getElementById('app-preview-name');
            const previewAvatar = document.getElementById('app-preview-avatar');
            const headerConnectBtn = document.getElementById('btn-header-connect');
            
            if (data.user) {
                const displayName = data.user.name || data.user.username || "User";
                if (headerTitle) headerTitle.innerText = `Hii ${displayName}`;
                if (previewName) previewName.innerText = displayName;
                if (previewAvatar) previewAvatar.innerText = displayName.charAt(0).toUpperCase();
                
                // Header Connection Button Logic
                if (headerConnectBtn) {
                    if (data.user.has_linkedin) {
                        headerConnectBtn.innerText = "Linked ✅";
                        headerConnectBtn.classList.add('linked');
                        headerConnectBtn.onclick = null;
                        headerConnectBtn.style.display = 'block';
                    } else {
                        headerConnectBtn.innerText = "Connect LinkedIn";
                        headerConnectBtn.classList.remove('linked');
                        headerConnectBtn.style.display = 'block';
                        headerConnectBtn.onclick = () => window.location.href = `${API_BASE}/auth/linkedin`;
                    }
                }
            }
        } else {
            document.getElementById('gatekeeper-overlay').style.display = 'flex';
            document.getElementById('linkedin-connect-overlay').style.display = 'none';
        }
    } catch (error) {
        console.error("Auth check failed:", error);
    }
}

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
    // Auth Tab Switching
    const tabLogin = document.getElementById('tab-login');
    const tabSignup = document.getElementById('tab-signup');
    const authTitle = document.getElementById('auth-title');
    const signupReminder = document.getElementById('signup-reminder');
    const authPasswordHint = document.getElementById('auth-password-hint');
    const showPasswordToggle = document.getElementById('show-password-toggle');
    const authPassword = document.getElementById('auth-password');
    const authMasterKey = document.getElementById('auth-master-key');
    const btnAuthSubmit = document.getElementById('btn-auth-submit');
    let authMode = 'login';

    function switchAuthMode(mode) {
        authMode = mode;
        if (mode === 'signup') {
            tabSignup.classList.add('active');
            tabLogin.classList.remove('active');
            authTitle.innerText = "Create Account";
            signupReminder.style.display = 'block';
            authPasswordHint.style.display = 'block';
            btnAuthSubmit.innerText = "Create & Join";
        } else {
            tabLogin.classList.add('active');
            tabSignup.classList.remove('active');
            authTitle.innerText = "Welcome Back";
            signupReminder.style.display = 'none';
            authPasswordHint.style.display = 'none';
            btnAuthSubmit.innerText = "Unlock Dashboard";
        }
    }

    if (showPasswordToggle) {
        showPasswordToggle.addEventListener('change', (e) => {
            const type = e.target.checked ? 'text' : 'password';
            authPassword.type = type;
            authMasterKey.type = type;
        });
    }

    if (tabLogin) tabLogin.addEventListener('click', () => switchAuthMode('login'));
    if (tabSignup) tabSignup.addEventListener('click', () => switchAuthMode('signup'));

    if (btnAuthSubmit) {
        btnAuthSubmit.addEventListener('click', async () => {
            const username = document.getElementById('auth-username').value.trim();
            const password = document.getElementById('auth-password').value;
            const masterKey = document.getElementById('auth-master-key').value.trim();
            const errEl = document.getElementById('auth-error');

            errEl.style.display = 'none';

            if (!username || !password || !masterKey) {
                errEl.innerText = "Please fill all fields";
                errEl.style.display = 'block';
                return;
            }

            if (authMode === 'signup') {
                const hasLetter = /[a-zA-Z]/.test(password);
                const hasNumber = /\d/.test(password);
                if (password.length < 6 || !hasLetter || !hasNumber) {
                    errEl.innerText = "Password must be at least 6 characters and include both letters and numbers.";
                    errEl.style.display = 'block';
                    return;
                }
            }

            // --- Loading State ---
            const originalText = btnAuthSubmit.innerText;
            btnAuthSubmit.disabled = true;
            btnAuthSubmit.innerHTML = `<span class="loading-spinner"></span> ${authMode === 'signup' ? 'Creating Account...' : 'Verifying...'}`;

            const endpoint = authMode === 'signup' ? '/auth/signup' : '/auth/login';
            try {
                const res = await fetch(`${API_BASE}${endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password, master_key: masterKey }),
                    credentials: 'include'
                });
                
                const data = await res.json();
                if (res.ok) {
                    errEl.style.display = 'none';
                    if (authMode === 'signup') {
                        // Restore button and switch to login tab
                        btnAuthSubmit.disabled = false;
                        btnAuthSubmit.innerText = originalText;
                        errEl.style.color = '#4ade80';
                        errEl.innerText = "✅ Account created! Now log in below.";
                        errEl.style.display = 'block';
                        switchAuthMode('login');
                    } else {
                        // ✅ LOGIN: Unlock UI immediately without a second /auth/check call
                        btnAuthSubmit.innerHTML = `✅ Welcome!`;
                        document.getElementById('gatekeeper-overlay').style.display = 'none';

                        // Instantly update header title and preview with the username they just typed
                        const headerTitle = document.getElementById('app-header-title');
                        const previewName = document.getElementById('app-preview-name');
                        const previewAvatar = document.getElementById('app-preview-avatar');
                        
                        if (data.name || username) {
                            const displayName = data.name || username;
                            if (headerTitle) headerTitle.innerText = `Hii ${displayName}`;
                            if (previewName) previewName.innerText = displayName;
                            if (previewAvatar) previewAvatar.innerText = displayName.charAt(0).toUpperCase();
                        }

                        // Load drafts and prompts in the background
                        fetchPosts();
                        loadPrompts();
                        // Check LinkedIn status silently in background
                        checkAuthStatus();
                    }
                } else {
                    btnAuthSubmit.disabled = false;
                    btnAuthSubmit.innerText = originalText;
                    errEl.style.color = '#ff5555';
                    // Special case to remind user to sign up after DB clears
                    if (data.detail && data.detail.includes("Invalid username or password")) {
                        errEl.innerText = "❌ Authentication failed. If the database was recently cleared, you need to Sign Up again!";
                    } else {
                        errEl.innerText = `❌ ${data.detail || "Authentication failed"}`;
                    }
                    errEl.style.display = 'block';
                }
            } catch(e) {
                console.error(e);
                btnAuthSubmit.disabled = false;
                btnAuthSubmit.innerText = originalText;
                errEl.style.color = '#ff5555';
                errEl.innerText = "Connection Error — Is the server running?";
                errEl.style.display = 'block';
            }
        });
    }

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

    // Panel Toggle (Wise Mobile Focus)
    btnChatToggle.addEventListener('click', () => {
        chatPanel.classList.add('active');
        document.body.classList.add('chat-open');
        chatInput.focus();
        
        // On mobile, scroll the preview container to the top so it's not hidden by the bottom drawer
        if (window.innerWidth <= 768) {
            const previewContainer = document.getElementById('linkedin-preview-container');
            if (previewContainer) {
                previewContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // Switch to preview tab automatically if that's where the user is going
                const previewTab = document.querySelector('.mobile-tab[data-view="preview"]');
                if (previewTab) previewTab.click();
            }
        }
    });

    btnChatClose.addEventListener('click', () => {
        chatPanel.classList.remove('active');
        document.body.classList.remove('chat-open');
    });

    const btnSkipLinkedin = document.getElementById('btn-skip-linkedin');
    if (btnSkipLinkedin) {
        btnSkipLinkedin.addEventListener('click', () => {
            document.getElementById('linkedin-connect-overlay').style.display = 'none';
        });
    }

    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            const originalText = btnLogout.innerHTML;
            btnLogout.innerHTML = `<span class="loading-spinner" style="width:14px;height:14px;border-width:2px;"></span>`;
            btnLogout.disabled = true;
            try {
                await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
            } catch(e) {
                console.error(e);
            }
            window.location.reload();
        });
    }

    if (btnPublishDirect) {
        btnPublishDirect.addEventListener('click', publishToLinkedIn);
    }

    // --- NEW: Mobile & Ergonomic Listeners ---
    
    // Metadata Collapsible (Deeply Wise Disclosure)
    const btnMetaToggle = document.getElementById('btn-metadata-expand');
    const advancedMeta = document.getElementById('advanced-metadata');
    
    if (btnMetaToggle && advancedMeta) {
        btnMetaToggle.addEventListener('click', () => {
            const isCollapsed = advancedMeta.classList.toggle('collapsed');
            btnMetaToggle.classList.toggle('expanded', !isCollapsed);
            btnMetaToggle.querySelector('.chevron').innerText = isCollapsed ? '▼' : '▲';
        });
    }

    // Mobile View Toggle Switcher (Obsolete in Vertical Flow)
    // No longer required as we use down-to-down vertical scrolling

    // Sticky Bar Linking
    const stickyDraft = document.getElementById('sticky-ai-draft');
    const stickyPublish = document.getElementById('sticky-publish');
    const stickySave = document.getElementById('sticky-save');

    if (stickyDraft) stickyDraft.addEventListener('click', handleAIDraft);
    if (stickyPublish) stickyPublish.addEventListener('click', publishToLinkedIn);
    if (stickySave) stickySave.addEventListener('click', handleSavePost);

    // Draft Modal Listeners
    const btnCloseDraft = document.getElementById('btn-close-draft');
    if (btnCloseDraft) {
        btnCloseDraft.addEventListener('click', closeDraftModal);
    }
}

// API Functions
async function fetchPosts() {
    try {
        const response = await fetch(`${API_BASE}/posts/`, { credentials: 'include' });
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

    // Smooth scroll to results immediately (WISE response)
    const previewContainer = document.getElementById('linkedin-preview-container');
    if (window.innerWidth <= 768) {
        // Switch to preview tab automatically on mobile if not already there
        const previewTab = document.querySelector('.mobile-tab[data-view="preview"]');
        if (previewTab) previewTab.click();
    }
    
    previewContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
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
            }),
            credentials: 'include'
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
            body: formData,
            credentials: 'include'
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
        const response = await fetch(`${API_BASE}/posts/${id}/publish`, { method: 'POST', credentials: 'include' });
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
        
        // Task 4: Auto-refresh connection status if token expired
        if (error.message.includes('LINKEDIN_UNAUTHORIZED') || error.message.includes('401')) {
            alert('Your LinkedIn connection has expired. Please reconnect.');
            checkAuthStatus(); // This will show the connect overlay
        }
        
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.style.background = '';
            btn.disabled = false;
        }, 3000);
    } finally {
        setLoading(false);
    }
}

async function handleDeletePost(id, event) {
    if (!confirm("Are you sure you want to delete this draft and its images?")) return;

    let btn = null;
    let originalText = '✕';
    if (event) {
        btn = event.currentTarget || event.target;
        originalText = btn.innerHTML;
        btn.innerHTML = `<span class="loading-spinner" style="width:14px;height:14px;border-width:2px;"></span>`;
        btn.disabled = true;
    }

    try {
        const response = await fetch(`${API_BASE}/posts/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (response.ok) {
            fetchPosts(); // This will clear the button anyway when it re-renders
        } else {
            alert("Failed to delete post.");
            if (btn) {
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        }
    } catch (error) {
        console.error('Error deleting post:', error);
        alert("Error connecting to backend.");
        if (btn) {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
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
        card.style.cursor = 'pointer';
        
        // Open modal on click, but ignore if internal buttons were clicked
        card.onclick = (e) => {
            if (!e.target.closest('button')) {
                openDraftModal(post);
            }
        };
        
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
            <button class="btn-delete-float" onclick="handleDeletePost(${post.id}, event)" title="Delete Draft">✕</button>
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

/**
 * --- DRAFT MODAL LOGIC ---
 */
function openDraftModal(post) {
    const modal = document.getElementById('draft-modal');
    const modalContent = document.getElementById('modal-post-content');
    const modalImages = document.getElementById('modal-image-grid');
    const publishBtn = document.getElementById('modal-publish-btn');
    
    // Populate text (with hashtag highlighting)
    const escaped = escapeHtml(post.content);
    modalContent.innerHTML = escaped.replace(/#(\w+)/g, '<span class="li-hashtag">#$1</span>');
    
    // Populate images
    modalImages.innerHTML = '';
    if (post.image_urls && post.image_urls.length > 0) {
        post.image_urls.forEach(url => {
            const img = document.createElement('img');
            img.src = `${API_BASE}${url}`;
            img.className = 'media-item';
            modalImages.appendChild(img);
        });
    }
    
    // Setup Publish Button
    if (post.status.toLowerCase() === 'draft') {
        publishBtn.style.display = 'block';
        publishBtn.onclick = (e) => {
            closeDraftModal();
            handlePublish(post.id, e);
        };
    } else {
        publishBtn.style.display = 'none';
    }
    
    // Show Modal
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden'; // Prevent scrolling background
}

function closeDraftModal() {
    const modal = document.getElementById('draft-modal');
    modal.style.display = 'none';
    document.body.style.overflow = ''; // Re-enable scrolling
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
            body: formData,
            credentials: 'include'
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
        
        // Task 4: Auto-refresh connection status if token expired
        if (error.message.includes('401') || error.message.includes('LINKEDIN_UNAUTHORIZED')) {
            alert('Your LinkedIn session has expired. Please reconnect.');
            checkAuthStatus(); // This will show the connect overlay
        } else {
            showResultPopup('error', 'Publishing Failed', `${error.message}\nMake sure your LinkedIn connection is still active.`);
        }
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

