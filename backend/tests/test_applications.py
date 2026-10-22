"""Контрактные проверки черновиков против настоящей PostgreSQL.

Запускаются только с DATABASE_URL вида postgresql+psycopg://..., а не с SQLite.
"""

from __future__ import annotations

import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

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


def test_concurrent_saves_preserve_the_winner_and_reject_the_stale_version(client: TestClient):
    login(client, "demo-client-1")
    application = create(client)
    path = f"/api/v1/applications/{application['id']}"

    with TestClient(app) as second:
        login(second, "demo-client-1")
        with engine.connect() as gate, engine.connect().execution_options(
            isolation_level="AUTOCOMMIT"
        ) as observer, ThreadPoolExecutor(max_workers=2) as workers:
            # Real PostgreSQL gate: both requests must reach the same locked row
            # before either may commit. This makes the original lost update deterministic.
            gate.execute(
                text("SELECT id FROM applications WHERE id = :id FOR UPDATE"),
                {"id": application["id"]},
            )
            futures = [
                workers.submit(http.patch, path, json={"version": 1, "purpose": purpose})
                for http, purpose in [(client, "Первое окно"), (second, "Второе окно")]
            ]
            try:
                deadline = time.monotonic() + 10
                while True:
                    waiting = observer.scalar(text(
                        "SELECT count(*) FROM pg_stat_activity "
                        "WHERE datname = current_database() AND wait_event_type = 'Lock' "
                        "AND query LIKE '%applications%' AND pid <> pg_backend_pid()"
                    ))
                    if waiting >= 2:
                        break
                    assert time.monotonic() < deadline, "Both PATCH requests must reach the row lock"
                    time.sleep(0.01)
            finally:
                gate.rollback()
            responses = [future.result(timeout=10) for future in futures]

    assert sorted(response.status_code for response in responses) == [200, 409]
    winner = next(response.json() for response in responses if response.status_code == 200)
    rejected = next(response.json() for response in responses if response.status_code == 409)
    assert rejected["error"]["code"] == "VERSION_CONFLICT"
    stored = client.get(path).json()
    assert stored["purpose"] == winner["purpose"]
    assert stored["version"] == winner["version"] == 2


@pytest.mark.parametrize(
    ("field", "product", "invalid", "valid"),
    [
        ("amount_rub", "working_capital", "10000000000000000.00", "1.00"),
        ("expected_inflow_amount_rub", "overdraft", "10000000000000000.00", "1.00"),
        ("amount_rub", "working_capital", "9" * 100, "1.00"),
        ("expected_inflow_amount_rub", "overdraft", "9" * 100, "1.00"),
        ("term_months", "equipment", 2147483648, 1),
        ("usage_days", "overdraft", 2147483648, 1),
        ("term_months", "equipment", 10**40, 1),
        ("usage_days", "overdraft", 10**40, 1),
    ],
)
def test_storage_overflow_is_a_field_error_without_changing_the_draft(field, product, invalid, valid):
    with TestClient(app, raise_server_exceptions=False) as http:
        login(http, "demo-client-1")
        application = create(http)
        path = f"/api/v1/applications/{application['id']}"
        response = http.patch(path, json={"version": 1, "product_code": product, field: invalid})

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"
        assert field in response.json()["error"]["fields"]
        assert http.get(path).json() == application
        # A rejected request must also release its transaction/row lock.
        corrected = http.patch(path, json={"version": 1, "product_code": product, field: valid})
        assert corrected.status_code == 200
        assert corrected.json()[field] == valid
        assert corrected.json()["version"] == 2


@pytest.mark.parametrize(
    ("field", "product", "value", "expected"),
    [
        ("amount_rub", "working_capital", "9999999999999999.99", "9999999999999999.99"),
        ("expected_inflow_amount_rub", "overdraft", "9999999999999999.99", "9999999999999999.99"),
        ("amount_rub", "working_capital", "0.01", "0.01"),
        ("expected_inflow_amount_rub", "overdraft", "0.01", "0.01"),
        ("amount_rub", "equipment", "000000000000000001.00", "1.00"),
        ("expected_inflow_amount_rub", "overdraft", "000000000000000001.00", "1.00"),
        ("term_months", "equipment", 2147483647, 2147483647),
        ("usage_days", "overdraft", 2147483647, 2147483647),
    ],
)
def test_storage_boundary_values_are_saved_exactly(client, field, product, value, expected):
    login(client, "demo-client-1")
    application = create(client)
    path = f"/api/v1/applications/{application['id']}"
    response = client.patch(path, json={"version": 1, "product_code": product, field: value})

    assert response.status_code == 200
    assert response.json()[field] == expected
    assert client.get(path).json()[field] == expected


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
