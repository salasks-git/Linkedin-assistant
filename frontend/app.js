// Dynamic API Detection
const API_BASE = window.LINKEDIN_API_BASE || "";
document.querySelectorAll('a[href="/auth/linkedin"]').forEach((link) => {
    link.href = `${API_BASE}/auth/linkedin`;
    link.addEventListener('click', async (event) => {
        event.preventDefault();
        try {
            const response = await fetch(`${API_BASE}/auth/linkedin/start`, {
                credentials: 'include'
            });
            const result = await response.json();
            if (!response.ok || !result.authorization_url) {
                throw new Error(result.detail || `LinkedIn sign-in could not start (${response.status}).`);
            }
            window.location.assign(result.authorization_url);
        } catch (error) {
            console.error('LinkedIn sign-in could not start:', error);
            showToast(error.message || 'LinkedIn sign-in could not start. Please try again.');
        }
    });
});

// Supabase browser configuration is served by the backend so local and deployed
// builds use the same project settings without embedding keys in this file.
let supabaseClient = null;
const nativeFetch = window.fetch.bind(window);

async function initializeSupabaseClient() {
    try {
        const response = await nativeFetch(`${API_BASE}/api/config`);
        if (!response.ok) {
            throw new Error(`Backend config request failed (${response.status})`);
        }
        const config = await response.json();
        if (!response.ok || !config.is_supabase_auth_configured || !window.supabase?.createClient) {
            console.warn("[Supabase] Auth settings are missing or the SDK failed to load.");
            return;
        }

        supabaseClient = window.supabase.createClient(config.supabase_url, config.supabase_anon_key);
        supabaseClient.auth.onAuthStateChange((event) => {
            if (event === 'INITIAL_SESSION') return;
            // Supabase advises deferring auth calls out of this callback to avoid
            // holding the client's internal auth lock during API requests.
            window.setTimeout(() => {
                if (event === 'SIGNED_OUT') {
                    nativeFetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' })
                        .finally(() => checkAuthStatus());
                } else if (event === 'SIGNED_IN') {
                    checkAuthStatus();
                }
            }, 0);
        });
        console.info("[Supabase] ✅ Client initialized successfully.");
    } catch (err) {
        console.error("[Supabase] Failed to initialize client:", err);
    }
}

/**
 * getCurrentUserSession()
 * Global helper to retrieve the active Supabase auth session and user.
 *
 * Returns: { session, user } or { session: null, user: null } when not signed in
 *          or when Supabase is not configured.
 *
 * Usage:
 *   const { session, user } = await getCurrentUserSession();
 *   if (user) { ... }
 */
async function getCurrentUserSession() {
    if (!supabaseClient) {
        return { session: null, user: null };
    }
    try {
        const { data, error } = await supabaseClient.auth.getSession();
        if (error) {
            console.warn("[Supabase] getSession error:", error.message);
            return { session: null, user: null };
        }
        const session = data?.session ?? null;
        const user = session?.user ?? null;
        return { session, user };
    } catch (err) {
        console.error("[Supabase] Unexpected error in getCurrentUserSession:", err);
        return { session: null, user: null };
    }
}

// Add the current Supabase access token to same-origin backend calls. Supabase
// SDK requests go to the project URL and are left untouched.
window.fetch = async (input, init = {}) => {
    let target;
    try {
        target = new URL(input instanceof Request ? input.url : input, window.location.href);
    } catch {
        return nativeFetch(input, init);
    }
    const backendOrigin = new URL(API_BASE || window.location.origin, window.location.href).origin;
    if (target.origin === backendOrigin && supabaseClient) {
        const { session } = await getCurrentUserSession();
        if (session?.access_token) {
            const headers = new Headers(input instanceof Request ? input.headers : undefined);
            new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
            headers.set('Authorization', `Bearer ${session.access_token}`);
            init = { ...init, headers };
        }
    }
    return nativeFetch(input, init);
};

// State
let authMode = 'login';
let selectedImages = [];
let postContentBuffer = '';
let lastTopicPrompt = '';
let isProcessing = false;
let userHasLinkedIn = false;
let userHasAIAuth = false;
let currentPosts = [];
let currentFilter = 'all';
let selectedModel = 'gemini-3.8-flash';
let selectedModelName = 'Gemini 3.8 Flash';

// Schedule Post State
let selectedScheduleDate = 16; // Default to Monday 16th
let selectedScheduleHour = '08';
let selectedScheduleMinute = '45';
let selectedScheduleAmPm = 'AM';
let calPickerCurrentYear = 2026;
let calPickerCurrentMonth = 10; // November (0-indexed)
let scheduledPostsStorage = JSON.parse(localStorage.getItem('postly_scheduled_posts') || '[]');
let activeDetailPost = null;

let aiKeyData = {
    provider: 'gemini-3.8-flash',
    masked_key: null,
    authorized_at: null
};
let isAISetupMandatory = false;

// DOM Elements Map
const el = {
    // Auth & LinkedIn Overlays
    authOverlay: document.getElementById('gatekeeper-overlay'),
    linkedinOverlay: document.getElementById('linkedin-connect-overlay'),
    btnSkipLinkedin: document.getElementById('btn-skip-linkedin'),
    tabLogin: document.getElementById('tab-login'),
    tabSignup: document.getElementById('tab-signup'),
    authTitle: document.getElementById('auth-title'),
    authUsername: document.getElementById('auth-username'),
    authPassword: document.getElementById('auth-password'),
    authPasswordHint: document.getElementById('auth-password-hint'),
    showPasswordToggle: document.getElementById('show-password-toggle'),
    signupReminder: document.getElementById('signup-reminder'),
    authError: document.getElementById('auth-error'),
    btnAuthSubmit: document.getElementById('btn-auth-submit'),
    btnGoogleLogin: document.getElementById('btn-google-login'),

    // AI Setup Overlay
    aiSetupOverlay: document.getElementById('ai-setup-overlay'),
    aiSetupTitle: document.getElementById('ai-setup-title'),
    aiSetupDesc: document.getElementById('ai-setup-desc'),
    btnCloseAiSetup: document.getElementById('btn-close-ai-setup'),
    aiProviderSelect: document.getElementById('ai-provider-select'),
    aiApiKeyInput: document.getElementById('ai-api-key-input'),
    btnToggleAiKey: document.getElementById('btn-toggle-ai-key'),
    currentKeyPreview: document.getElementById('current-key-preview'),
    checkValidateKey: document.getElementById('check-validate-key'),
    aiSetupFeedback: document.getElementById('ai-setup-feedback'),
    btnSubmitAiKey: document.getElementById('btn-submit-ai-key'),
    btnSubmitAiSpinner: document.getElementById('btn-submit-ai-spinner'),
    btnSubmitAiText: document.getElementById('btn-submit-ai-text'),
    btnRevokeAiKey: document.getElementById('btn-revoke-ai-key'),

    // Top Bar & Model Switcher
    btnModelSwitcher: document.getElementById('btn-model-switcher'),
    modelNameDisplay: document.getElementById('model-name-display'),
    modelModal: document.getElementById('model-modal'),
    btnCloseModelModal: document.getElementById('btn-close-model-modal'),
    topAvatarBtn: document.getElementById('top-avatar-btn'),
    avatarInitials: document.getElementById('avatar-initials'),
    avatarImage: document.getElementById('avatar-image'),

    // Navigation & Tabs
    navTabs: document.querySelectorAll('.nav-tab'),
    pages: document.querySelectorAll('.page'),

    // Page: Create
    emptyState: document.getElementById('empty-state'),
    resultState: document.getElementById('result-state'),
    userBubble: document.getElementById('user-bubble'),
    genShimmerLine: document.getElementById('gen-shimmer-line'),
    postText: document.getElementById('li-post-text'),
    imageGrid: document.getElementById('li-image-grid'),
    topicInput: document.getElementById('ai-topic'),
    btnDraft: document.getElementById('btn-ai-draft'),
    imageInput: document.getElementById('image-input'),
    btnAttach: document.getElementById('btn-attach'),
    composerAttachedBar: document.getElementById('composer-attached-bar'),
    promptSelector: document.getElementById('dynamic-prompt-selector'),
    btnRegenerate: document.getElementById('btn-regenerate'),
    btnShorter: document.getElementById('btn-shorter'),
    btnLonger: document.getElementById('btn-longer'),
    btnEditFocus: document.getElementById('btn-edit-focus'),
    btnOpenPreview: document.getElementById('btn-open-preview'),

    // Preview & Schedule Modal
    previewModal: document.getElementById('preview-modal'),
    btnClosePreview: document.getElementById('btn-close-preview'),
    liModalPreviewText: document.getElementById('li-modal-preview-text'),
    liModalImageGrid: document.getElementById('li-modal-image-grid'),
    liPostAvatar: document.getElementById('li-post-avatar'),
    liPostName: document.getElementById('li-post-name'),
    btnSave: document.getElementById('btn-save-post'),
    btnPublish: document.getElementById('btn-publish-direct'),
    stickyPublish: document.getElementById('sticky-publish'),

    // Preview Screen 3 Ordered Actions
    btnPreviewSchedule: document.getElementById('btn-preview-schedule'),
    btnPreviewPostNow: document.getElementById('btn-preview-post-now'),
    btnPreviewSaveDraft: document.getElementById('btn-preview-save-draft'),

    // Schedule Post Bottom Sheet Modal
    schedulePostModal: document.getElementById('schedule-post-modal'),
    btnCloseSchedulePost: document.getElementById('btn-close-schedule-post'),
    calPickerMonthName: document.getElementById('cal-picker-month-name'),
    btnCalPickerPrev: document.getElementById('btn-cal-picker-prev'),
    btnCalPickerNext: document.getElementById('btn-cal-picker-next'),
    calPickerDatesGrid: document.getElementById('cal-picker-dates-grid'),
    pillHour: document.getElementById('pill-hour'),
    timeHourDisplay: document.getElementById('time-hour-display'),
    pillMinute: document.getElementById('pill-minute'),
    timeMinDisplay: document.getElementById('time-min-display'),
    btnTimeAm: document.getElementById('btn-time-am'),
    btnTimePm: document.getElementById('btn-time-pm'),
    btnBestTimeChip: document.getElementById('btn-best-time-chip'),
    btnConfirmSchedule: document.getElementById('btn-confirm-schedule'),

    // Confirmation Dialog: Post Now
    confirmPublishDialog: document.getElementById('confirm-publish-dialog'),
    btnCancelPostNow: document.getElementById('btn-cancel-post-now'),
    btnConfirmPostNow: document.getElementById('btn-confirm-post-now'),

    // Page: Home
    homeUserName: document.getElementById('home-user-name'),
    statScheduled: document.getElementById('stat-scheduled'),
    statDrafts: document.getElementById('stat-drafts'),
    statPublished: document.getElementById('stat-published'),
    draftCount: document.getElementById('draft-count'),
    homeDraftList: document.getElementById('home-draft-list'),
    btnHomeViewAll: document.getElementById('btn-home-view-all'),
    btnInspGenerate: document.getElementById('btn-insp-generate'),

    // Page: Schedule
    btnNewPost: document.getElementById('btn-new-post'),
    calMonthLabel: document.getElementById('cal-month-label'),
    calPrev: document.getElementById('cal-prev'),
    calNext: document.getElementById('cal-next'),
    weekGrid: document.getElementById('week-grid'),
    scheduleList: document.getElementById('schedule-list'),

    // Page: Post Details
    pagePostDetails: document.getElementById('page-post-details'),
    btnDetailsBack: document.getElementById('btn-details-back'),
    detailsStatusBadge: document.getElementById('details-status-badge'),
    detailsPostAvatar: document.getElementById('details-post-avatar'),
    detailsPostName: document.getElementById('details-post-name'),
    detailsPostTime: document.getElementById('details-post-time'),
    detailsPostContent: document.getElementById('details-post-content'),
    detailsImageGrid: document.getElementById('details-image-grid'),
    btnDetailsEditCaption: document.getElementById('btn-details-edit-caption'),
    btnDetailsReschedule: document.getElementById('btn-details-reschedule'),
    detailsRescheduleLabel: document.getElementById('details-reschedule-label'),
    btnDetailsPostNow: document.getElementById('btn-details-post-now'),
    btnDetailsMoreMenu: document.getElementById('btn-details-more-menu'),
    detailsMorePopup: document.getElementById('details-more-popup'),
    btnDetailsDuplicate: document.getElementById('btn-details-duplicate'),
    btnDetailsDelete: document.getElementById('btn-details-delete'),

    // Page: Settings
    btnOpenAiSettings: document.getElementById('btn-open-ai-settings'),
    aiStatusSettings: document.getElementById('ai-status-settings'),
    liStatusSettings: document.getElementById('li-status-settings'),
    btnSettingsLiConnect: document.getElementById('btn-settings-li-connect'),
    btnLogout: document.getElementById('btn-logout')
};

