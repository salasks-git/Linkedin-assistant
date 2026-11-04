import base64
import hashlib
from cryptography.fernet import Fernet
from core.config import settings

def get_cipher():
    """Returns a Fernet cipher instance based on ENCRYPTION_KEY in system settings"""
    key = settings.ENCRYPTION_KEY.strip()
    if not key:
        raise RuntimeError("ENCRYPTION_KEY must be configured before storing or reading credentials")
    
    try:
        # Check if it's already a valid Fernet key
        return Fernet(key.encode('utf-8'))
    except ValueError:
        # If it's just a regular string password, hash it to 32 bytes and base64 encode for Fernet
        m = hashlib.sha256()
        m.update(key.encode('utf-8'))
        fernet_key = base64.urlsafe_b64encode(m.digest())
        return Fernet(fernet_key)

def encrypt_token(token: str) -> str:
    """Encrypt a string token or API key to a safe string for DB storage"""
    if not token:
        return ""
    cipher = get_cipher()
    return cipher.encrypt(token.encode('utf-8')).decode('utf-8')

def decrypt_token(encrypted_token: str) -> str:
    """Decrypt the token or API key from the DB back to plain text"""
    if not encrypted_token:
        return ""
    cipher = get_cipher()
    return cipher.decrypt(encrypted_token.encode('utf-8')).decode('utf-8')

def mask_api_key(key: str) -> str:
    """Masks an API key for safe display, revealing only prefix and suffix."""
    if not key:
        return ""
    cleaned = key.strip()
    if len(cleaned) <= 8:
        return "••••••••"
    return f"{cleaned[:4]}...{cleaned[-4:]}"
