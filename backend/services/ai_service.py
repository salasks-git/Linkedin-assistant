import os
from google import genai
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure the Gemini client
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

# Reverting to 2.0-flash because 1.5-flash returned 404 Not Found
MODEL_NAME = os.getenv("MODEL_NAME", "gemini-2.0-flash")

client = None
if GOOGLE_API_KEY:
    client = genai.Client(api_key=GOOGLE_API_KEY)

from services.prompts import PROMPTS

async def extract_metadata(text: str):
    """
    Disabled extraction to save API quota for the main draft.
    """
    return {}

async def refine_linkedin_draft(current_content: str, instruction: str):
    if not client:
        yield "Error: GOOGLE_API_KEY is not set."
        return

    refine_prompt = f"Professional Edit: {current_content}\nInstruction: {instruction}"
    
    try:
        response = client.models.generate_content_stream(
            model=MODEL_NAME,
            contents=refine_prompt
        )
        for chunk in response:
            if chunk.text:
                yield chunk.text
    except Exception as e:
        print(f"DEBUG: Refine Error: {str(e)}") 
        yield f"[SERVICE_ERROR] AI Error: {str(e)}"

async def generate_linkedin_draft(topic: str, tone: str = "professional", prompt_type: str = "humanized", metadata: dict = None):
    if not client:
        yield "Error: GOOGLE_API_KEY is not set."
        return

    # Simplified context to reduce token usage
    context = {"topic": topic, "tone": tone, "resource_persons": "", "coordinators": "", "mentors": ""}
    template = PROMPTS.get(prompt_type, PROMPTS["humanized"])
    
    import string
    class SafeDict(dict):
        def __missing__(self, key): return ""
            
    prompt = string.Formatter().vformat(template, (), SafeDict(context))
    
    try:
        # One single request to Gemini
        response = client.models.generate_content_stream(
            model=MODEL_NAME,
            contents=prompt
        )
        for chunk in response:
            if chunk.text:
                yield chunk.text
            
    except Exception as e:
        err = str(e).lower()
        print(f"DEBUG: Generate Error: {str(e)}") 
        
        if "429" in err or "quota" in err:
            yield "[SERVICE_ERROR] Quota Exhausted: Your free API limit is reached. Please wait 60 seconds."
        elif "401" in err or "api key" in err:
            yield "[SERVICE_ERROR] Invalid API Key: Please check your Render Environment settings."
        else:
            yield f"[SERVICE_ERROR] AI Connection Error: {str(e)}"
