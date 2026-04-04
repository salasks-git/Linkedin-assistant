import unicodedata
import re

def sanitize_for_linkedin(text: str) -> str:
    # Remove invisible Unicode control characters (Cf/Cc) but keep newlines/tabs
    text = ''.join(
        c for c in text
        if unicodedata.category(c) not in ('Cf', 'Cc') or c in ('\n', '\t')
    )
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    text = re.sub(r'[\u200b\u200c\u200d\ufeff\u00ad\u2028\u2029]', '', text)
    # The fix: Escape special characters
    text = re.sub(r'([()\[\]*@<>\\~_])', r'\\\1', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text[:3000].strip()

# Test cases
test_cases = [
    "Hello (World)",
    "Check [this] out",
    "Email: user@example.com",
    "Bold *text*",
    "Formatting _italics_",
    "Symbols < > \\ ~ |"
]

for t in test_cases:
    sanitized = sanitize_for_linkedin(t)
    print(f"Original: {t}")
    print(f"Sanitized: {sanitized}")
    print("-" * 20)
