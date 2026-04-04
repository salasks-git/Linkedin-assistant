import os
import base64
import hashlib
from cryptography.fernet import Fernet

def get_cipher():
    """Returns a Fernet cipher instance based on ENCRYPTION_KEY in .env"""
    key = os.getenv("ENCRYPTION_KEY")
    if not key:
        # For development only! In production, this should raise an error.
        print("WARNING: ENCRYPTION_KEY is not set. Using a fallback temporary key. Tokens will be lost on restart.")
        key = "default_fallback_key_please_change"
    
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
    """Encrypt a string token to a safe string for DB storage"""
    if not token:
        return ""
    cipher = get_cipher()
    return cipher.encrypt(token.encode('utf-8')).decode('utf-8')

def decrypt_token(encrypted_token: str) -> str:
    """Decrypt the token from the DB back to plain text"""
    if not encrypted_token:
        return ""
    cipher = get_cipher()
    return cipher.decrypt(encrypted_token.encode('utf-8')).decode('utf-8')
