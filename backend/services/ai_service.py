import os
from google import genai
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure the Gemini client (uses REST, not gRPC)
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
MODEL_NAME = os.getenv("MODEL_NAME", "gemini-2.0-flash")

client = None
if GOOGLE_API_KEY:
    client = genai.Client(api_key=GOOGLE_API_KEY)

from services.prompts import PROMPTS

async def extract_metadata(text: str):
    """
    Uses Gemini to extract resource_persons, mentors, and coordinators from a topic description.
    Returns a dictionary of extracted entities.
    """
    if not client:
        return {}

    extraction_prompt = f"""
    TASK: Extract names of specific roles from the following text and return them as a JSON object.
    TEXT: "{text}"
    
    ROLES TO EXTRACT:
    - resource_persons (Guest speakers, industry experts, main presenters)
    - mentors (Professors, guides, teachers)
    - coordinators (Organizers, department heads, student leads)
    
    RULES:
    1. Return ONLY a valid JSON object.
    2. Format: {{ "resource_persons": "name1, name2", "mentors": "name1", "coordinators": "name1" }}
    3. If a role is not mentioned, use an empty string.
    4. If no names are found, return all empty strings.
    """
    
    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=extraction_prompt,
            config={"temperature": 0.1}
        )
        
        import json
        import re
        
        # Extract JSON from the response text (it might be wrapped in markdown blocks)
        json_match = re.search(r'\{.*\}', response.text, re.DOTALL)
        if json_match:
            return json.loads(json_match.group())
        return {}
    except Exception as e:
        print(f"Extraction Error: {e}")
        return {}

async def refine_linkedin_draft(current_content: str, instruction: str):
    """
    Refines an existing draft based on user instructions while maintaining LinkedIn best practices.
    """
    if not client:
        yield "Error: GOOGLE_API_KEY is not set."
        return

    refine_prompt = f"""
    You are a professional LinkedIn Editor.
    
    CURRENT DRAFT:
    ---
    {current_content}
    ---
    
    USER INSTRUCTION: "{instruction}"
    
    TASK: Rewrite the draft by strictly following the user instruction.
    Maintain the "Humanized" writing style (no AI jargon, varying rhythm, soul).
    Keep character counts professional (under 3000).
    Return ONLY the new draft text.
    """
    
    try:
        response = client.models.generate_content_stream(
            model=MODEL_NAME,
            contents=refine_prompt
        )
        
        for chunk in response:
            try:
                if chunk.text:
                    yield chunk.text
            except (ValueError, AttributeError):
                yield "[SERVICE_ERROR] Safety Block: The AI refused this refinement."
                
    except Exception as e:
        yield f"[SERVICE_ERROR] Refinement Error: {str(e)}"

async def generate_linkedin_draft(
    topic: str, 
    tone: str = "professional", 
    prompt_type: str = "humanized",
    metadata: dict = None
):
    """
    Generates a LinkedIn post draft using Google's Gemini API with streaming.
    """
    if not client:
        yield "Error: GOOGLE_API_KEY is not set. Please add it to your environment."
        return

    # Prepare formatting context with defaults
    context = {
        "topic": topic,
        "tone": tone,
        "resource_persons": "",
        "coordinators": "",
        "mentors": ""
    }
    
    # Merge metadata if provided
    if metadata:
        context.update(metadata)

    # Select the prompt style (default to humanized if type is unknown)
    template = PROMPTS.get(prompt_type, PROMPTS["humanized"])
    
    # Safe formatting: ignore missing keys in the template
    import string
    class SafeDict(dict):
        def __missing__(self, key):
            return ""
            
    prompt = string.Formatter().vformat(template, (), SafeDict(context))
    
    try:
        response = client.models.generate_content_stream(
            model=MODEL_NAME,
            contents=prompt
        )
        
        for chunk in response:
            try:
                if chunk.text:
                    yield chunk.text
            except (ValueError, AttributeError):
                yield "[SERVICE_ERROR] Safety Block: The AI refused this content due to safety filters."
            
    except Exception as e:
        error_msg = str(e).lower()
        if "429" in error_msg or "quota" in error_msg:
            yield "[SERVICE_ERROR] Quota Exhausted: Please wait a minute before retrying."
        elif "401" in error_msg or "api key" in error_msg:
            yield "[SERVICE_ERROR] Invalid API Key: Check your .env file."
        else:
            yield f"[SERVICE_ERROR] Google API Error: {str(e)}"
