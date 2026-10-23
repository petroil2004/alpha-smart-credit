"""Deletion contract against a dedicated PostgreSQL database."""
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db import engine
from app.main import app


def make_draft(client, key=None):
    client.post('/api/v1/auth/demo-login', json={'account_id': 'demo-client-1'})
    key = key or str(uuid.uuid4())
    response = client.post('/api/v1/applications', json={}, headers={'Idempotency-Key': key})
    assert response.status_code == 201
    return response.json(), key


def test_delete_removes_draft_but_old_creation_key_cannot_resurrect_it(client):
    item, key = make_draft(client)
    path = f"/api/v1/applications/{item['id']}"
    assert client.delete(path, params={'version': 1}).status_code == 204
    assert client.get('/api/v1/applications').json() == {'items': []}
    assert client.get(path).status_code == 404
    assert client.patch(path, json={'version': 1, 'purpose': 'Late save'}).status_code == 404
    assert client.delete(path, params={'version': 1}).status_code == 404
    replay = client.post('/api/v1/applications', json={}, headers={'Idempotency-Key': key})
    assert replay.status_code == 410
    assert replay.json()['error']['code'] == 'APPLICATION_DELETED'
    with engine.connect() as db:
        assert db.scalar(text('SELECT count(*) FROM applications')) == 0
        assert db.scalar(text('SELECT count(*) FROM application_creations WHERE application_id IS NULL')) == 1
    # Another user can independently use the same creation key.
    client.post('/api/v1/auth/demo-login', json={'account_id': 'demo-client-2'})
    assert client.post('/api/v1/applications', json={}, headers={'Idempotency-Key': key}).status_code == 201


def test_delete_checks_login_and_company(client):
    item, _ = make_draft(client)
    path = f"/api/v1/applications/{item['id']}"
    client.post('/api/v1/auth/logout')
    assert client.delete(path, params={'version': 1}).status_code == 401
    client.post('/api/v1/auth/demo-login', json={'account_id': 'demo-client-2'})
    assert client.delete(path, params={'version': 1}).status_code == 404
    client.post('/api/v1/auth/demo-login', json={'account_id': 'demo-client-1'})
    assert client.get(path).status_code == 200


def test_delete_rejects_updated_version(client):
    item, _ = make_draft(client)
    path = f"/api/v1/applications/{item['id']}"
    assert client.patch(path, json={'version': 1, 'purpose': 'New edit'}).status_code == 200
    response = client.delete(path, params={'version': 1})
    assert response.status_code == 409
    assert response.json()['error']['code'] == 'VERSION_CONFLICT'
    assert client.get(path).json()['purpose'] == 'New edit'


@pytest.mark.parametrize('status', ['SUBMITTED', 'NEEDS_INFO', 'FUNDED'])
def test_delete_rejects_non_draft_even_via_direct_request(client, status):
    item, _ = make_draft(client)
    with engine.begin() as db:
        db.execute(text('UPDATE applications SET status=:status WHERE id=:id'), {'status': status, 'id': item['id']})
    response = client.delete(f"/api/v1/applications/{item['id']}", params={'version': 1})
    assert response.status_code == 409
    assert response.json()['error']['code'] == 'APPLICATION_NOT_DRAFT'
    assert client.get(f"/api/v1/applications/{item['id']}").json()['status'] == status


@pytest.mark.parametrize('version', [None, 'bad', '0'])
def test_delete_requires_valid_version(client, version):
    item, _ = make_draft(client)
    response = client.delete(f"/api/v1/applications/{item['id']}", params={} if version is None else {'version': version})
    assert response.status_code == 422
    assert client.get(f"/api/v1/applications/{item['id']}").status_code == 200


def test_existing_schema_upgrade_is_repeatable_and_preserves_records(client):
    item, key = make_draft(client)
    with engine.begin() as db:
        db.execute(text('ALTER TABLE application_creations ALTER COLUMN application_id SET NOT NULL'))
    from app.schema_compat import allow_deleted_creation_receipts
    allow_deleted_creation_receipts(engine)
    allow_deleted_creation_receipts(engine)
    assert client.get(f"/api/v1/applications/{item['id']}").json() == item
    assert client.post('/api/v1/applications', json={}, headers={'Idempotency-Key': key}).json()['id'] == item['id']
    assert client.delete(f"/api/v1/applications/{item['id']}", params={'version': 1}).status_code == 204


def test_concurrent_delete_and_patch_preserve_the_winning_operation(client):
    item, _ = make_draft(client)
    path = f"/api/v1/applications/{item['id']}"
    with TestClient(app) as second:
        second.post('/api/v1/auth/demo-login', json={'account_id': 'demo-client-1'})
        with engine.connect() as gate, engine.connect().execution_options(isolation_level='AUTOCOMMIT') as observer, ThreadPoolExecutor(max_workers=2) as workers:
            gate.execute(text('SELECT id FROM applications WHERE id=:id FOR UPDATE'), {'id': item['id']})
            futures = [
                workers.submit(client.delete, path, params={'version': 1}),
                workers.submit(second.patch, path, json={'version': 1, 'purpose': 'Concurrent edit'}),
            ]
            try:
                deadline = time.monotonic() + 10
                while observer.scalar(text("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%applications%' AND pid <> pg_backend_pid()")) < 2:
                    if all(f.done() for f in futures): break
                    assert time.monotonic() < deadline, 'Both operations must reach the lock'
                    time.sleep(0.01)
            finally:
                gate.rollback()
            deleted, patched = [f.result(timeout=10) for f in futures]
        assert (deleted.status_code, patched.status_code) in [(204, 404), (409, 200)]
        current = client.get(path)
        if deleted.status_code == 204:
            assert current.status_code == 404
        else:
            assert current.json()['purpose'] == 'Concurrent edit'
