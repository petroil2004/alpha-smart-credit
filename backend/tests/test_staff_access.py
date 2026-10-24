"""Roles and own-company profile against isolated PostgreSQL."""
from sqlalchemy import text
from app.db import engine


def test_staff_login_has_no_company(client):
    response = client.post('/api/v1/auth/demo-login', json={'account_id': 'demo-staff-1'})
    assert response.status_code == 200
    assert response.json()['company'] is None
    assert response.json()['user']['role'] == 'STAFF'
    assert client.get('/api/v1/me').json() == response.json()


def test_client_and_staff_endpoints_reject_wrong_role(client):
    assert client.get('/api/v1/company-profile').status_code == 401
    client.post('/api/v1/auth/demo-login', json={'account_id': 'demo-staff-1'})
    for path in ['/applications', '/products', '/company-profile']:
        assert client.get('/api/v1' + path).status_code == 403
    assert client.post('/api/v1/applications', json={}).status_code == 403
    assert client.patch('/api/v1/applications/00000000-0000-4000-8000-000000000001', json={'version': 1}).status_code == 403
    assert client.delete('/api/v1/applications/00000000-0000-4000-8000-000000000001?version=1').status_code == 403
    assert client.post('/api/v1/calculations/annuity', json={'product_code': 'working_capital', 'amount_rub': '300000.00', 'term_months': 12}).status_code == 403


def test_company_profile_is_own_and_version_changes_with_displayed_data(client):
    client.post('/api/v1/auth/demo-login', json={'account_id': 'demo-client-1'})
    profile = client.get('/api/v1/company-profile').json()
    assert profile['company_id'] == 'demo-company-1'
    assert profile['source'] == 'BANK_DATA'
    assert set(profile) == {'company_id', 'company_name', 'profile_version', 'source', 'details', 'finance', 'prepared_on', 'data_version', 'as_of_date'}
    with engine.begin() as db:
        db.execute(text("UPDATE accounts SET company_name='Другое название' WHERE id='demo-client-1'"))
    assert client.get('/api/v1/company-profile').json()['profile_version'] != profile['profile_version']
    client.post('/api/v1/auth/demo-login', json={'account_id': 'demo-client-2'})
    assert client.get('/api/v1/company-profile').json()['company_id'] == 'demo-company-2'


def test_account_upgrade_preserves_client_session_and_draft(client):
    client.post('/api/v1/auth/demo-login', json={'account_id': 'demo-client-1'})
    item = client.post('/api/v1/applications', json={}, headers={'Idempotency-Key': '10000000-0000-4000-8000-000000000001'}).json()
    with engine.begin() as db:
        db.execute(text("DELETE FROM accounts WHERE role='STAFF'"))
        db.execute(text('ALTER TABLE accounts ALTER COLUMN company_id SET NOT NULL'))
        db.execute(text('ALTER TABLE accounts ALTER COLUMN company_name SET NOT NULL'))
    from app.schema_compat import allow_staff_accounts
    allow_staff_accounts(engine)
    allow_staff_accounts(engine)
    assert client.get('/api/v1/me').status_code == 200
    assert client.get('/api/v1/applications/' + item['id']).json() == item