// ==========================================================================
// INITIALIZATION
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    setupTabNavigation();
    setupAuthListeners();
    setupAIListeners();
    setupModelSwitcher();
    setupCreateListeners();
    setupScheduleListeners();
    setupPostDetails();
    setupSettingsListeners();
    renderWeekStrip();
    await initializeSupabaseClient();
    await checkAuthStatus();
});

// ==========================================================================
// TAB NAVIGATION
// ==========================================================================
function switchPage(pageId) {
    if (!el.pages || !el.navTabs) return;

    el.pages.forEach(p => p.classList.remove('active'));
    el.navTabs.forEach(t => t.classList.remove('active'));

    const targetPage = document.getElementById(`page-${pageId}`);
    const targetTab = document.querySelector(`.nav-tab[data-page="${pageId}"]`);

    if (targetPage) targetPage.classList.add('active');
    if (targetTab) targetTab.classList.add('active');

    // Toggle viewing-post-details state to hide general bottom navigation
    document.body.classList.toggle('viewing-post-details', pageId === 'post-details');

    // Scroll container to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Refresh posts if visiting Home or Schedule
    if (pageId === 'home' || pageId === 'schedule') {
        if (pageId === 'schedule') updateScheduleDraftsTopAction();
        fetchPosts();
    }
}

function setupTabNavigation() {
    el.navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const page = tab.getAttribute('data-page');
            if (page) switchPage(page);
        });
    });

    if (el.topAvatarBtn) {
        el.topAvatarBtn.addEventListener('click', () => switchPage('settings'));
    }

    if (el.btnHomeViewAll) {
        el.btnHomeViewAll.addEventListener('click', () => switchPage('schedule'));
    }

    if (el.btnNewPost || el.btnInspGenerate) {
        if (el.btnNewPost) el.btnNewPost.addEventListener('click', openEmptyCreateComposer);
        if (el.btnInspGenerate) el.btnInspGenerate.addEventListener('click', () => {
            openEmptyCreateComposer();
            if (el.topicInput) {
                el.topicInput.value = "Framework for 10x developer productivity in high-scale AI teams";
                el.topicInput.focus();
            }
        });
    }
}

// ==========================================================================
// MODEL SWITCHER
// ==========================================================================
function setupModelSwitcher() {
    if (el.btnModelSwitcher && el.modelModal) {
        el.btnModelSwitcher.addEventListener('click', () => {
            el.modelModal.style.display = 'flex';
        });
    }

    if (el.btnCloseModelModal && el.modelModal) {
        el.btnCloseModelModal.addEventListener('click', () => {
            el.modelModal.style.display = 'none';
        });
    }

    document.querySelectorAll('.model-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const modelVal = btn.dataset.model;
            const modelName = btn.dataset.name;
            selectedModel = modelVal;
            selectedModelName = modelName;

            if (el.modelNameDisplay) el.modelNameDisplay.textContent = modelName;
            if (el.aiProviderSelect) el.aiProviderSelect.value = modelVal;

            document.querySelectorAll('.model-option .settings-row-action').forEach(action => action.textContent = '');
            const checkSpan = btn.querySelector('.settings-row-action');
            if (checkSpan) checkSpan.textContent = '✓';

            el.modelModal.style.display = 'none';
        });
    });
}

// ==========================================================================
// AUTH & ACCESS CONTROL
// ==========================================================================
async function checkAuthStatus() {
    try {
        const res = await fetch(`${API_BASE}/auth/check`, { credentials: 'include' });
        if (res.status === 401) {
            if (el.authOverlay) el.authOverlay.style.display = 'flex';
            return;
        }
        if (!res.ok) {
            throw new Error(`Backend auth check failed (${res.status})`);
        }
        const data = await res.json();

        if (data.status === 'authenticated') {
            if (el.authOverlay) el.authOverlay.style.display = 'none';
            userHasLinkedIn = Boolean(data.user && data.user.has_linkedin);
            userHasAIAuth = Boolean(data.user && data.user.has_ai_auth);

            aiKeyData.masked_key = data.user?.masked_ai_key || null;
            aiKeyData.provider = data.user?.ai_provider || 'gemini-3.8-flash';
            aiKeyData.authorized_at = data.user?.ai_authorized_at || null;

            updateUserInfo(data.user);
            updateAIStatus(userHasAIAuth, aiKeyData.masked_key);

            loadPrompts();
            fetchPosts();

            if (!userHasAIAuth) {
                // Google users must connect a Gemini key before using the workspace.
                showAISetupModal(false);
            }
        } else {
            if (el.authOverlay) el.authOverlay.style.display = 'flex';
            if (el.aiSetupOverlay) el.aiSetupOverlay.style.display = 'none';
        }
    } catch (err) {
        console.error("Auth check failed:", err);
        if (el.authOverlay) el.authOverlay.style.display = 'flex';
    }
}

function updateUserInfo(user) {
    if (!user) return;
    const displayName = user.name || user.username || "Creator";
    if (el.homeUserName) el.homeUserName.textContent = displayName;
    if (el.liPostName) el.liPostName.textContent = displayName;

    const initial = displayName.charAt(0).toUpperCase();
    if (el.avatarInitials) el.avatarInitials.textContent = initial;
    if (el.avatarImage) {
        if (user.avatar_url) {
            el.avatarImage.src = user.avatar_url;
            el.avatarImage.alt = `${displayName} profile picture`;
            el.avatarImage.style.display = 'block';
            if (el.avatarInitials) el.avatarInitials.style.display = 'none';
            el.avatarImage.onerror = () => {
                el.avatarImage.style.display = 'none';
                if (el.avatarInitials) el.avatarInitials.style.display = 'inline';
            };
        } else {
            el.avatarImage.removeAttribute('src');
            el.avatarImage.style.display = 'none';
            if (el.avatarInitials) el.avatarInitials.style.display = 'inline';
        }
    }
    if (el.liPostAvatar) el.liPostAvatar.textContent = initial;

    if (el.liStatusSettings) {
        if (user.has_linkedin) {
            el.liStatusSettings.textContent = "Connected 🟢";
            if (el.btnSettingsLiConnect) {
                el.btnSettingsLiConnect.textContent = "Connected";
                el.btnSettingsLiConnect.classList.add("connected");
            }
        } else {
            el.liStatusSettings.textContent = "Not connected";
            if (el.btnSettingsLiConnect) {
                el.btnSettingsLiConnect.textContent = "Connect";
                el.btnSettingsLiConnect.classList.remove("connected");
            }
        }
    }
}

function updateAIStatus(connected, maskedKey = null) {
    if (el.aiStatusSettings) {
        if (connected) {
            const keyText = maskedKey ? ` (${maskedKey})` : '';
            el.aiStatusSettings.textContent = `Connected 🟢${keyText}`;
        } else {
            el.aiStatusSettings.textContent = 'Not configured 🔴';
        }
    }
}

