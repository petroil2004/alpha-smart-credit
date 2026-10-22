"""Shared fixtures. Destructive cleanup is restricted to the test database."""
import os

import pytest
from fastapi.testclient import TestClient

from app.db import Base, engine
from app.main import app


@pytest.fixture
def clean_database():
    database = engine.url.database or ""
    assert os.environ["DATABASE_URL"].startswith("postgresql+psycopg://")
    assert database.endswith("_tests"), "Use a dedicated database ending in _tests"
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture
def client(clean_database):
    with TestClient(app) as test_client:
        yield test_client
