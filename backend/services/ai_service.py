import os
from google import genai
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure the Gemini client
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

# 1.5-flash is MUCH more reliable for Free Tiers than 2.0-flash
MODEL_NAME = os.getenv("MODEL_NAME", "gemini-1.5-flash")

client = None
if GOOGLE_API_KEY:
    client = genai.Client(api_key=GOOGLE_API_KEY)

from services.prompts import PROMPTS

async def extract_metadata(text: str):
    """
    Uses Gemini to extract roles.
    """
    if not client:
        return {}

    extraction_prompt = f"""
    TASK: Extract names of specific roles from the following text and return them as a JSON object.
    TEXT: "{text}"
    
    ROLES: {{ "resource_persons": "", "mentors": "", "coordinators": "" }}
    Return ONLY JSON.
    """
    
    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=extraction_prompt,
            config={"temperature": 0.1}
        )
        import json
        import re
        json_match = re.search(r'\{.*\}', response.text, re.DOTALL)
        if json_match:
            return json.loads(json_match.group())
        return {}
    except Exception as e:
        print(f"DEBUG: Extraction Error: {str(e)}") # Log to Render Console
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
        print(f"DEBUG: Refine Error: {str(e)}") # Log to Render Console
        yield f"[SERVICE_ERROR] AI Error: {str(e)}"

async def generate_linkedin_draft(topic: str, tone: str = "professional", prompt_type: str = "humanized", metadata: dict = None):
    if not client:
        yield "Error: GOOGLE_API_KEY is not set."
        return

    context = {"topic": topic, "tone": tone, "resource_persons": "", "coordinators": "", "mentors": ""}
    if metadata:
        context.update(metadata)

    template = PROMPTS.get(prompt_type, PROMPTS["humanized"])
    
    import string
    class SafeDict(dict):
        def __missing__(self, key): return ""
            
    prompt = string.Formatter().vformat(template, (), SafeDict(context))
    
    try:
        response = client.models.generate_content_stream(
            model=MODEL_NAME,
            contents=prompt
        )
        for chunk in response:
            if chunk.text:
                yield chunk.text
            
    except Exception as e:
        err = str(e).lower()
        print(f"DEBUG: Generate Error: {str(e)}") # Log to Render Console
        
        if "429" in err or "quota" in err:
            yield "[SERVICE_ERROR] Quota Exhausted: Your free API limit is reached. Wait 60s."
        elif "401" in err or "api key" in err:
            yield "[SERVICE_ERROR] Invalid API Key: Please check your Render Environment settings."
        else:
            yield f"[SERVICE_ERROR] AI Connection Error: {str(e)}"
