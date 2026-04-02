import os
import google.generativeai as genai
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure the Gemini API
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
MODEL_NAME = os.getenv("MODEL_NAME", "gemini-1.5-flash")

if GOOGLE_API_KEY:
    genai.configure(api_key=GOOGLE_API_KEY)

PROMPTS = {
    "humanized": """
    You are a professional LinkedIn Ghostwriter & humanised writing expert.
    TASK: Write a short, humanized LinkedIn post about '{topic}' with a '{tone}' tone.

    # 🧬 HUMANIZER MANDATE (LITE)
    Avoid AI-isms to make writing sound natural, authentic, and "human."

    ## 1. SOUL & PERSONALITY
    - Have opinions. React to facts, don't just report them.
    - Vary rhythm: Mix short punchy sentences with longer ones.
    - Use "I" naturally ("I keep coming back to...", "Here's what gets me...").
    - Acknowledge uncertainty or mixed feelings; let some "mess" in.
    - Be specific about feelings (e.g., "unsettling," "inspiring," "genuinely don't know").

    ## 2. PATTERNS TO ELIMINATE (STATISTICAL AI SLOP)
    - NO Puffed Significance: Avoid "stands as a testament," "pivotal moment," "evolving landscape."
    - NO -ing endings: Avoid tacking on "highlighting...," "ensuring...," "reflecting..."
    - NO AI Vocab: Avoid "Additionally," "crucial," "delve," "fostering," "interplay," "tapestry," "underscore."
    - NO Promo Fluff: Avoid "nestled in the heart of," "boasts a," "vibrant/rich."
    - NO Multiples: Avoid "Rule of Three" and negative parallelisms ("Not only... but...").
    - NO Formatting Slop: No em-dash overuse, no bold headings within sentences, no emojis in headers.

    ## 3. CONSTRAINTS
    - PRIVATE: Never include mobile numbers, registration links, or personal contact info.
    - BRIEF: Under 800 characters. 
    - HOOK: Start with a story, bold claim, or a reaction.
    - CTA: End with a natural engagement question.
    - HASHTAGS: 2-3 niche tags at the very end.

    Human Style Ref: "I genuinely don't know how to feel about this one... the truth is probably somewhere boring in the middle - but I keep thinking about those agents."
    """,
    "simple": """
    You are a professional LinkedIn Assistant.
    TASK: Write a very simple, direct, and concise LinkedIn post about '{topic}' with a '{tone}' tone.
    
    RULES:
    1. Stay under 500 characters.
    2. Use simple, everyday language. No corporate jargon.
    3. No complex formatting or puffed-up significance.
    4. Start with a clear hook and end with a question.
    5. Include 2 relevant hashtags.
    6. NO SENSITIVE DATA: Zero phone numbers or links.
    """
}

async def generate_linkedin_draft(topic: str, tone: str = "professional", prompt_type: str = "humanized"):
    """
    Generates a LinkedIn post draft using Google's Gemini API with streaming.
    """
    if not GOOGLE_API_KEY:
        yield "Error: GOOGLE_API_KEY is not set. Please add it to your environment."
        return

    # Select the prompt style (default to humanized if type is unknown)
    template = PROMPTS.get(prompt_type, PROMPTS["humanized"])
    prompt = template.format(topic=topic, tone=tone)
    
    try:
        model = genai.GenerativeModel(MODEL_NAME)
        # Using stream=True for real-time word-by-word population
        response = await model.generate_content_async(prompt, stream=True)
        
        async for chunk in response:
            try:
                if chunk.text:
                    yield chunk.text
                elif hasattr(chunk, 'candidates') and chunk.candidates:
                    # If text is empty, it might be a block or empty response
                    reason = chunk.candidates[0].finish_reason
                    if reason != 1: # 1 means STOP (normal)
                        yield f"[SERVICE_ERROR] AI Generation Blocked: {reason.name}. Please refine your prompt."
            except ValueError:
                # This often happens if the safety filter blocks the chunk mid-stream
                yield "[SERVICE_ERROR] Safety Block: The AI refused this content due to safety filters."
            
    except Exception as e:
        error_msg = str(e).lower()
        if "429" in error_msg or "quota" in error_msg:
            yield "[SERVICE_ERROR] Quota Exhausted: Please wait a minute before retrying."
        elif "401" in error_msg or "api key" in error_msg:
            yield "[SERVICE_ERROR] Invalid API Key: Check your .env file."
        else:
            yield f"[SERVICE_ERROR] Google API Error: {str(e)}"
