import os
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

# Use the stable v1 API (not v1beta which is deprecated)
client = None
if GOOGLE_API_KEY:
    client = genai.Client(
        api_key=GOOGLE_API_KEY,
        http_options={"api_version": "v1"}
    )

MODEL = "gemini-2.0-flash"

from services.prompts import PROMPTS

async def extract_metadata(text: str):
    return {}

async def generate_linkedin_draft(topic: str, tone: str = "professional", prompt_type: str = "humanized", metadata: dict = None):
    if not client:
        yield "Error: GOOGLE_API_KEY not set in environment."
        return

    context = {"topic": topic, "tone": tone, "resource_persons": "", "coordinators": "", "mentors": ""}
    if metadata:
        context.update({k: v or "" for k, v in metadata.items()})

    template = PROMPTS.get(prompt_type, PROMPTS["humanized"])

    import string
    class SafeDict(dict):
        def __missing__(self, key): return ""
    prompt = string.Formatter().vformat(template, (), SafeDict(context))

    try:
        for chunk in client.models.generate_content_stream(
            model=MODEL,
            contents=prompt,
        ):
            if chunk.text:
                yield chunk.text
    except Exception as e:
        err = str(e)
        print(f"AI ERROR: {err}")
        if "429" in err or "quota" in err.lower():
            yield "[SERVICE_ERROR] Quota Exhausted. Please wait 60 seconds and try again."
        elif "401" in err or "API_KEY" in err:
            yield "[SERVICE_ERROR] Invalid API Key. Check your Render environment variables."
        else:
            yield f"[SERVICE_ERROR] AI Error: {err}"


async def refine_linkedin_draft(current_content: str, instruction: str):
    if not client:
        yield "Error: GOOGLE_API_KEY not set."
        return

    prompt = f"Rewrite this LinkedIn post based on this instruction.\n\nPOST:\n{current_content}\n\nINSTRUCTION: {instruction}\n\nReturn ONLY the rewritten post."
    try:
        for chunk in client.models.generate_content_stream(
            model=MODEL,
            contents=prompt,
        ):
            if chunk.text:
                yield chunk.text
    except Exception as e:
        yield f"[SERVICE_ERROR] Refine Error: {str(e)}"
