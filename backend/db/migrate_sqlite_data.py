"""Copy local account and session rows into the configured PostgreSQL database.

Run once after setting DATABASE_URL to the production Supabase connection string.
The source SQLite file is read only. Credential ciphertext stays encrypted and
requires the same ENCRYPTION_KEY in production as the source environment.
"""
import os
from pathlib import Path
import psycopg2

from sqlalchemy import create_engine
from sqlalchemy.orm import Session as ORMSession

from core.config import settings
from models import Base, Session as AppSession, User


BACKEND_DIR = Path(__file__).resolve().parents[1]
SOURCE_DATABASE_URL = f"sqlite:///{BACKEND_DIR / 'posts.db'}"


def main() -> None:
    target_url = os.getenv("DATABASE_URL", settings.DATABASE_URL or "")
    if not target_url.startswith(("postgresql://", "postgres://")):
        raise SystemExit("Set DATABASE_URL to the Supabase PostgreSQL connection string first")

    source_engine = create_engine(SOURCE_DATABASE_URL, connect_args={"check_same_thread": False})
    target_url = target_url.replace("postgres://", "postgresql://", 1)
    target_engine = create_engine(target_url)
    Base.metadata.create_all(bind=target_engine)

    schema_path = BACKEND_DIR / "db" / "schema.sql"
    with psycopg2.connect(target_url) as connection:
        connection.autocommit = True
        with connection.cursor() as cursor:
            cursor.execute(schema_path.read_text())

    copied_users = copied_sessions = 0
    with ORMSession(source_engine) as source, ORMSession(target_engine) as target:
        for user in source.query(User).all():
            target.merge(user)
            copied_users += 1
        for app_session in source.query(AppSession).all():
            target.merge(app_session)
            copied_sessions += 1
        target.commit()

    source_engine.dispose()
    target_engine.dispose()
    print(f"Copied {copied_users} user records and {copied_sessions} session records.")


if __name__ == "__main__":
    main()
