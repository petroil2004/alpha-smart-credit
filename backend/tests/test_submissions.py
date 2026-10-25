"""Atomic submissions, immutable facts and staff access on dedicated PostgreSQL."""
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from app.db import engine
from app.main import app


def draft(client, **changes):
    client.post('/api/v1/auth/demo-login', json={'account_id': 'demo-client-1'})
    item = client.post('/api/v1/applications', json={}, headers={'Idempotency-Key': str(uuid.uuid4())}).json()
    payload = {'version': item['version'], 'purpose': 'Закупка товаров', 'product_code': 'working_capital', 'amount_rub': '3000000.00', 'term_months': 36, **changes}
    result = client.patch('/api/v1/applications/' + item['id'], json=payload)
    assert result.status_code == 200, result.text
    return result.json()


def operation(client, item):
    return {'version': item['version'], 'profile_version': client.get('/api/v1/company-profile').json()['profile_version'], 'catalog_version': client.get('/api/v1/products').json()['catalog_version'], 'confirmed': True}


def submit(client, item, body=None, key=None):
    return client.post('/api/v1/applications/' + item['id'] + '/submit', json=body or operation(client, item), headers={'Idempotency-Key': key or str(uuid.uuid4())})


def test_submit_records_snapshot_and_two_events(client):
    item = draft(client)
    response = submit(client, item)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['status'] == 'UNDER_REVIEW'
    assert result['version'] == item['version'] + 1
    snapshot = result['submission']['snapshot']
    assert snapshot['application']['purpose'] == item['purpose']
    assert snapshot['company']['source'] == 'BANK_DATA'
    assert snapshot['calculation']['monthly_payment_rub'] == '119279.48'
    assert snapshot['calculation']['total_payment_rub'] == '4294061.28'
    assert [(e['actor_role'], e['from_status'], e['to_status']) for e in result['history']] == [('CLIENT', 'DRAFT', 'SUBMITTED'), ('SYSTEM', 'SUBMITTED', 'UNDER_REVIEW')]
    assert 'idempotency_key' not in result['submission']
    assert client.patch('/api/v1/applications/' + item['id'], json={'version': result['version'], 'purpose': 'Late'}).status_code == 422
    assert client.delete('/api/v1/applications/' + item['id'], params={'version': result['version']}).status_code == 409
    with engine.begin() as db:
        db.execute(text("UPDATE accounts SET company_name='Новое имя' WHERE id='demo-client-1'"))
    assert client.get('/api/v1/applications/' + item['id']).json() == result


@pytest.mark.parametrize('changes,field', [({'purpose': None}, 'purpose'), ({'purpose': ' '}, 'purpose'), ({'amount_rub': '299999.99'}, 'amount_rub'), ({'amount_rub': '6000000.01'}, 'amount_rub'), ({'term_months': 11}, 'term_months'), ({'term_months': 37}, 'term_months'), ({'amount_rub': None}, 'amount_rub'), ({'term_months': None}, 'term_months'), ({'product_code': None, 'term_months': None}, 'product_code')])
def test_submit_validation_preserves_draft(client, changes, field):
    item = draft(client, **changes)
    result = submit(client, item)
    assert result.status_code == 422
    assert field in result.json()['error']['fields']
    assert client.get('/api/v1/applications/' + item['id']).json() == item
    with engine.connect() as db:
        assert db.scalar(text('SELECT count(*) FROM application_events')) == 0


@pytest.mark.parametrize('changes', [{'amount_rub': '300000.01', 'term_months': 12}, {'amount_rub': '6000000.00', 'term_months': 36}])
def test_submit_accepts_boundaries_and_kopecks_without_financial_data(client, changes):
    item = draft(client, **changes)
    assert submit(client, item).status_code == 200


