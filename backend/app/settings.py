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
    assistant_enabled = os.getenv("ASSISTANT_ENABLED", "false").lower() == "true"
    llm_base_url = os.getenv("LLM_BASE_URL", "http://ollama:11434/v1").rstrip("/")
    llm_api_key = os.getenv("LLM_API_KEY", "")
    llm_model = os.getenv("LLM_MODEL", "qwen3:4b-instruct-2507-q4_K_M")
    llm_timeout_seconds = float(os.getenv("LLM_TIMEOUT_SECONDS", "90"))
    llm_response_format = os.getenv("LLM_RESPONSE_FORMAT", "json_schema")



settings = Settings()
