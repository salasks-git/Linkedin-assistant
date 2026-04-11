import os
import time
import google.generativeai as genai
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure the Gemini client
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if GOOGLE_API_KEY:
    genai.configure(api_key=GOOGLE_API_KEY)

from services.prompts import PROMPTS

async def extract_metadata(text: str):
    """
    Disabled for now to maximize quota for post generation.
    """
    return {}

async def generate_linkedin_draft(topic: str, tone: str = "professional", prompt_type: str = "humanized", metadata: dict = None):
    if not GOOGLE_API_KEY:
        yield "Error: GOOGLE_API_KEY is not set globally."
        return

    context = {"topic": topic, "tone": tone}
    template = PROMPTS.get(prompt_type, PROMPTS["humanized"])
    
    import string
    class SafeDict(dict):
        def __missing__(self, key): return ""
    prompt = string.Formatter().vformat(template, (), SafeDict(context))
    
    # Try models in order of stability
    # Some accounts have 1.5, some have 2.0. We try both.
    models_to_try = ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-1.5-pro"]
    
    success = False
    last_error = ""

    for model_name in models_to_try:
        if success: break
        
        # Exponential backoff retry (Wait if blocked)
        for attempt in range(2): 
            try:
                model = genai.GenerativeModel(model_name)
                response = model.generate_content(prompt, stream=True)
                
                for chunk in response:
                    if chunk.text:
                        yield chunk.text
                
                success = True
                break # Exit attempt loop
            except Exception as e:
                last_error = str(e)
                print(f"DEBUG: Attempt {attempt} failed for {model_name}: {last_error}")
                
                if "429" in last_error or "quota" in last_error:
                    time.sleep(2) # Brief wait before next attempt or model
                elif "404" in last_error:
                    break # Model doesn't exist for this key, try next model
                else:
                    break # Other error, try next model
                    
    if not success:
        if "429" in last_error.lower() or "quota" in last_error.lower():
            yield f"[SERVICE_ERROR] Quota Exhausted on all models. Google is temporarily limiting your account. Please wait 5 minutes and try a different topic."
        else:
            yield f"[SERVICE_ERROR] AI Connection Failed: {last_error}"

async def refine_linkedin_draft(current_content: str, instruction: str):
    if not GOOGLE_API_KEY:
        yield "Error: GOOGLE_API_KEY is not set."
        return

    refine_prompt = f"Professional Edit: {current_content}\nInstruction: {instruction}"
    
    try:
        model = genai.GenerativeModel("gemini-1.5-flash")
        response = model.generate_content(refine_prompt, stream=True)
        for chunk in response:
            if chunk.text:
                yield chunk.text
    except Exception as e:
        yield f"[SERVICE_ERROR] AI Error: {str(e)}"