function setupAuthListeners() {
    if (el.showPasswordToggle && el.authPassword) {
        el.showPasswordToggle.addEventListener('change', (e) => {
            el.authPassword.type = e.target.checked ? 'text' : 'password';
        });
    }

    const switchAuthMode = (mode) => {
        authMode = mode;
        if (mode === 'signup') {
            el.tabSignup.style.background = 'var(--ink)';
            el.tabSignup.style.color = '#fff';
            el.tabLogin.style.background = '#EAEAE6';
            el.tabLogin.style.color = 'var(--ink)';
            el.authTitle.textContent = "Create Account";
            if (el.signupReminder) el.signupReminder.style.display = 'block';
            if (el.authPasswordHint) el.authPasswordHint.style.display = 'block';
            el.btnAuthSubmit.textContent = "Create Account";
        } else {
            el.tabLogin.style.background = 'var(--ink)';
            el.tabLogin.style.color = '#fff';
            el.tabSignup.style.background = '#EAEAE6';
            el.tabSignup.style.color = 'var(--ink)';
            el.authTitle.textContent = "Welcome Back";
            if (el.signupReminder) el.signupReminder.style.display = 'none';
            if (el.authPasswordHint) el.authPasswordHint.style.display = 'none';
            el.btnAuthSubmit.textContent = "Unlock Postly";
        }
    };

    if (el.tabLogin) el.tabLogin.addEventListener('click', () => switchAuthMode('login'));
    if (el.tabSignup) el.tabSignup.addEventListener('click', () => switchAuthMode('signup'));

    if (el.btnGoogleLogin) {
        el.btnGoogleLogin.addEventListener('click', async () => {
            if (!supabaseClient) {
                showAuthError("Google sign-in is not configured yet. Check the Supabase URL and publishable key.");
                return;
            }
            el.btnGoogleLogin.disabled = true;
            try {
                const { error } = await supabaseClient.auth.signInWithOAuth({
                    provider: 'google',
                    options: { redirectTo: window.location.origin }
                });
                if (error) throw error;
            } catch (error) {
                showAuthError(error.message || "Google sign-in could not be started.");
                el.btnGoogleLogin.disabled = false;
            }
        });
    }

    if (el.btnAuthSubmit) {
        el.btnAuthSubmit.addEventListener('click', async () => {
            const username = el.authUsername.value.trim();
            const password = el.authPassword.value;

            if (el.authError) el.authError.style.display = 'none';
            if (!username || !password) {
                showAuthError("Please fill in both fields.");
                return;
            }

            const orig = el.btnAuthSubmit.textContent;
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
                        showAuthError("Account created! You can now log in.", 'success');
                        switchAuthMode('login');
                    } else {
                        if (el.authOverlay) el.authOverlay.style.display = 'none';
                        updateUserInfo({ username, name: data.name });
                        checkAuthStatus();
                    }
                } else {
                    showAuthError(data.detail || "Authentication Failed", 'error');
                }
            } catch {
                showAuthError("Network connection error.", 'error');
            } finally {
                el.btnAuthSubmit.disabled = false;
                el.btnAuthSubmit.textContent = orig;
            }
        });
    }

    if (el.btnSkipLinkedin && el.linkedinOverlay) {
        el.btnSkipLinkedin.addEventListener('click', () => {
            el.linkedinOverlay.style.display = 'none';
        });
    }
}

function showAuthError(msg, type = 'error') {
    if (!el.authError) return;
    el.authError.textContent = msg;
    el.authError.className = `feedback-banner ${type}`;
    el.authError.style.display = 'block';
}

// ==========================================================================
// AI SETUP & SETTINGS
// ==========================================================================
function showAISetupModal(isMandatory = false) {
    isAISetupMandatory = isMandatory;
    if (el.aiApiKeyInput) el.aiApiKeyInput.value = '';
    hideAIFeedback();

    if (el.btnCloseAiSetup) {
        el.btnCloseAiSetup.style.display = isMandatory ? 'none' : 'flex';
    }

    if (isMandatory) {
        if (el.aiSetupTitle) el.aiSetupTitle.innerHTML = `<span>Connect Gemini AI</span>`;
        if (el.btnRevokeAiKey) el.btnRevokeAiKey.style.display = 'none';
        if (el.btnSubmitAiText) el.btnSubmitAiText.textContent = "Connect AI & Unlock";
        if (el.currentKeyPreview) el.currentKeyPreview.style.display = 'none';
    } else {
        if (el.aiSetupTitle) el.aiSetupTitle.innerHTML = `<span>AI Generator Settings</span>`;
        if (el.btnSubmitAiText) el.btnSubmitAiText.textContent = "Update & Validate Key";

        if (aiKeyData.masked_key && el.currentKeyPreview) {
            el.currentKeyPreview.style.display = 'block';
            el.currentKeyPreview.textContent = `Active Key: ${aiKeyData.masked_key} 🟢`;
            if (el.btnRevokeAiKey) el.btnRevokeAiKey.style.display = 'block';
        } else {
            if (el.currentKeyPreview) el.currentKeyPreview.style.display = 'none';
            if (el.btnRevokeAiKey) el.btnRevokeAiKey.style.display = 'none';
        }
    }

    if (el.aiSetupOverlay) el.aiSetupOverlay.style.display = 'flex';
}

function showAIFeedback(msg, type = 'error') {
    if (!el.aiSetupFeedback) return;
    el.aiSetupFeedback.textContent = msg;
    el.aiSetupFeedback.className = `feedback-banner ${type}`;
    el.aiSetupFeedback.style.display = 'block';
}

function hideAIFeedback() {
    if (el.aiSetupFeedback) el.aiSetupFeedback.style.display = 'none';
}

function setupAIListeners() {
    if (el.btnToggleAiKey && el.aiApiKeyInput) {
        el.btnToggleAiKey.addEventListener('click', () => {
            const isPw = el.aiApiKeyInput.type === 'password';
            el.aiApiKeyInput.type = isPw ? 'text' : 'password';
            el.btnToggleAiKey.textContent = isPw ? '🔒' : '👁️';
        });
    }

    if (el.btnCloseAiSetup && el.aiSetupOverlay) {
        el.btnCloseAiSetup.addEventListener('click', () => {
            if (!isAISetupMandatory) el.aiSetupOverlay.style.display = 'none';
        });
    }

    if (el.btnOpenAiSettings) {
        el.btnOpenAiSettings.addEventListener('click', () => {
            showAISetupModal(false);
        });
    }

    if (el.btnSubmitAiKey) {
        el.btnSubmitAiKey.addEventListener('click', async () => {
            const apiKey = el.aiApiKeyInput.value.trim();
            if (!apiKey) {
                showAIFeedback("Please enter your Gemini API key.", "error");
                return;
            }

            hideAIFeedback();
            el.btnSubmitAiKey.disabled = true;
            if (el.btnSubmitAiSpinner) el.btnSubmitAiSpinner.style.display = 'inline-block';
            if (el.btnSubmitAiText) el.btnSubmitAiText.textContent = "Validating with Google...";

            try {
                const res = await fetch(`${API_BASE}/api/user/ai-auth`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        api_key: apiKey,
                        provider: el.aiProviderSelect ? el.aiProviderSelect.value : 'gemini-3.8-flash',
                        validate_key: el.checkValidateKey ? el.checkValidateKey.checked : true
                    }),
                    credentials: 'include'
                });

                const data = await res.json();

                if (res.ok) {
                    userHasAIAuth = true;
                    aiKeyData.masked_key = data.masked_key;
                    aiKeyData.provider = data.provider;
                    aiKeyData.authorized_at = data.authorized_at;

                    updateAIStatus(true, data.masked_key);
                    showAIFeedback(`✅ ${data.message || 'Key connected and encrypted successfully!'}`, "success");

                    setTimeout(() => {
                        if (el.aiSetupOverlay) el.aiSetupOverlay.style.display = 'none';
                        loadPrompts();
                        fetchPosts();
                    }, 800);
                } else {
                    showAIFeedback(`❌ ${data.detail || 'Validation failed. Check your Gemini API key.'}`, "error");
                }
            } catch {
                showAIFeedback("❌ Network error connecting to backend.", "error");
            } finally {
                el.btnSubmitAiKey.disabled = false;
                if (el.btnSubmitAiSpinner) el.btnSubmitAiSpinner.style.display = 'none';
                if (el.btnSubmitAiText) el.btnSubmitAiText.textContent = isAISetupMandatory ? "Connect AI & Unlock" : "Update & Validate Key";
            }
        });
    }

    if (el.btnRevokeAiKey) {
        el.btnRevokeAiKey.addEventListener('click', async () => {
            if (!confirm("Revoke your Gemini API key? Post generation will be disabled until a key is linked.")) return;

            try {
                const res = await fetch(`${API_BASE}/api/user/ai-auth`, {
                    method: 'DELETE',
                    credentials: 'include'
                });

                if (res.ok) {
                    userHasAIAuth = false;
                    aiKeyData.masked_key = null;
                    updateAIStatus(false);
                    showAIFeedback("AI authorization revoked.", "error");
                    showAISetupModal(true);
                } else {
                    alert("Failed to revoke AI key.");
                }
            } catch {
                alert("Network error.");
            }
        });
    }
}

// ==========================================================================
// TONES & PROMPTS
// ==========================================================================
async function loadPrompts() {
    try {
        const res = await fetch(`${API_BASE}/posts/prompts`);
        const data = await res.json();
        if (data.prompts && el.promptSelector) {
            el.promptSelector.innerHTML = '';
            data.prompts.forEach((key, idx) => {
                const label = document.createElement('label');
                label.className = 'tone-chip-label';
                const displayTitle = key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                label.innerHTML = `
                    <input type="radio" name="prompt-type" value="${key}" ${idx === 0 || key === 'humanized' ? 'checked' : ''}>
                    <span class="tone-chip">${displayTitle}</span>
                `;
                el.promptSelector.appendChild(label);
            });
        }
    } catch {
        console.warn('Could not load dynamic prompt styles.');
    }
}

