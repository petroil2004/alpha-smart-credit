from __future__ import annotations

import os


class Settings:
    database_url = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg://credit:credit@db:5432/credit_cabinet",
    )
    cookie_name = os.getenv("SESSION_COOKIE_NAME", "credit_cabinet_session")
    cookie_secure = os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true"
    session_ttl_seconds = int(os.getenv("SESSION_TTL_SECONDS", str(60 * 60 * 24 * 7)))


settings = Settings()
