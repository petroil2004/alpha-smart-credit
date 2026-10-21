"""Контрактные проверки черновиков против настоящей PostgreSQL.

Запускаются только с DATABASE_URL вида postgresql+psycopg://..., а не с SQLite.
"""

from __future__ import annotations

import os
import uuid

import pytest
from fastapi.testclient import TestClient

from app.db import Base, engine
from app.main import app


@pytest.fixture(autouse=True)
def clean_database():
    """Каждый пример начинает с пустой схемы, но использует PostgreSQL."""
    assert os.environ["DATABASE_URL"].startswith("postgresql+psycopg://")
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def login(client: TestClient, account_id: str):
    response = client.post("/api/v1/auth/demo-login", json={"account_id": account_id})
    assert response.status_code == 200
    return response


def create(client: TestClient, key: str | None = None) -> dict:
    response = client.post(
        "/api/v1/applications",
        json={},
        headers={"Idempotency-Key": key or str(uuid.uuid4())},
    )
    assert response.status_code == 201
    return response.json()


def test_login_creates_persistent_server_session(client: TestClient):
    assert client.get("/api/v1/me").status_code == 401
    login_response = login(client, "demo-client-1")

    response = client.get("/api/v1/me")
    assert response.status_code == 200
    assert response.json()["company"]["id"] == "demo-company-1"
    assert "credit_cabinet_session" in login_response.headers["set-cookie"]


def test_database_data_and_cookie_session_survive_new_app_client():
    with TestClient(app) as first:
        login(first, "demo-client-1")
        application = create(first)
        session_cookie = first.cookies.get("credit_cabinet_session")

    with TestClient(app) as restarted:
        restarted.cookies.set("credit_cabinet_session", session_cookie)
        assert restarted.get("/api/v1/me").status_code == 200
        assert restarted.get("/api/v1/applications").json()["items"][0]["id"] == application["id"]


def test_create_edit_and_list_a_draft(client: TestClient):
    login(client, "demo-client-1")
    application = create(client)

    response = client.patch(
        f"/api/v1/applications/{application['id']}",
        json={
            "version": application["version"],
            "purpose": "  Пополнение оборотных средств  ",
            "product_code": "working_capital",
            "amount_rub": "1234.5",
            "term_months": 12,
        },
    )

    assert response.status_code == 200
    saved = response.json()
    assert saved["purpose"] == "Пополнение оборотных средств"
    assert saved["amount_rub"] == "1234.50"
    assert saved["version"] == 2
    assert client.get("/api/v1/applications").json()["items"] == [saved]


def test_companies_are_isolated_and_foreign_draft_returns_404():
    with TestClient(app) as first, TestClient(app) as second:
        login(first, "demo-client-1")
        application = create(first)
        login(second, "demo-client-2")

        assert second.get("/api/v1/applications").json() == {"items": []}
        assert second.get(f"/api/v1/applications/{application['id']}").status_code == 404
        assert (
            second.patch(
                f"/api/v1/applications/{application['id']}",
                json={"version": application["version"], "purpose": "чужая заявка"},
            ).status_code
            == 404
        )


def test_same_idempotency_key_creates_one_draft(client: TestClient):
    login(client, "demo-client-1")
    key = str(uuid.uuid4())

    first = client.post("/api/v1/applications", json={}, headers={"Idempotency-Key": key})
    repeated = client.post("/api/v1/applications", json={}, headers={"Idempotency-Key": key})

    assert first.status_code == 201
    assert repeated.status_code == 200
    assert repeated.json()["id"] == first.json()["id"]
    assert len(client.get("/api/v1/applications").json()["items"]) == 1


def test_stale_version_does_not_overwrite_saved_data(client: TestClient):
    login(client, "demo-client-1")
    application = create(client)
    current = client.patch(
        f"/api/v1/applications/{application['id']}",
        json={"version": 1, "purpose": "сохранённый текст"},
    )
    assert current.status_code == 200

    stale = client.patch(
        f"/api/v1/applications/{application['id']}",
        json={"version": 1, "purpose": "устаревший текст"},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "VERSION_CONFLICT"
    assert client.get(f"/api/v1/applications/{application['id']}").json()["purpose"] == "сохранённый текст"


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"version": 1, "product_code": "working_capital", "usage_days": 10}, "usage_days"),
        ({"version": 1, "product_code": "overdraft", "term_months": 12}, "term_months"),
        ({"version": 1, "amount_rub": "10.123"}, "amount_rub"),
        ({"version": 1, "status": "SUBMITTED"}, "status"),
    ],
)
def test_rejects_invalid_or_incompatible_draft_fields(client: TestClient, payload: dict, field: str):
    login(client, "demo-client-1")
    application = create(client)

    response = client.patch(f"/api/v1/applications/{application['id']}", json=payload)

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert field in body["error"].get("fields", {})