// ==========================================================================
// CREATE VIEW: GENERATION, STREAMING & ACTIONS
// ==========================================================================
function setupCreateListeners() {
    // Send button & Enter in topic input
    if (el.btnDraft) {
        el.btnDraft.addEventListener('click', () => generateDraft());
    }
    if (el.topicInput) {
        el.topicInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                generateDraft();
            }
        });
    }

    // Suggestion Buttons
    document.querySelectorAll('.suggestion-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const prompt = btn.getAttribute('data-fill');
            if (prompt) {
                if (el.topicInput) el.topicInput.value = prompt;
                generateDraft(prompt);
            }
        });
    });

    // Image Upload & Attachment
    if (el.btnAttach && el.imageInput) {
        el.btnAttach.addEventListener('click', () => el.imageInput.click());
    }
    if (el.imageInput) {
        el.imageInput.addEventListener('change', (e) => {
            selectedImages = Array.from(e.target.files);
            renderAttachedMedia();
        });
    }

    // Editable Post Text Buffer Tracking
    if (el.postText) {
        el.postText.addEventListener('input', () => {
            postContentBuffer = el.postText.innerText;
        });
    }

    // Quick Actions
    if (el.btnRegenerate) {
        el.btnRegenerate.addEventListener('click', () => {
            if (lastTopicPrompt) {
                generateDraft(lastTopicPrompt);
            } else if (postContentBuffer) {
                generateDraft(postContentBuffer.substring(0, 80));
            }
        });
    }

    if (el.btnShorter) {
        el.btnShorter.addEventListener('click', () => {
            refineWithPrompt("Make this significantly shorter, concise, punchy and cut any fluff while keeping the core hook and takeaway.");
        });
    }

    if (el.btnLonger) {
        el.btnLonger.addEventListener('click', () => {
            refineWithPrompt("Expand on this post with deeper strategic context, bulleted takeaways, and actionable practical examples.");
        });
    }

    if (el.btnEditFocus && el.postText) {
        el.btnEditFocus.addEventListener('click', () => {
            el.postText.focus();
            const range = document.createRange();
            range.selectNodeContents(el.postText);
            range.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        });
    }

    // Preview & Schedule Modal Open/Close
    if (el.btnOpenPreview && el.previewModal) {
        el.btnOpenPreview.addEventListener('click', () => {
            if (el.postText && el.postText.innerText.trim()) {
                postContentBuffer = el.postText.innerText.trim();
            }
            if (!postContentBuffer) {
                alert("Please draft a post first.");
                return;
            }
            if (el.liModalPreviewText) {
                el.liModalPreviewText.innerText = postContentBuffer;
            }
            renderPreviewImages();
            el.previewModal.style.display = 'flex';
        });
    }

    // In Create Screen Result State: "Save as draft" secondary button
    const btnResultSaveDraft = document.getElementById('btn-result-save-draft');
    if (btnResultSaveDraft) {
        btnResultSaveDraft.addEventListener('click', async () => {
            if (el.postText && el.postText.innerText.trim()) {
                postContentBuffer = el.postText.innerText.trim();
            }
            if (!postContentBuffer) {
                alert("Please draft a post first.");
                return;
            }

            btnResultSaveDraft.disabled = true;
            const origHtml = btnResultSaveDraft.innerHTML;
            btnResultSaveDraft.innerHTML = '<span>Saving...</span>';

            let savedId = Date.now();
            try {
                const formData = new FormData();
                formData.append("content", postContentBuffer);
                selectedImages.forEach(img => formData.append("images", img));

                const res = await fetch(`${API_BASE}/posts/`, {
                    method: 'POST',
                    body: formData,
                    credentials: 'include'
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.id) savedId = data.id;
                }
            } catch (e) {
                console.warn('Backend draft save notice:', e);
            }

            const draftItem = {
                id: savedId,
                content: postContentBuffer,
                status: 'draft',
                image_urls: selectedImages.map(f => URL.createObjectURL(f))
            };

            scheduledPostsStorage = scheduledPostsStorage.filter(p => p.id !== savedId);
            scheduledPostsStorage.unshift(draftItem);
            localStorage.setItem('postly_scheduled_posts', JSON.stringify(scheduledPostsStorage));

            if (!currentPosts.some(p => p.id === savedId)) {
                currentPosts.unshift(draftItem);
            } else {
                currentPosts = currentPosts.map(p => p.id === savedId ? draftItem : p);
            }

            showToast("Draft saved");
            fetchPosts();

            btnResultSaveDraft.disabled = false;
            btnResultSaveDraft.innerHTML = origHtml;
        });
    }

    if (el.btnClosePreview && el.previewModal) {
        el.btnClosePreview.addEventListener('click', () => {
            el.previewModal.style.display = 'none';
        });
    }

    // ==========================================================================
    // PREVIEW ACTIONS AREA (3 ACTIONS IN EXACT ORDER)
    // 1. Schedule (Large black primary button) -> Opens Schedule post bottom sheet
    // 2. Post now (Outlined secondary button)  -> Opens confirmation dialog
    // 3. Save as draft (Plain text link)       -> Saves and switches to Drafts
    // ==========================================================================

    // Action 1: "Schedule" (Large Black Primary Button)
    if (el.btnPreviewSchedule) {
        el.btnPreviewSchedule.addEventListener('click', () => {
            if (!postContentBuffer) return alert('No post drafted yet.');
            openSchedulePostModal();
        });
    }

    // Action 2: "Post now" (Outlined Secondary Button)
    if (el.btnPreviewPostNow) {
        el.btnPreviewPostNow.addEventListener('click', async (event) => {
            event.preventDefault();
            if (!userHasLinkedIn) {
                if (el.postText?.innerText.trim()) postContentBuffer = el.postText.innerText.trim();
                await copyDraftAfterPublishFailure('LinkedIn is disconnected.');
                return;
            }
            if (!postContentBuffer) return alert('No post drafted yet.');
            if (el.confirmPublishDialog) el.confirmPublishDialog.style.display = 'flex';
        });
    }

    // Confirmation Dialog Buttons
    if (el.btnCancelPostNow && el.confirmPublishDialog) {
        el.btnCancelPostNow.addEventListener('click', () => {
            el.confirmPublishDialog.style.display = 'none';
        });
    }

    if (el.btnConfirmPostNow && el.confirmPublishDialog) {
        el.btnConfirmPostNow.addEventListener('click', (event) => {
            event.preventDefault();
            el.confirmPublishDialog.style.display = 'none';
            publishDirectly(event);
        });
    }

    // Action 3: "Save as draft" (Plain Text Link Under Buttons)
    if (el.btnPreviewSaveDraft) {
        el.btnPreviewSaveDraft.addEventListener('click', async () => {
            await saveDraft();
            // Switch to Schedule screen on Drafts tab
            document.querySelectorAll('.filter-segment-tabs .segment-btn').forEach(b => {
                if (b.dataset.filter === 'draft') b.classList.add('active');
                else b.classList.remove('active');
            });
            currentFilter = 'draft';
            switchPage('schedule');
            renderScheduleList(currentPosts, 'draft');
        });
    }

    // Legacy fallback buttons if present
    if (el.btnSave) el.btnSave.addEventListener('click', saveDraft);
    [el.btnPublish, el.stickyPublish, document.getElementById('publish-btn')].filter(Boolean).forEach(button => {
        button.addEventListener('click', event => publishDirectly(event));
    });

    setupSchedulePickerInteractions();
}

function renderAttachedMedia() {
    if (!el.composerAttachedBar) return;
    el.composerAttachedBar.innerHTML = '';

    if (el.imageGrid) el.imageGrid.innerHTML = '';

    selectedImages.forEach((file, index) => {
        const url = URL.createObjectURL(file);

        // Composer bar thumbnail
        const thumb = document.createElement('div');
        thumb.className = 'attached-thumb';
        thumb.innerHTML = `
            <img src="${url}" alt="Attachment">
            <button type="button" class="attached-thumb-remove" data-index="${index}">✕</button>
        `;
        el.composerAttachedBar.appendChild(thumb);

        // Result card thumbnail
        if (el.imageGrid) {
            const img = document.createElement('img');
            img.src = url;
            el.imageGrid.appendChild(img);
        }
    });

    // Remove handlers
    el.composerAttachedBar.querySelectorAll('.attached-thumb-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.dataset.index, 10);
            selectedImages.splice(idx, 1);
            renderAttachedMedia();
        });
    });
}

function renderPreviewImages() {
    if (!el.liModalImageGrid) return;
    el.liModalImageGrid.innerHTML = '';
    selectedImages.forEach(file => {
        const url = URL.createObjectURL(file);
        const img = document.createElement('img');
        img.src = url;
        el.liModalImageGrid.appendChild(img);
    });
}

