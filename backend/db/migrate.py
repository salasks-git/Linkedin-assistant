"""
Database migration CLI script for Supabase / PostgreSQL.
Usage:
    python db/migrate.py
"""
import sys
import os
from pathlib import Path

# Add backend directory to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from core.config import settings
from db.supabase_client import supabase_db

def main():
    print("=" * 60)
    print("Supabase / PostgreSQL Database Migration Runner")
    print("=" * 60)
    schema_path = Path(__file__).parent / "schema.sql"
    print(f"Reading schema: {schema_path}")

    if not schema_path.exists():
        print(f"❌ Error: schema file not found at {schema_path}")
        sys.exit(1)

    result = supabase_db.run_migrations(str(schema_path))
    print(f"Migration result: {result}")
    print("=" * 60)

if __name__ == "__main__":
    main()
