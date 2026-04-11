import os
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if GOOGLE_API_KEY:
    genai.configure(api_key=GOOGLE_API_KEY)

from services.prompts import PROMPTS

async def extract_metadata(text: str):
    return {}

async def generate_linkedin_draft(topic: str, tone: str = "professional", prompt_type: str = "humanized", metadata: dict = None):
    if not GOOGLE_API_KEY:
        yield "Error: GOOGLE_API_KEY not found."
        return

    context = {"topic": topic, "tone": tone}
    template = PROMPTS.get(prompt_type, PROMPTS["humanized"])
    
    import string
    class SafeDict(dict):
        def __missing__(self, key): return ""
    prompt = string.Formatter().vformat(template, (), SafeDict(context))
    
    # Using the most universally supported model name
    model_name = "gemini-1.5-flash"
    
    try:
        model = genai.GenerativeModel(model_name)
        # Use streaming correctly for the standard library
        response = model.generate_content(prompt, stream=True)
        
        for chunk in response:
            if hasattr(chunk, 'text'):
                yield chunk.text
            
    except Exception as e:
        err = str(e).lower()
        if "429" in err or "quota" in err:
            yield "[SERVICE_ERROR] Quota Exhausted: Your current Google account is at its free limit. Please try a new API key."
        elif "404" in err:
            yield f"[SERVICE_ERROR] Model Not Found: Google is rejecting this API key for {model_name}. Please check if the 'Generative Language API' is enabled in your Google Cloud console or use a brand new key."
        else:
            yield f"[SERVICE_ERROR] AI Error: {str(e)}"

async def refine_linkedin_draft(current_content: str, instruction: str):
    if not GOOGLE_API_KEY:
        yield "Error: GOOGLE_API_KEY not found."
        return
    try:
        model = genai.GenerativeModel("gemini-1.5-flash")
        response = model.generate_content(f"Edit this: {current_content}\nInstruction: {instruction}", stream=True)
        for chunk in response:
            if hasattr(chunk, 'text'):
                yield chunk.text
    except Exception as e:
        yield f"Error: {str(e)}"
