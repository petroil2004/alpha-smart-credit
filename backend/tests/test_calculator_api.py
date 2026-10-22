import uuid

import pytest


VALID = {"product_code": "working_capital", "amount_rub": "3000000.00", "term_months": 36}


def login(client):
    assert client.post("/api/v1/auth/demo-login", json={"account_id": "demo-client-1"}).status_code == 200


def test_catalog_requires_login(client):
    assert client.get("/api/v1/products").status_code == 401


def test_calculation_requires_login(client):
    assert client.post("/api/v1/calculations/annuity", json=VALID).status_code == 401


def test_catalog_contract(client):
    login(client)
    response = client.get("/api/v1/products")
    assert response.status_code == 200
    catalog = response.json()
    assert catalog["catalog_version"] == "2026-10-23.1"
    assert [p["code"] for p in catalog["items"]] == ["working_capital", "equipment", "overdraft"]
    assert [(p["amount_min_rub"], p["amount_max_rub"], p["annual_rate_percent"]) for p in catalog["items"]] == [
        ("300000.00", "6000000.00", "25.00"),
        ("500000.00", "10000000.00", "25.00"),
        ("50000.00", "2000000.00", "26.00"),
    ]
    assert [(p["term_min_months"], p["term_max_months"]) for p in catalog["items"]] == [(12, 36), (12, 60), (None, None)]
    assert [p["calculation_available"] for p in catalog["items"]] == [True, True, False]
    overdraft = catalog["items"][2]
    assert (overdraft["limit_term_months"], overdraft["usage_min_days"], overdraft["usage_max_days"]) == (12, 1, 60)


@pytest.mark.parametrize("change,field", [
    ({"amount_rub": 3000000}, "amount_rub"), ({"amount_rub": "0"}, "amount_rub"),
    ({"amount_rub": "-1"}, "amount_rub"), ({"amount_rub": "1e6"}, "amount_rub"),
    ({"amount_rub": "3 000 000"}, "amount_rub"), ({"amount_rub": "3000000,00"}, "amount_rub"),
    ({"amount_rub": "3000000.001"}, "amount_rub"), ({"amount_rub": "NaN"}, "amount_rub"),
    ({"term_months": True}, "term_months"), ({"term_months": "36"}, "term_months"),
    ({"term_months": 36.0}, "term_months"), ({"term_months": 37}, "term_months"),
    ({"product_code": "unknown"}, "product_code"), ({"product_code": "overdraft"}, "product_code"),
    ({"annual_rate_percent": "1.00"}, "annual_rate_percent"),
    ({"application_id": str(uuid.uuid4())}, "application_id"),
])
def test_strict_calculation_input(client, change, field):
    login(client)
    response = client.post("/api/v1/calculations/annuity", json=VALID | change)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert field in response.json()["error"]["fields"]


@pytest.mark.parametrize("amount", ["3000000", "3000000.0", "3000000.00"])
def test_request_normalization(client, amount):
    login(client)
    response = client.post("/api/v1/calculations/annuity", json=VALID | {"amount_rub": amount})
    assert response.status_code == 200
    assert response.json()["amount_rub"] == "3000000.00"
    assert response.json()["monthly_payment_rub"] == "119279.48"


def test_calculation_is_read_only(client):
    login(client)
    created = client.post("/api/v1/applications", json={}, headers={"Idempotency-Key": str(uuid.uuid4())}).json()
    before = client.get("/api/v1/applications").json()
    result = client.post("/api/v1/calculations/annuity", json=VALID)
    assert result.status_code == 200
    assert client.get(f"/api/v1/applications/{created['id']}").json() == created
    assert client.get("/api/v1/applications").json() == before
    # Product limits belong to calculation, not to draft persistence.
    saved = client.patch(f"/api/v1/applications/{created['id']}", json={"version": created["version"], "product_code": "working_capital", "amount_rub": "1234.50", "term_months": 1})
    assert saved.status_code == 200