async function generateDraft(explicitTopic = null) {
    if (isProcessing) return;

    const topic = explicitTopic || (el.topicInput ? el.topicInput.value.trim() : '');
    if (!topic) {
        if (el.topicInput) el.topicInput.focus();
        return;
    }

    lastTopicPrompt = topic;

    // Transition: Hide empty state, Show result state
    if (el.emptyState) el.emptyState.classList.add('hidden');
    if (el.resultState) el.resultState.classList.remove('hidden');

    if (el.userBubble) el.userBubble.textContent = topic;
    if (el.genShimmerLine) el.genShimmerLine.classList.add('active');
    if (el.postText) el.postText.innerText = '';

    isProcessing = true;
    if (el.btnDraft) el.btnDraft.disabled = true;

    const selectedPrompt = document.querySelector('input[name="prompt-type"]:checked')?.value || 'humanized';

    try {
        const res = await fetch(`${API_BASE}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                topic,
                prompt_type: selectedPrompt,
                tone: 'professional'
            }),
            credentials: 'include'
        });

        await streamResponse(res, el.postText);

        if (el.topicInput) el.topicInput.value = '';
    } catch {
        if (el.postText) el.postText.innerText = "Error generating draft. Please check your AI API key in Settings.";
    } finally {
        isProcessing = false;
        if (el.btnDraft) el.btnDraft.disabled = false;
        if (el.genShimmerLine) el.genShimmerLine.classList.remove('active');
    }
}

async function refineWithPrompt(instruction) {
    if (isProcessing || !postContentBuffer) return;

    if (el.genShimmerLine) el.genShimmerLine.classList.add('active');
    isProcessing = true;

    try {
        const res = await fetch(`${API_BASE}/posts/refine`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                current_content: postContentBuffer,
                instruction
            }),
            credentials: 'include'
        });

        await streamResponse(res, el.postText);
    } catch {
        alert("Failed to refine post.");
    } finally {
        isProcessing = false;
        if (el.genShimmerLine) el.genShimmerLine.classList.remove('active');
    }
}

async function streamResponse(res, targetEl) {
    if (!res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    postContentBuffer = '';
    if (targetEl) targetEl.innerText = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        postContentBuffer += chunk;
        if (targetEl) targetEl.innerText = postContentBuffer;
    }

    if (postContentBuffer.includes('[SERVICE_ERROR]') && !userHasAIAuth) {
        setTimeout(() => showAISetupModal(false), 800);
    }
}

// ==========================================================================
// DRAFTS, QUEUE & PUBLISHING
// ==========================================================================
async function fetchPosts() {
    try {
        const res = await fetch(`${API_BASE}/posts/`, { credentials: 'include' });
        if (res.ok) {
            currentPosts = await res.json();
        }
    } catch (e) {
        console.warn('Failed to load posts', e);
    }
    // Merge scheduledPostsStorage into currentPosts so local drafts and scheduled items persist
    scheduledPostsStorage.forEach(sp => {
        if (!currentPosts.some(cp => cp.id === sp.id)) {
            currentPosts.unshift(sp);
        }
    });
    renderHomeStats(currentPosts);
    renderScheduleList(currentPosts, currentFilter);
}

function renderHomeStats(posts) {
    const drafts = posts.filter(p => p.status === 'draft');
    const scheduled = posts.filter(p => p.status === 'scheduled');
    const posted = posts.filter(p => p.status === 'posted');

    if (el.statDrafts) el.statDrafts.textContent = drafts.length;
    if (el.statScheduled) el.statScheduled.textContent = scheduled.length;
    if (el.statPublished) el.statPublished.textContent = posted.length;
    if (el.draftCount) el.draftCount.textContent = drafts.length;

    if (el.homeDraftList) {
        el.homeDraftList.innerHTML = '';
        if (drafts.length === 0) {
            el.homeDraftList.innerHTML = `<div style="font-size: 13px; color: var(--ink-2); padding: 12px 0;">No active drafts. Hit Create to draft your first post!</div>`;
            return;
        }

        drafts.slice(0, 3).forEach(post => {
            const card = document.createElement('div');
            card.className = 'home-draft-card';
            card.innerHTML = `
                <p class="draft-excerpt">${post.content}</p>
                <div class="draft-footer">
                    <span class="draft-tag">✦ Postly Draft</span>
                    <span>Tap to view ›</span>
                </div>
            `;
            card.addEventListener('click', () => {
                postContentBuffer = post.content;
                if (el.postText) el.postText.innerText = post.content;
                if (el.emptyState) el.emptyState.classList.add('hidden');
                if (el.resultState) el.resultState.classList.remove('hidden');
                switchPage('create');
            });
            el.homeDraftList.appendChild(card);
        });
    }
}

// ==========================================================================
// SCHEDULE POST MODAL & TIME PICKER LOGIC
// ==========================================================================
function openSchedulePostModal() {
    if (!el.schedulePostModal) return;
    renderScheduleCalendar(calPickerCurrentYear, calPickerCurrentMonth);
    updateTimeDisplay();
    el.schedulePostModal.style.display = 'flex';
}

function updateTimeDisplay() {
    if (el.timeHourDisplay) el.timeHourDisplay.textContent = selectedScheduleHour;
    if (el.timeMinDisplay) el.timeMinDisplay.textContent = selectedScheduleMinute;
    setTimeAmPm(selectedScheduleAmPm === 'AM');
}

function setTimeAmPm(isAm) {
    selectedScheduleAmPm = isAm ? 'AM' : 'PM';
    if (el.btnTimeAm && el.btnTimePm) {
        if (isAm) {
            el.btnTimeAm.classList.add('active');
            el.btnTimePm.classList.remove('active');
        } else {
            el.btnTimePm.classList.add('active');
            el.btnTimeAm.classList.remove('active');
        }
    }
}

function renderScheduleCalendar(year, month) {
    if (!el.calPickerDatesGrid) return;
    el.calPickerDatesGrid.innerHTML = '';

    const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    if (el.calPickerMonthName) {
        el.calPickerMonthName.textContent = `${monthNames[month]} ${year}`;
    }

    const firstDay = new Date(year, month, 1);
    const startDay = firstDay.getDay(); // 0 is Sun, 1 is Mon...
    const mondayOffset = (startDay + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Leading empty slots for Mon-Sun calendar
    for (let i = 0; i < mondayOffset; i++) {
        const blank = document.createElement('span');
        blank.className = 'cal-picker-day-btn empty';
        el.calPickerDatesGrid.appendChild(blank);
    }

    // Days 1..daysInMonth
    for (let d = 1; d <= daysInMonth; d++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `cal-picker-day-btn ${d === selectedScheduleDate ? 'selected' : ''}`;
        btn.textContent = d;
        btn.addEventListener('click', () => {
            selectedScheduleDate = d;
            document.querySelectorAll('.cal-picker-day-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
        });
        el.calPickerDatesGrid.appendChild(btn);
    }
}

function setupSchedulePickerInteractions() {
    // Close button
    if (el.btnCloseSchedulePost && el.schedulePostModal) {
        el.btnCloseSchedulePost.addEventListener('click', () => {
            el.schedulePostModal.style.display = 'none';
        });
    }

    // Month Navigation
    if (el.btnCalPickerPrev) {
        el.btnCalPickerPrev.addEventListener('click', () => {
            calPickerCurrentMonth--;
            if (calPickerCurrentMonth < 0) {
                calPickerCurrentMonth = 11;
                calPickerCurrentYear--;
            }
            renderScheduleCalendar(calPickerCurrentYear, calPickerCurrentMonth);
        });
    }

    if (el.btnCalPickerNext) {
        el.btnCalPickerNext.addEventListener('click', () => {
            calPickerCurrentMonth++;
            if (calPickerCurrentMonth > 11) {
                calPickerCurrentMonth = 0;
                calPickerCurrentYear++;
            }
            renderScheduleCalendar(calPickerCurrentYear, calPickerCurrentMonth);
        });
    }

    // Hour Adjustment
    if (el.pillHour) {
        el.pillHour.addEventListener('click', () => {
            let h = parseInt(selectedScheduleHour, 10);
            h = h >= 12 ? 1 : h + 1;
            selectedScheduleHour = h < 10 ? `0${h}` : `${h}`;
            updateTimeDisplay();
        });
    }

    // Minute Adjustment (00, 15, 30, 45)
    if (el.pillMinute) {
        el.pillMinute.addEventListener('click', () => {
            const mins = ['00', '15', '30', '45'];
            let idx = mins.indexOf(selectedScheduleMinute);
            idx = (idx + 1) % mins.length;
            selectedScheduleMinute = mins[idx];
            updateTimeDisplay();
        });
    }

    // AM/PM Toggles
    if (el.btnTimeAm) el.btnTimeAm.addEventListener('click', () => setTimeAmPm(true));
    if (el.btnTimePm) el.btnTimePm.addEventListener('click', () => setTimeAmPm(false));

    // Green Recommendation Chip: "⚡ Best time: Mon 8:45 AM"
    if (el.btnBestTimeChip) {
        el.btnBestTimeChip.addEventListener('click', () => {
            selectedScheduleHour = '08';
            selectedScheduleMinute = '45';
            selectedScheduleAmPm = 'AM';
            selectedScheduleDate = 16; // Monday Nov 16
            calPickerCurrentMonth = 10;
            calPickerCurrentYear = 2026;
            updateTimeDisplay();
            renderScheduleCalendar(calPickerCurrentYear, calPickerCurrentMonth);

            el.btnBestTimeChip.style.transform = 'scale(0.97)';
            setTimeout(() => {
                if (el.btnBestTimeChip) el.btnBestTimeChip.style.transform = 'none';
            }, 140);
        });
    }

    // Confirm Schedule Button
    if (el.btnConfirmSchedule) {
        el.btnConfirmSchedule.addEventListener('click', async () => {
            if (!postContentBuffer) return alert('No post content to schedule.');

            const origText = el.btnConfirmSchedule.textContent;
            el.btnConfirmSchedule.disabled = true;
            el.btnConfirmSchedule.textContent = 'Scheduling post...';

            const formattedTime = `Mon, Nov ${selectedScheduleDate} • ${selectedScheduleHour}:${selectedScheduleMinute} ${selectedScheduleAmPm}`;

            try {
                // 1. Save draft to backend if new post
                const formData = new FormData();
                formData.append("content", postContentBuffer);
                selectedImages.forEach(img => formData.append("images", img));

                let savedId = (activeDetailPost && activeDetailPost.id) ? activeDetailPost.id : Date.now();
                if (!activeDetailPost) {
                    try {
                        const res = await fetch(`${API_BASE}/posts/`, {
                            method: 'POST',
                            body: formData,
                            credentials: 'include'
                        });
                        if (res.ok) {
                            const savedData = await res.json();
                            if (savedData && savedData.id) savedId = savedData.id;
                        }
                    } catch (e) {
                        console.warn("Backend save notice:", e);
                    }
                }

                // 2. Persist scheduled item to storage
                const scheduledItem = {
                    id: savedId,
                    content: postContentBuffer,
                    status: 'scheduled',
                    scheduled_at: formattedTime,
                    day: selectedScheduleDate,
                    image_urls: (activeDetailPost && activeDetailPost.image_urls && activeDetailPost.image_urls.length)
                        ? activeDetailPost.image_urls
                        : selectedImages.map(f => URL.createObjectURL(f))
                };

                scheduledPostsStorage = scheduledPostsStorage.filter(p => p.id !== savedId);
                scheduledPostsStorage.unshift(scheduledItem);
                localStorage.setItem('postly_scheduled_posts', JSON.stringify(scheduledPostsStorage));

                // If currently editing activeDetailPost, update its fields & badge immediately
                if (activeDetailPost && activeDetailPost.id === savedId) {
                    activeDetailPost.status = 'scheduled';
                    activeDetailPost.scheduled_at = formattedTime;
                    activeDetailPost.day = selectedScheduleDate;
                    if (el.detailsStatusBadge) {
                        el.detailsStatusBadge.className = 'details-status-badge scheduled';
                        el.detailsStatusBadge.textContent = `Scheduled · ${formattedTime}`;
                    }
                    if (el.detailsRescheduleLabel) {
                        el.detailsRescheduleLabel.textContent = 'Reschedule';
                    }
                }

                // 3. Close bottom sheets
                if (el.schedulePostModal) el.schedulePostModal.style.display = 'none';
                if (el.previewModal) el.previewModal.style.display = 'none';

                // 4. Switch to Schedule screen
                switchPage('schedule');

                // 5. Highlight chosen date in calendar week strip and refresh list
                renderWeekStrip(selectedScheduleDate);
                fetchPosts();
            } finally {
                el.btnConfirmSchedule.disabled = false;
                el.btnConfirmSchedule.textContent = origText;
            }
        });
    }
}

// ==========================================================================
// SCHEDULE LIST & TIMELINE RENDERING
// ==========================================================================
function renderScheduleList(posts, filter = 'all') {
    if (!el.scheduleList) return;
    el.scheduleList.innerHTML = '';
    updateScheduleDraftsTopAction();

    // Merge backend posts with local scheduled posts
    const allCombined = [...scheduledPostsStorage];
    posts.forEach(p => {
        if (!allCombined.some(item => item.id === p.id)) {
            allCombined.push(p);
        }
    });

    const filtered = allCombined.filter(p => {
        if (filter === 'all') return true;
        if (filter === 'draft') return p.status === 'draft';
        if (filter === 'posted') return p.status === 'posted';
        return p.status === filter;
    });

    // Requirement 4: Centered empty state for Drafts tab
    if (filtered.length === 0) {
        if (filter === 'draft') {
            el.scheduleList.innerHTML = `
                <div class="empty-drafts-container">
                    <div class="empty-drafts-icon">📝</div>
                    <h3 class="empty-drafts-title">No drafts yet</h3>
                    <p class="empty-drafts-hint">Ideas and post drafts you save will appear here.</p>
                    <button id="btn-empty-create-post" class="btn-empty-create-post" type="button">Create post</button>
                </div>
            `;
            const btnEmpty = el.scheduleList.querySelector('#btn-empty-create-post');
            if (btnEmpty) btnEmpty.addEventListener('click', openEmptyCreateComposer);
            return;
        } else {
            el.scheduleList.innerHTML = `<div style="font-size: 13px; color: var(--ink-2); text-align: center; padding: 32px 16px;">No posts match this filter.</div>`;
            return;
        }
    }

    filtered.forEach(post => {
        const isScheduled = post.status === 'scheduled';
        const isDraft = post.status === 'draft';
        const isPosted = post.status === 'posted';

        if (isDraft) {
            // Requirement 3: Draft card with ⋯ menu (Open, Edit, Duplicate, Delete) & Swipe left to delete
            const swipeContainer = document.createElement('div');
            swipeContainer.className = 'swipe-card-container';
            swipeContainer.dataset.postId = post.id;

            swipeContainer.innerHTML = `
                <div class="swipe-delete-action" title="Delete draft">
                    <svg fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
                        <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span>Delete</span>
                </div>
                <div class="timeline-post-card swipeable-content">
                    <div class="timeline-card-header">
                        <span class="status-badge status-draft">
                            📝 Draft
                        </span>
                        <div class="draft-card-more-wrapper">
                            <button class="btn-draft-card-more" type="button" title="Draft options">⋯</button>
                            <div class="draft-card-dropdown" style="display: none;">
                                <button class="draft-dropdown-item draft-action-open" type="button">
                                    <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                                    <span>Open</span>
                                </button>
                                <button class="draft-dropdown-item draft-action-edit" type="button">
                                    <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                                    <span>Edit</span>
                                </button>
                                <button class="draft-dropdown-item draft-action-duplicate" type="button">
                                    <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"/></svg>
                                    <span>Duplicate</span>
                                </button>
                                <button class="draft-dropdown-item draft-action-delete danger" type="button">
                                    <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                                    <span>Delete</span>
                                </button>
                            </div>
                        </div>
                    </div>
                    <p class="timeline-content-preview">${post.content.length > 200 ? post.content.substring(0, 200) + '...' : post.content}</p>
                    ${post.image_urls && post.image_urls.length ? `
                        <div class="timeline-images-strip">
                            ${post.image_urls.map(u => `<img src="${u}" alt="Post image">`).join('')}
                        </div>
                    ` : ''}
                    <div class="timeline-card-actions">
                        ${userHasLinkedIn ? `<button class="btn-mini-publish btn-schedule-publish-now">Publish Now</button>` : ''}
                        <button class="btn-mini-publish btn-schedule-open" style="background:#EAEAE6; color:var(--ink);">Open</button>
                    </div>
                </div>
            `;

            const card = swipeContainer.querySelector('.swipeable-content');

            // Card click -> Post Details (if not dragging or clicking buttons)
            let dragMoved = false;
            card.addEventListener('click', (e) => {
                if (dragMoved) return;
                if (e.target.closest('button')) return;
                openPostDetails(post);
            });

            // ⋯ menu dropdown
            const btnMore = swipeContainer.querySelector('.btn-draft-card-more');
            const dropdown = swipeContainer.querySelector('.draft-card-dropdown');
            if (btnMore && dropdown) {
                btnMore.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isOpen = dropdown.style.display === 'block';
                    document.querySelectorAll('.draft-card-dropdown').forEach(d => d.style.display = 'none');
                    dropdown.style.display = isOpen ? 'none' : 'block';
                });
            }

            // Dropdown: Open
            const optOpen = swipeContainer.querySelector('.draft-action-open');
            if (optOpen) {
                optOpen.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (dropdown) dropdown.style.display = 'none';
                    openPostDetails(post);
                });
            }

            // Dropdown: Edit
            const optEdit = swipeContainer.querySelector('.draft-action-edit');
            if (optEdit) {
                optEdit.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (dropdown) dropdown.style.display = 'none';
                    loadIntoEditor(post.id);
                });
            }

            // Dropdown: Duplicate
            const optDup = swipeContainer.querySelector('.draft-action-duplicate');
            if (optDup) {
                optDup.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (dropdown) dropdown.style.display = 'none';
                    duplicateDraft(post);
                });
            }

            // Dropdown: Delete (red)
            const optDel = swipeContainer.querySelector('.draft-action-delete');
            if (optDel) {
                optDel.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (dropdown) dropdown.style.display = 'none';
                    openDeleteDraftModal(post);
                });
            }

            // Open button
            const btnOpen = swipeContainer.querySelector('.btn-schedule-open');
            if (btnOpen) {
                btnOpen.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openPostDetails(post);
                });
            }

            // Publish now button
            const btnPub = swipeContainer.querySelector('.btn-schedule-publish-now');
            if (btnPub) {
                btnPub.addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.publishQueuePost(post.id);
                });
            }

            // Attach swipe left to delete gesture
            attachSwipeToDelete(swipeContainer, post, (moved) => { dragMoved = moved; });

            el.scheduleList.appendChild(swipeContainer);
        } else {
            // Scheduled or Published Card
            const card = document.createElement('div');
            card.className = 'timeline-post-card';

            card.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                openPostDetails(post);
            });

            card.innerHTML = `
                <div class="timeline-card-header">
                    ${isScheduled ? `
                        <span class="status-badge status-scheduled">
                            <span class="scheduled-dot"></span> Scheduled
                        </span>
                    ` : `
                        <span class="status-badge status-posted">
                            🟢 Published
                        </span>
                    `}
                    <button class="btn-card-delete" title="Delete post">✕</button>
                </div>
                ${isScheduled && post.scheduled_at ? `
                    <div style="font-size: 12.5px; font-weight: 600; color: #006E2B; display: flex; align-items: center; gap: 5px; margin-top: 2px;">
                        <span>📅</span>
                        <span>${post.scheduled_at}</span>
                    </div>
                ` : ''}
                <p class="timeline-content-preview">${post.content.length > 200 ? post.content.substring(0, 200) + '...' : post.content}</p>
                ${post.image_urls && post.image_urls.length ? `
                    <div class="timeline-images-strip">
                        ${post.image_urls.map(u => `<img src="${u}" alt="Post image">`).join('')}
                    </div>
                ` : ''}
                <div class="timeline-card-actions">
                    ${isScheduled && userHasLinkedIn ? `<button class="btn-mini-publish btn-schedule-publish-now">Publish Now</button>` : ''}
                    <button class="btn-mini-publish btn-schedule-open" style="background:#EAEAE6; color:var(--ink);">Open</button>
                </div>
            `;

            const btnDelete = card.querySelector('.btn-card-delete');
            if (btnDelete) {
                btnDelete.addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.deletePost(post.id);
                });
            }

            const btnPublishNow = card.querySelector('.btn-schedule-publish-now');
            if (btnPublishNow) {
                btnPublishNow.addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.publishQueuePost(post.id);
                });
            }

            const btnOpen = card.querySelector('.btn-schedule-open');
            if (btnOpen) {
                btnOpen.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openPostDetails(post);
                });
            }

            el.scheduleList.appendChild(card);
        }
    });
}

// Global actions
window.deletePost = async function (id) {
    if (!confirm('Are you sure you want to delete this post?')) return;
    try {
        await fetch(`${API_BASE}/posts/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
    } catch (e) {
        console.warn('Backend delete error:', e);
    }
    scheduledPostsStorage = scheduledPostsStorage.filter(p => p.id !== id);
    localStorage.setItem('postly_scheduled_posts', JSON.stringify(scheduledPostsStorage));
    currentPosts = currentPosts.filter(p => p.id !== id);
    fetchPosts();
    renderScheduleList(currentPosts, currentFilter);
};

window.publishQueuePost = async function (id) {
    const post = currentPosts.find(p => p.id === id) || scheduledPostsStorage.find(p => p.id === id);
    if (!post) return;
    activeDetailPost = post;
    postContentBuffer = post.content;
    if (!userHasLinkedIn) {
        alert('Please connect your LinkedIn account in Settings first.');
        switchPage('settings');
        return;
    }
    if (el.confirmPublishDialog) el.confirmPublishDialog.style.display = 'flex';
};

window.loadIntoEditor = (id) => {
    const post = currentPosts.find(p => p.id === id) || scheduledPostsStorage.find(p => p.id === id);
    if (!post) return;
    openPostDetails(post);
};

// Helper to escape HTML and style #hashtags in LinkedIn blue
function formatPostTextWithHashtags(text) {
    if (!text) return '';
    const escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    return escaped.replace(/(#[a-zA-Z0-9_]+)/g, '<span class="li-hashtag">$1</span>');
}

// Function to populate and open Post Details screen
function openPostDetails(post) {
    if (!post) return;
    activeDetailPost = post;

    // Top Bar Status Label: ("Draft" in gray, or "Scheduled · Mon 8:45 AM" in green)
    if (el.detailsStatusBadge) {
        el.detailsStatusBadge.className = 'details-status-badge';
        if (post.status === 'scheduled') {
            el.detailsStatusBadge.classList.add('scheduled');
            const timeText = post.scheduled_at ? `Scheduled · ${post.scheduled_at}` : 'Scheduled · Mon 8:45 AM';
            el.detailsStatusBadge.textContent = timeText;
        } else if (post.status === 'posted') {
            el.detailsStatusBadge.classList.add('posted');
            el.detailsStatusBadge.textContent = 'Published';
        } else {
            el.detailsStatusBadge.classList.add('draft');
            el.detailsStatusBadge.textContent = 'Draft';
        }
    }

    // Header Meta: Avatar & Name
    if (el.detailsPostAvatar) {
        el.detailsPostAvatar.textContent = (el.avatarInitials && el.avatarInitials.textContent) ? el.avatarInitials.textContent : 'AL';
    }
    if (el.detailsPostName) {
        el.detailsPostName.textContent = (el.homeUserName && el.homeUserName.textContent) ? el.homeUserName.textContent : 'Alex Creator';
    }
    if (el.detailsPostTime) {
        if (post.status === 'scheduled') {
            el.detailsPostTime.textContent = post.scheduled_at ? `Scheduled for ${post.scheduled_at} • 🌐` : 'Scheduled • 🌐';
        } else if (post.status === 'posted') {
            el.detailsPostTime.textContent = 'Published to LinkedIn • 🌐';
        } else {
            el.detailsPostTime.textContent = 'Draft preview • 🌐';
        }
    }

    // Main Area: LinkedIn post preview text with styled hashtags
    if (el.detailsPostContent) {
        el.detailsPostContent.innerHTML = formatPostTextWithHashtags(post.content || '');
    }

    // Attached Images
    if (el.detailsImageGrid) {
        el.detailsImageGrid.innerHTML = '';
        const images = post.image_urls || post.images || [];
        if (images.length > 0) {
            el.detailsImageGrid.style.display = 'grid';
            images.forEach(imgUrl => {
                const img = document.createElement('img');
                img.src = imgUrl;
                img.alt = 'Post media';
                el.detailsImageGrid.appendChild(img);
            });
        } else {
            el.detailsImageGrid.style.display = 'none';
        }
    }

    // Sticky Bottom Bar: Action 1 label ("Schedule" for draft, "Reschedule" for scheduled)
    if (el.detailsRescheduleLabel) {
        if (post.status === 'draft') {
            el.detailsRescheduleLabel.textContent = 'Schedule';
        } else {
            el.detailsRescheduleLabel.textContent = 'Reschedule';
        }
    }

    // Ensure ⋯ menu popup starts closed
    if (el.detailsMorePopup) {
        el.detailsMorePopup.style.display = 'none';
    }

    // Switch to Post Details page
    switchPage('post-details');
}

// Setup Event Listeners for Post Details screen
function setupPostDetails() {
    // Top Bar Back Arrow -> returns to Schedule
    if (el.btnDetailsBack) {
        el.btnDetailsBack.addEventListener('click', () => {
            switchPage('schedule');
        });
    }

    // Under Preview: "Edit caption" text link -> opens Create screen with this post loaded
    if (el.btnDetailsEditCaption) {
        el.btnDetailsEditCaption.addEventListener('click', () => {
            if (!activeDetailPost) return;
            postContentBuffer = activeDetailPost.content || '';
            if (el.postText) el.postText.innerText = postContentBuffer;
            if (el.emptyState) el.emptyState.classList.add('hidden');
            if (el.resultState) el.resultState.classList.remove('hidden');
            switchPage('create');
        });
    }

    // Sticky Action 1: Reschedule (or Schedule for drafts) -> opens bottom sheet modal
    if (el.btnDetailsReschedule) {
        el.btnDetailsReschedule.addEventListener('click', () => {
            if (!activeDetailPost) return;
            postContentBuffer = activeDetailPost.content;
            if (el.schedulePostModal) el.schedulePostModal.style.display = 'flex';
        });
    }

    // Sticky Action 2: Post now -> opens confirmation dialog
    if (el.btnDetailsPostNow) {
        el.btnDetailsPostNow.addEventListener('click', () => {
            if (!activeDetailPost) return;
            if (!userHasLinkedIn) {
                alert('Please connect your LinkedIn account in Settings first.');
                switchPage('settings');
                return;
            }
            postContentBuffer = activeDetailPost.content;
            if (el.confirmPublishDialog) el.confirmPublishDialog.style.display = 'flex';
        });
    }

    // Sticky Action 3: ⋯ menu button -> toggles Duplicate and Delete dropdown
    if (el.btnDetailsMoreMenu && el.detailsMorePopup) {
        el.btnDetailsMoreMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = el.detailsMorePopup.style.display === 'block';
            el.detailsMorePopup.style.display = isOpen ? 'none' : 'block';
        });
    }

    // Close ⋯ menu when clicking outside
    document.addEventListener('click', (e) => {
        if (el.detailsMorePopup && !e.target.closest('.details-more-container')) {
            el.detailsMorePopup.style.display = 'none';
        }
    });

    // Duplicate draft
    if (el.btnDetailsDuplicate) {
        el.btnDetailsDuplicate.addEventListener('click', async () => {
            if (!activeDetailPost) return;
            if (el.detailsMorePopup) el.detailsMorePopup.style.display = 'none';

            const newDraft = {
                id: Date.now(),
                content: activeDetailPost.content,
                status: 'draft',
                image_urls: activeDetailPost.image_urls ? [...activeDetailPost.image_urls] : []
            };

            try {
                const formData = new FormData();
                formData.append("content", newDraft.content);
                const res = await fetch(`${API_BASE}/posts/`, {
                    method: 'POST',
                    body: formData,
                    credentials: 'include'
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.id) newDraft.id = data.id;
                }
            } catch (e) {
                console.warn('Backend draft save notice:', e);
            }

            scheduledPostsStorage.unshift(newDraft);
            localStorage.setItem('postly_scheduled_posts', JSON.stringify(scheduledPostsStorage));
            currentPosts.unshift(newDraft);
            renderScheduleList(currentPosts, currentFilter);
            fetchPosts();
            alert('Post duplicated to drafts!');
            switchPage('schedule');
        });
    }

    // Delete post (red)
    if (el.btnDetailsDelete) {
        el.btnDetailsDelete.addEventListener('click', async () => {
            if (!activeDetailPost) return;
            if (el.detailsMorePopup) el.detailsMorePopup.style.display = 'none';

            if (!confirm('Are you sure you want to delete this post?')) return;

            const idToDelete = activeDetailPost.id;
            try {
                await fetch(`${API_BASE}/posts/${idToDelete}`, {
                    method: 'DELETE',
                    credentials: 'include'
                });
            } catch (e) {
                console.warn('Backend delete error:', e);
            }

            scheduledPostsStorage = scheduledPostsStorage.filter(p => p.id !== idToDelete);
            localStorage.setItem('postly_scheduled_posts', JSON.stringify(scheduledPostsStorage));
            currentPosts = currentPosts.filter(p => p.id !== idToDelete);
            activeDetailPost = null;

            fetchPosts();
            switchPage('schedule');
        });
    }
}

async function saveDraft() {
    if (!postContentBuffer) return alert('Nothing to save.');
    if (el.btnSave) {
        el.btnSave.disabled = true;
        el.btnSave.textContent = 'Saving...';
    }

    const formData = new FormData();
    formData.append("content", postContentBuffer);
    selectedImages.forEach(img => formData.append("images", img));

    try {
        await fetch(`${API_BASE}/posts/`, {
            method: 'POST',
            body: formData,
            credentials: 'include'
        });
        fetchPosts();
        if (el.previewModal) el.previewModal.style.display = 'none';
        alert('Draft saved successfully to queue!');
        switchPage('schedule');
    } catch {
        alert('Failed to save draft.');
    } finally {
        if (el.btnSave) {
            el.btnSave.disabled = false;
            el.btnSave.textContent = 'Save as Draft';
        }
    }
}

async function copyDraftAfterPublishFailure(message) {
    const draft = (el.postText?.innerText || postContentBuffer || '').trim();
    if (!draft) {
        showToast(message || 'Nothing to copy');
        return false;
    }
    try {
        await navigator.clipboard.writeText(draft);
        showToast(`${message || 'LinkedIn unavailable'} Draft copied to clipboard`);
        return true;
    } catch (error) {
        console.error('Clipboard fallback failed:', error);
        showToast('Could not publish or copy the draft. Please copy it manually.');
        return false;
    }
}

async function publishDirectly(event) {
    event?.preventDefault();
    if (el.postText?.innerText.trim()) postContentBuffer = el.postText.innerText.trim();
    if (!userHasLinkedIn) {
        await copyDraftAfterPublishFailure('LinkedIn is disconnected.');
        return;
    }
    if (!postContentBuffer) return showToast('Nothing to publish.');

    if (el.btnPublish) {
        el.btnPublish.disabled = true;
        el.btnPublish.textContent = 'Publishing to LinkedIn...';
    }

    const formData = new FormData();
    formData.append("text", postContentBuffer);
    selectedImages.forEach(img => formData.append("images", img));

    try {
        const res = await fetch(`${API_BASE}/posts/publish-direct`, {
            method: 'POST',
            body: formData,
            credentials: 'include'
        });
        if (res.ok) {
            alert('🎉 Published successfully to your LinkedIn profile!');
            if (el.previewModal) el.previewModal.style.display = 'none';
            fetchPosts();
            switchPage('schedule');
        } else {
            let detail = 'Could not post to LinkedIn.';
            try {
                const err = await res.json();
                detail = typeof err.detail === 'string' ? err.detail : (err.detail?.message || detail);
            } catch {}
            console.error('LinkedIn publish failed:', res.status, detail);
            await copyDraftAfterPublishFailure('LinkedIn publishing failed.');
        }
    } catch (error) {
        console.error('LinkedIn publish request failed:', error);
        await copyDraftAfterPublishFailure('Network error while publishing.');
    } finally {
        if (el.btnPublish) {
            el.btnPublish.disabled = false;
            el.btnPublish.textContent = 'Publish Now';
        }
    }
}

// ==========================================================================
// SCHEDULE VIEW (CALENDAR STRIP & FILTER SEGMENTS)
// ==========================================================================
function renderWeekStrip(activeDayOverride = null) {
    if (!el.weekGrid) return;
    el.weekGrid.innerHTML = '';

    const today = new Date();
    const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() - today.getDay() + i);
        const dayNum = date.getDate();

        const isToday = date.toDateString() === today.toDateString();
        const isActive = activeDayOverride ? (dayNum === activeDayOverride) : isToday;

        // Check if there are scheduled posts on this day
        const hasScheduledPost = scheduledPostsStorage.some(p => p.day === dayNum) || (activeDayOverride === dayNum);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `week-day-btn ${isActive ? 'active' : ''}`;
        btn.innerHTML = `
            <span class="week-day-name">${dayNames[date.getDay()]}</span>
            <span class="week-day-num">${dayNum}</span>
            <span class="day-dot ${hasScheduledPost ? 'has-post' : ''}"></span>
        `;
        btn.addEventListener('click', () => {
            document.querySelectorAll('.week-day-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
        el.weekGrid.appendChild(btn);
    }
}

function setupScheduleListeners() {
    document.querySelectorAll('.filter-segment-tabs .segment-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-segment-tabs .segment-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            updateScheduleDraftsTopAction();
            renderScheduleList(currentPosts, currentFilter);
        });
    });

    const btnScheduleNewDraft = document.getElementById('btn-schedule-new-draft');
    if (btnScheduleNewDraft) {
        btnScheduleNewDraft.addEventListener('click', openEmptyCreateComposer);
    }

    // Modal buttons for delete draft
    const btnCancelDel = document.getElementById('btn-cancel-delete-draft');
    if (btnCancelDel) {
        btnCancelDel.addEventListener('click', closeDeleteDraftModal);
    }

    const btnConfirmDel = document.getElementById('btn-confirm-delete-draft');
    if (btnConfirmDel) {
        btnConfirmDel.addEventListener('click', async () => {
            if (!postPendingDelete) return;
            const idToDelete = postPendingDelete.id;
            closeDeleteDraftModal();
            await window.deleteDraftSilently(idToDelete);
        });
    }

    // Close any open draft dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.draft-card-more-wrapper')) {
            document.querySelectorAll('.draft-card-dropdown').forEach(d => d.style.display = 'none');
        }
    });
}

