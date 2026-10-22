from __future__ import annotations

from .db import SessionLocal
from .models import Account

DEMO_ACCOUNTS = (
    {
        "id": "demo-client-1",
        "name": "Демо-клиент 1",
        "role": "CLIENT",
        "company_id": "demo-company-1",
        "company_name": "ООО «Демо Торг»",
    },
    {
        "id": "demo-client-2",
        "name": "Демо-клиент 2",
        "role": "CLIENT",
        "company_id": "demo-company-2",
        "company_name": "ООО «Демо Мастерская»",
    },
)


def ensure_demo_accounts() -> None:
    database = SessionLocal()
    try:
        for account in DEMO_ACCOUNTS:
            if database.get(Account, account["id"]) is None:
                database.add(Account(**account))
        database.commit()
    finally:
        database.close()
