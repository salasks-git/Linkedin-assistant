import os
import string
from typing import Optional, Tuple, List
from google import genai
from core.config import settings
from services.prompts import PROMPTS

# Preferred Gemini 3.x models
REQUESTED_MODELS: List[str] = [
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-pro",
    "models/gemini-3.6-flash",
    "models/gemini-3.5-flash-lite",
    "models/gemini-3.1-pro",
    "gemini-3.5-flash",
    "gemini-3.0-flash",
    "gemini-2.5-flash",
    "gemini-1.5-flash"
]

# Fallback default model
MODEL = settings.DEFAULT_AI_MODEL or "gemini-3.6-flash"


def get_genai_client(api_key: Optional[str] = None) -> Optional[genai.Client]:
    """Returns a Google GenAI Client with either the user's key or the system fallback key."""
    key = (api_key or "").strip() or settings.GOOGLE_API_KEY
    if not key:
        return None
    try:
        return genai.Client(api_key=key)
    except Exception as e:
        print(f"Failed to create genai.Client: {e}")
        return None


def get_available_gemini_models(client: genai.Client, preferred_model: Optional[str] = None) -> List[str]:
    """
    Queries Google ModelService.ListModels to discover all valid models
    associated with this user's API key, prioritizing Gemini 3.6 Flash,
    3.5 Flash Lite, and 3.1 Pro.
    """
    discovered: List[str] = []
    try:
        pager = client.models.list()
        for m in pager:
            actions = getattr(m, "supported_actions", None) or []
            name = getattr(m, "name", "")
            if not name:
                continue
            # Only consider models supporting content generation
            if not actions or "generateContent" in actions or "generate_content" in actions:
                discovered.append(name)
                if name.startswith("models/"):
                    discovered.append(name.replace("models/", "", 1))
    except Exception as e:
        print(f"ListModels query returned: {e}")

    all_candidates = discovered + REQUESTED_MODELS

    # Prioritize preferred_model, then 3.6 Flash, 3.5 Flash Lite, 3.1 Pro
    def score(n: str) -> int:
        s = 0
        nl = n.lower()
        if preferred_model and preferred_model.lower() in nl:
            s += 5000
        if "3.6-flash" in nl or "3.6" in nl:
            s += 3000
        elif "3.5-flash-lite" in nl or "flash-lite" in nl:
            s += 2000
        elif "3.5" in nl:
            s += 1500
        elif "3.1-pro" in nl or "3.1" in nl:
            s += 1000
        elif "3." in nl:
            s += 800
        elif "flash" in nl:
            s += 500
        return s

    # Deduplicate preserving sorted priority
    unique_models = list(dict.fromkeys(all_candidates))
    return sorted(unique_models, key=score, reverse=True)


async def validate_gemini_api_key(api_key: str, preferred_model: Optional[str] = None) -> Tuple[bool, Optional[str]]:
    """
    Validates a user-provided Gemini API key.
    1. Authenticates against Google via ModelService.ListModels.
    2. Identifies valid models prioritizing 3.6 Flash, 3.5 Flash Lite, and 3.1 Pro.
    3. Confirms generation and updates active MODEL.
    """
    global MODEL
    cleaned_key = (api_key or "").strip()
    if not cleaned_key:
        return False, "API key cannot be empty."

    try:
        client = genai.Client(api_key=cleaned_key)
    except Exception as e:
        return False, f"Failed to initialize Gemini client: {e}"

    # 1. Query ModelService.ListModels (validates API key authentication)
    try:
        available_models = get_available_gemini_models(client, preferred_model=preferred_model)
    except Exception as auth_err:
        err_str = str(auth_err)
        return False, f"Invalid Gemini API key: {err_str}"

    print(f"Discovered {len(available_models)} candidate models for key (preferred: {preferred_model})")

    # 2. Try ping test on the top candidate models
    last_error = None
    for model_name in available_models:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents="ping"
            )
            if response:
                MODEL = model_name
                print(f"✅ Gemini API key validated and confirmed with model: {model_name}")
                return True, None
        except Exception as e:
            err = str(e)
            last_error = err
            # If invalid key, fail immediately
            if "API_KEY_INVALID" in err or "400" in err or "401" in err or "403" in err:
                return False, f"Invalid Gemini API key: {err}"
            # 404 or NOT_FOUND: try next candidate model
            continue

    # If ListModels authenticated successfully, default to the top discovered model
    if available_models:
        MODEL = available_models[0]
        print(f"✅ Key validated via ListModels. Active model set to: {MODEL}")
        return True, None

    if last_error:
        return False, f"API key validation error: {last_error}"
    return False, "Could not validate key with any available Gemini models."