def test_submit_equipment_and_overdraft_with_product_facts(client):
    equipment = draft(client, product_code='equipment', amount_rub='500000.00', term_months=12, equipment_cost_rub='600000.00')
    equipment_result = submit(client, equipment)
    assert equipment_result.status_code == 200, equipment_result.text
    assert equipment_result.json()['submission']['snapshot']['application']['equipment_cost_rub'] == '600000.00'

    overdraft = draft(client, product_code='overdraft', amount_rub='100000.00', term_months=None, usage_days=14,
                      planned_payment_rub='90000.00', planned_payment_date='2099-10-24',
                      expected_inflow_date='2099-11-01', expected_inflow_amount_rub='100000.00', expected_inflow_source='BUYER')
    overdraft_result = submit(client, overdraft)
    assert overdraft_result.status_code == 200, overdraft_result.text
    calculation = overdraft_result.json()['submission']['snapshot']['calculation']
    assert calculation['interest_rub'] == '897.53' and calculation['due_rub'] == '90897.53'


@pytest.mark.parametrize('field,code', [('version', 'VERSION_CONFLICT'), ('profile_version', 'PROFILE_VERSION_CONFLICT'), ('catalog_version', 'CATALOG_VERSION_CONFLICT')])
def test_submit_checks_all_versions(client, field, code):
    item = draft(client)
    body = operation(client, item)
    body[field] = 999 if field == 'version' else 'stale'
    result = submit(client, item, body)
    assert result.status_code == 409
    assert result.json()['error']['code'] == code


@pytest.mark.parametrize('extra', [{'confirmed': False}, {'confirmed': 'true'}, {'version': True}, {'version': '2'}, {'version': 0}, {'unexpected': 'value'}])
def test_submit_strict_body(client, extra):
    item = draft(client)
    result = submit(client, item, {**operation(client, item), **extra})
    assert result.status_code == 422
    assert client.get('/api/v1/applications/' + item['id']).json() == item


def test_staff_queue_excludes_drafts_and_unregistered_statuses(client):
    item = draft(client)
    with engine.begin() as db:
        db.execute(text("UPDATE applications SET status='UNDER_REVIEW' WHERE id=:id"), {'id': item['id']})
    client.post('/api/v1/auth/demo-login', json={'account_id': 'demo-staff-1'})
    assert client.get('/api/v1/staff/applications').json() == {'items': []}
    assert client.get('/api/v1/staff/applications/' + item['id']).status_code == 404


def test_staff_card_and_client_isolation(client):
    item = draft(client)
    result = submit(client, item).json()
    assert client.get('/api/v1/staff/applications').status_code == 403
    client.post('/api/v1/auth/demo-login', json={'account_id': 'demo-client-2'})
    assert client.get('/api/v1/applications/' + item['id']).status_code == 404
    assert submit(client, item, {'version': item['version'], 'profile_version': 'x', 'catalog_version': 'x', 'confirmed': True}).status_code == 404
    client.post('/api/v1/auth/demo-login', json={'account_id': 'demo-staff-1'})
    rows = client.get('/api/v1/staff/applications').json()['items']
    assert len(rows) == 1 and rows[0]['id'] == item['id']
    assert 'submission' not in rows[0]
    assert client.get('/api/v1/staff/applications/' + item['id']).json() == result
    assert submit(client, item, {'version': 1, 'profile_version': 'x', 'catalog_version': 'x', 'confirmed': True}).status_code == 403
    client.post('/api/v1/auth/logout')
    assert client.get('/api/v1/staff/applications').status_code == 401


def test_submit_replay_survives_new_session(client):
    item = draft(client)
    body, key = operation(client, item), str(uuid.uuid4())
    result = submit(client, item, body, key)
    with TestClient(app) as fresh:
        fresh.post('/api/v1/auth/demo-login', json={'account_id': 'demo-client-1'})
        assert submit(fresh, item, body, key).json() == result.json()
    assert submit(client, item, body).status_code == 409
    with engine.connect() as db:
        assert db.scalar(text('SELECT count(*) FROM application_submissions')) == 1
        assert db.scalar(text('SELECT count(*) FROM application_events')) == 2


