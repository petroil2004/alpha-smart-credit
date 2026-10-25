import uuid
from datetime import timedelta
from sqlalchemy import text
from app.business_dates import business_today
from app.db import engine
from test_submissions import draft, submit, operation


def login(client, account='demo-client-1'):
    client.post('/api/v1/auth/demo-login', json={'account_id':account})


def test_funding_requires_owner_consent_approval_and_is_exactly_once(client):
    item = draft(client, amount_rub='300000.00', term_months=36)
    number = item['application_number']
    assert isinstance(number, int) and number > 0
    sent = submit(client,item).json()
    path = f"/api/v1/applications/{item['id']}/disbursement"
    body = {'version':sent['version'], 'confirmed':True}
    headers = {'Idempotency-Key':str(uuid.uuid4())}
    assert client.post(path,json=body,headers=headers).status_code == 409
    login(client,'demo-staff-1')
    assert client.post(path,json=body,headers=headers).status_code == 403
    approved = client.post(f"/api/v1/staff/applications/{item['id']}/decision",json={
        'version':sent['version'],'decision':'APPROVE','comment':''
    },headers={'Idempotency-Key':str(uuid.uuid4())}).json()
    login(client,'demo-client-2')
    assert client.post(path,json=body,headers=headers).status_code == 404
    login(client)
    assert client.post(path,json={**body,'confirmed':False},headers=headers).status_code == 422
    assert client.post(path,json=body,headers=headers).status_code == 409
    body['version']=approved['version']
    result = client.post(path,json=body,headers=headers)
    assert result.status_code == 200, result.text
    issued = result.json()
    assert issued['status'] == 'ISSUED' and issued['application_number'] == number
    assert issued['disbursement']['amount_rub'] == '300000.00'
    assert issued['disbursement']['kind'] == 'CREDITED'
    assert client.post(path,json=body,headers=headers).json() == issued
    assert client.post(path,json=body,headers={'Idempotency-Key':str(uuid.uuid4())}).json() == issued
    assert client.get(f"/api/v1/applications/{item['id']}").json() == issued
    with engine.connect() as db:
        assert db.scalar(text('SELECT count(*) FROM application_disbursements')) == 1
        assert db.scalar(text("SELECT count(*) FROM application_events WHERE reason_code='DEMO_DISBURSED'")) == 1
    other = draft(client)
    assert other['application_number'] > number


def test_dates_reject_past_accept_today_and_recheck_old_draft_at_submission(client):
    item = draft(client,product_code='overdraft',term_months=None)
    path = f"/api/v1/applications/{item['id']}"
    today = business_today()
    for field in ['planned_payment_date','expected_inflow_date']:
        response=client.patch(path,json={'version':item['version'],field:(today-timedelta(days=1)).isoformat()})
        assert response.status_code == 422 and field in response.json()['error']['fields']
    response=client.patch(path,json={'version':item['version'],'planned_payment_date':today.isoformat(),'expected_inflow_date':(today+timedelta(days=7)).isoformat(),
        'planned_payment_rub':'100000.00','expected_inflow_amount_rub':'200000.00','expected_inflow_source':'BUYER','usage_days':14})
    assert response.status_code == 200,response.text
    saved=response.json()
    with engine.begin() as db:
        db.execute(text('UPDATE applications SET planned_payment_date=:yesterday WHERE id=:id'),{'id':item['id'],'yesterday':today-timedelta(days=1)})
    response=submit(client,saved)
    assert response.status_code == 422
    assert 'planned_payment_date' in response.json()['error']['fields']


def test_number_upgrade_preserves_existing_applications_and_is_repeatable(client):
    from app.schema_compat import add_application_numbers
    item=draft(client)
    with engine.begin() as db:
        db.execute(text('ALTER TABLE applications DROP COLUMN application_number CASCADE'))
    add_application_numbers(engine)
    add_application_numbers(engine)
    restored=client.get(f"/api/v1/applications/{item['id']}").json()
    assert restored['id']==item['id'] and restored['purpose']==item['purpose']
    assert restored['application_number']>0
    new=client.post('/api/v1/applications',json={},headers={'Idempotency-Key':str(uuid.uuid4())}).json()
    assert new['application_number']>restored['application_number']