async def extract_metadata(text: str):
    return {}


async def generate_linkedin_draft(
    topic: str,
    tone: str = "professional",
    prompt_type: str = "humanized",
    metadata: dict = None,
    api_key: Optional[str] = None
):
    global MODEL
    key = (api_key or "").strip() or settings.GOOGLE_API_KEY
    if not key:
        yield "[SERVICE_ERROR] No Gemini API key authorized. Please open AI Generator Settings (⚙️) to connect your key."
        return

    try:
        client = genai.Client(api_key=key)
    except Exception as init_err:
        yield f"[SERVICE_ERROR] Failed to initialize Gemini client: {init_err}. Please check your key in the AI Settings (⚙️) modal."
        return

    context = {"topic": topic, "tone": tone, "resource_persons": "", "coordinators": "", "mentors": ""}
    if metadata:
        context.update({k: v or "" for k, v in metadata.items()})

    template = PROMPTS.get(prompt_type, PROMPTS.get("humanized", ""))

    class SafeDict(dict):
        def __missing__(self, key):
            return ""

    prompt = string.Formatter().vformat(template, (), SafeDict(context))

    models_to_try = [MODEL] + [m for m in get_available_gemini_models(client) if m != MODEL]
    last_err_msg = ""

    for model_attempt in models_to_try:
        try:
            for chunk in client.models.generate_content_stream(
                model=model_attempt,
                contents=prompt,
            ):
                if chunk.text:
                    yield chunk.text
            # Success: retain working model
            MODEL = model_attempt
            return
        except Exception as e:
            err = str(e)
            last_err_msg = err
            err_lower = err.lower()
            if "404" in err or "not_found" in err_lower:
                continue
            print(f"AI ERROR: {err}")
            if "429" in err or "quota" in err_lower or "resource_exhausted" in err_lower:
                yield "[SERVICE_ERROR] Gemini API Quota Exceeded. Please check your quota on Google AI Studio or update your key in the AI Settings (⚙️) modal."
            elif "401" in err or "api_key" in err_lower or "invalid" in err_lower or "400" in err:
                yield "[SERVICE_ERROR] Invalid Gemini API Key. Please open the AI Settings (⚙️) modal to re-verify or update your key."
            else:
                yield f"[SERVICE_ERROR] AI Generation Error: {err}. Please check your key in the AI Settings (⚙️) modal."
            return

    yield f"[SERVICE_ERROR] AI Generation Error: {last_err_msg}. Please check your model settings or key."


async def refine_linkedin_draft(current_content: str, instruction: str, api_key: Optional[str] = None):
    global MODEL
    key = (api_key or "").strip() or settings.GOOGLE_API_KEY
    if not key:
        yield "[SERVICE_ERROR] No Gemini API key authorized. Please open AI Generator Settings (⚙️) to connect your key."
        return

    try:
        client = genai.Client(api_key=key)
    except Exception as init_err:
        yield f"[SERVICE_ERROR] Failed to initialize Gemini client: {init_err}. Please check your key in AI Settings (⚙️)."
        return

    prompt = f"Rewrite this LinkedIn post based on this instruction.\n\nPOST:\n{current_content}\n\nINSTRUCTION: {instruction}\n\nReturn ONLY the rewritten post."

    models_to_try = [MODEL] + [m for m in get_available_gemini_models(client) if m != MODEL]
    last_err_msg = ""

    for model_attempt in models_to_try:
        try:
            for chunk in client.models.generate_content_stream(
                model=model_attempt,
                contents=prompt,
            ):
                if chunk.text:
                    yield chunk.text
            MODEL = model_attempt
            return
        except Exception as e:
            err = str(e)
            last_err_msg = err
            err_lower = err.lower()
            if "404" in err or "not_found" in err_lower:
                continue
            if "429" in err or "quota" in err_lower or "resource_exhausted" in err_lower:
                yield "[SERVICE_ERROR] Gemini Quota Exceeded while refining. Please update your key in the AI Settings (⚙️) modal."
            elif "401" in err or "api_key" in err_lower or "invalid" in err_lower or "400" in err:
                yield "[SERVICE_ERROR] Invalid Gemini API Key. Please open the AI Settings (⚙️) modal to update your key."
            else:
                yield f"[SERVICE_ERROR] Refine Error: {err}. Check your key in the AI Settings (⚙️) modal."
            return

    yield f"[SERVICE_ERROR] Refine Error: {last_err_msg}. Check your key in the AI Settings (⚙️) modal."