// Helpers for Drafts and Toast
let postPendingDelete = null;

function openDeleteDraftModal(post) {
    if (!post) return;
    postPendingDelete = post;
    const modal = document.getElementById('delete-draft-modal');
    if (modal) modal.style.display = 'flex';
}

function closeDeleteDraftModal() {
    postPendingDelete = null;
    const modal = document.getElementById('delete-draft-modal');
    if (modal) modal.style.display = 'none';
}

window.deleteDraftSilently = async function (id) {
    try {
        await fetch(`${API_BASE}/posts/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
    } catch (e) {
        console.warn('Backend delete draft notice:', e);
    }
    scheduledPostsStorage = scheduledPostsStorage.filter(p => p.id !== id);
    localStorage.setItem('postly_scheduled_posts', JSON.stringify(scheduledPostsStorage));
    currentPosts = currentPosts.filter(p => p.id !== id);
    showToast("Draft deleted");
    fetchPosts();
    renderScheduleList(currentPosts, currentFilter);
};

async function duplicateDraft(post) {
    if (!post) return;
    const newDraft = {
        id: Date.now(),
        content: post.content,
        status: 'draft',
        image_urls: post.image_urls ? [...post.image_urls] : []
    };

    try {
        const formData = new FormData();
        formData.append("content", newDraft.content);
        const res = await fetch(`${API_BASE}/posts/`, {
            method: 'POST',
            body: formData,
            credentials: 'include'
        });
        if (res.ok) {
            const data = await res.json();
            if (data && data.id) newDraft.id = data.id;
        }
    } catch (e) {
        console.warn('Backend draft save notice:', e);
    }

    scheduledPostsStorage.unshift(newDraft);
    localStorage.setItem('postly_scheduled_posts', JSON.stringify(scheduledPostsStorage));
    currentPosts.unshift(newDraft);
    showToast("Draft duplicated");
    renderScheduleList(currentPosts, currentFilter);
    fetchPosts();
}

function openEmptyCreateComposer() {
    postContentBuffer = '';
    selectedImages = [];
    if (el.topicInput) el.topicInput.value = '';
    if (el.postText) el.postText.innerText = '';
    if (el.composerAttachedBar) el.composerAttachedBar.innerHTML = '';
    if (el.imageGrid) el.imageGrid.innerHTML = '';
    if (el.resultState) el.resultState.classList.add('hidden');
    if (el.emptyState) el.emptyState.classList.remove('hidden');
    switchPage('create');
    setTimeout(() => {
        if (el.topicInput) el.topicInput.focus();
    }, 120);
}

function updateScheduleDraftsTopAction() {
    const draftsTopAction = document.getElementById('schedule-drafts-top-action');
    if (draftsTopAction) {
        draftsTopAction.style.display = currentFilter === 'draft' ? 'block' : 'none';
    }
}

function showToast(message = "Draft saved") {
    const toast = document.getElementById('postly-toast');
    if (!toast) return;
    const msgEl = document.getElementById('toast-message');
    if (msgEl) msgEl.textContent = message;
    toast.style.display = 'flex';
    void toast.offsetWidth;
    toast.classList.add('show');

    if (window._toastTimeout) clearTimeout(window._toastTimeout);
    window._toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.style.display = 'none';
        }, 260);
    }, 2400);
}

// Swipe to delete handler
function attachSwipeToDelete(container, post, onMoveFlag) {
    const card = container.querySelector('.swipeable-content');
    const deleteAction = container.querySelector('.swipe-delete-action');
    if (!card || !deleteAction) return;

    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let isSwiping = false;
    let isHorizontal = false;

    deleteAction.addEventListener('click', (e) => {
        e.stopPropagation();
        card.style.transform = 'translateX(0)';
        openDeleteDraftModal(post);
    });

    const onStart = (clientX, clientY) => {
        startX = clientX;
        startY = clientY;
        currentX = clientX;
        isSwiping = true;
        isHorizontal = false;
        if (onMoveFlag) onMoveFlag(false);
    };

    const onMove = (clientX, clientY) => {
        if (!isSwiping) return;
        currentX = clientX;
        const dx = currentX - startX;
        const dy = clientY - startY;

        if (!isHorizontal) {
            if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
                isHorizontal = true;
                if (onMoveFlag) onMoveFlag(true);
                card.classList.add('dragging');
            } else if (Math.abs(dy) > 10) {
                isSwiping = false;
                card.classList.remove('dragging');
                return;
            }
        }

        if (isHorizontal && dx < 0) {
            const clamped = Math.max(dx, -110);
            card.style.transform = `translateX(${clamped}px)`;
        }
    };

    const onEnd = () => {
        if (!isSwiping) return;
        isSwiping = false;
        card.classList.remove('dragging');
        const dx = currentX - startX;

        if (isHorizontal && dx < -55) {
            card.style.transform = 'translateX(-84px)';
            setTimeout(() => {
                card.style.transform = 'translateX(0)';
                if (onMoveFlag) setTimeout(() => onMoveFlag(false), 50);
                openDeleteDraftModal(post);
            }, 140);
        } else {
            card.style.transform = 'translateX(0)';
            if (onMoveFlag) setTimeout(() => onMoveFlag(false), 50);
        }
    };

    card.addEventListener('touchstart', (e) => {
        onStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    card.addEventListener('touchmove', (e) => {
        onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    card.addEventListener('touchend', onEnd);
    card.addEventListener('touchcancel', onEnd);

    // Mouse drag support
    let mouseActive = false;
    card.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        mouseActive = true;
        onStart(e.clientX, e.clientY);
    });

    window.addEventListener('mousemove', (e) => {
        if (!mouseActive) return;
        onMove(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', () => {
        if (!mouseActive) return;
        mouseActive = false;
        onEnd();
    });
}

// ==========================================================================
// SETTINGS VIEW
// ==========================================================================
function setupSettingsListeners() {
    if (el.btnLogout) {
        el.btnLogout.addEventListener('click', async () => {
            if (!confirm("Are you sure you want to log out?")) return;
            try {
                if (supabaseClient) await supabaseClient.auth.signOut();
                await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
                window.location.reload();
            } catch {
                window.location.reload();
            }
        });
    }
}