def test_submit_key_reuse_with_changed_body_conflicts(client):
    item = draft(client)
    body, key = operation(client, item), str(uuid.uuid4())
    assert submit(client, item, body, key).status_code == 200
    response = submit(client, item, {**body, 'version': 99}, key)
    assert response.status_code == 409
    assert response.json()['error']['code'] == 'IDEMPOTENCY_CONFLICT'
    other = draft(client)
    response = submit(client, other, operation(client, other), key)
    assert response.json()['error']['code'] == 'IDEMPOTENCY_CONFLICT'


def race(item, requests):
    with engine.connect() as gate, engine.connect().execution_options(isolation_level='AUTOCOMMIT') as observer, ThreadPoolExecutor(max_workers=2) as workers:
        gate.execute(text('SELECT id FROM applications WHERE id=:id FOR UPDATE'), {'id': item['id']})
        futures = [workers.submit(fn) for fn in requests]
        try:
            deadline = time.monotonic() + 10
            while observer.scalar(text("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%applications%' AND pid <> pg_backend_pid()")) < 2:
                assert time.monotonic() < deadline
                time.sleep(.01)
        finally:
            gate.rollback()
        return [f.result() for f in futures]


def test_concurrent_submit_has_one_snapshot(client):
    item = draft(client)
    body, key = operation(client, item), str(uuid.uuid4())
    with TestClient(app) as second:
        second.post('/api/v1/auth/demo-login', json={'account_id': 'demo-client-1'})
        responses = race(item, [lambda: submit(client, item, body, key), lambda: submit(second, item, body, key)])
    assert [r.status_code for r in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()
    with engine.connect() as db:
        assert db.scalar(text('SELECT count(*) FROM application_events')) == 2


@pytest.mark.parametrize('action', ['patch', 'delete'])
def test_submit_races_patch_or_delete(client, action):
    item = draft(client)
    body = operation(client, item)
    path = '/api/v1/applications/' + item['id']
    with TestClient(app) as second:
        second.post('/api/v1/auth/demo-login', json={'account_id': 'demo-client-1'})
        change = (lambda: second.patch(path, json={'version': item['version'], 'purpose': 'Другая цель'})) if action == 'patch' else (lambda: second.delete(path, params={'version': item['version']}))
        sent, changed = race(item, [lambda: submit(client, item, body), change])
    if sent.status_code == 200:
        assert changed.status_code in [409, 422]
    else:
        assert sent.status_code in [404, 409]
        assert changed.status_code in [200, 204]
    with engine.connect() as db:
        assert db.scalar(text('SELECT count(*) FROM application_events')) == (2 if sent.status_code == 200 else 0)


@pytest.mark.parametrize('now,start,end', [('2026-10-24T10:00:00+00:00','2026-04-01','2026-09-30'), ('2026-12-31T21:00:00+00:00','2026-07-01','2026-12-31'), ('2026-12-31T20:59:59+00:00','2026-06-01','2026-11-30')])
def test_financial_period_crosses_year(client, monkeypatch, now, start, end):
    item = draft(client)
    import app.submissions as module
    monkeypatch.setattr(module, 'utc_now', lambda: datetime.fromisoformat(now))
    import app.company_profile as profile_module
    monkeypatch.setattr(profile_module, 'utc_now', lambda: datetime.fromisoformat(now))
    result = submit(client, item).json()
    assert result['submission']['snapshot']['financial_period'] == {'start_date': start, 'end_date': end}


def test_client_list_returns_summary_without_snapshot(client):
    item = draft(client)
    submit(client, item)
    row = client.get('/api/v1/applications').json()['items'][0]
    assert row['status'] == 'UNDER_REVIEW'
    assert row['submitted_at']
    assert 'submission' not in row and 'history' not in row
