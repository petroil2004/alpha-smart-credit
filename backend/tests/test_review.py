"""Connected MVP review: structured financial facts, score and staff decision."""
import uuid
import pytest
from decimal import Decimal

from test_submissions import draft, submit


@pytest.mark.parametrize('amount', ['NaN', 'Infinity', '10000000000000000.00'])
def test_invalid_financial_amount_is_validation_error(amount):
    from types import SimpleNamespace
    from app.info_requests import FinancialValue, validate_financial_values
    from app.problems import ApiProblem
    value = FinancialValue(kind='debt_payment_rub', value_rub=amount, source='CLIENT_CONFIRMED')
    with pytest.raises(ApiProblem) as failure:
        validate_financial_values([value], SimpleNamespace(id=uuid.uuid4()), SimpleNamespace(get=lambda *_: None))
    assert failure.value.status_code == 422


def test_latest_accepted_correction_wins_even_when_rows_inserted_out_of_order(client):
    from datetime import datetime, timedelta, timezone
    from app.db import SessionLocal
    from app.models import InfoRequest, Application, ApplicationSubmission
    from app.review import assessment_facts
    item = draft(client, amount_rub='300000.00', term_months=36)
    sent = submit(client, item).json()
    month = sent['submission']['snapshot']['company']['finance']['months'][0]['month']
    now = datetime.now(timezone.utc)
    app_id = uuid.UUID(item['id'])
    with SessionLocal.begin() as db:
        for accepted_at, amount in [(now, '500000.00'), (now-timedelta(days=1), '950000.00')]:
            db.add(InfoRequest(application_id=app_id, question='Расходы', reason='Уточнение', document_required=False,
                               created_by='demo-staff-1', closed_at=accepted_at, financial_accepted_at=accepted_at,
                               financial_accepted_by='demo-staff-1', financial_values=[{'kind':'expenses_rub', 'month':month,
                               'value_rub':amount, 'source':'CLIENT_CONFIRMED'}]))
    with SessionLocal() as db:
        facts = assessment_facts(db.get(Application, app_id), db.get(ApplicationSubmission, app_id), db)
    assert facts['months'][0]['expenses_rub'] == '500000.00'


def login(client, account):
    assert client.post('/api/v1/auth/demo-login', json={'account_id': account}).status_code == 200


def test_staff_sees_server_score_and_confirms_decision(client):
    item = draft(client, amount_rub='300000.00', term_months=36)
    sent = submit(client, item).json()
    assessment = sent['assessment']
    assert sum(row['points'] for row in assessment['criteria']) == assessment['score']
    assert all(Decimal(row['factor']) * row['weight'] == row['points'] for row in assessment['criteria'])
    assert assessment['score'] == 100
    assert assessment['group'] == 'LOW'
    assert assessment['recommendation'] == 'OFFER_REQUESTED'
    assert assessment['model_version'] == 'demo-scorecard-v0-temporary'

    login(client, 'demo-staff-1')
    refreshed = client.post(f"/api/v1/staff/applications/{item['id']}/assessment")
    assert refreshed.status_code == 200 and refreshed.json()['score'] == 100
    decision = client.post(f"/api/v1/staff/applications/{item['id']}/decision", json={
        'version': sent['version'], 'decision': 'APPROVE', 'comment': ''
    }, headers={'Idempotency-Key': str(uuid.uuid4())})
    assert decision.status_code == 200, decision.text
    assert decision.json()['status'] == 'APPROVED'

    login(client, 'demo-client-1')
    assert client.get(f"/api/v1/applications/{item['id']}").json()['status'] == 'APPROVED'


def test_client_numbers_do_not_replace_verified_financial_data(client):
    item = draft(client, amount_rub='300000.00', term_months=36)
    sent = submit(client, item).json()
    login(client, 'demo-staff-1')
    prefix=f"/api/v1/staff/applications/{item['id']}/info-requests"
    request=client.post(prefix,json={'version':sent['version'],'question':'Пришлите выписку','document_required':False},headers={'Idempotency-Key':str(uuid.uuid4())}).json()
    info=request['info_requests'][0];rid=info['id'];login(client,'demo-client-1')
    path=f"/api/v1/applications/{item['id']}/info-requests/{rid}"
    saved=client.patch(path+'/reply',json={'revision':info['revision'],'reply_text':'Расходы 900000'}).json()
    body={'version':saved['version'],'revision':saved['info_requests'][0]['revision']}
    assert client.post(path+'/reply/submit',json={**body,'financial_values':[]},headers={'Idempotency-Key':str(uuid.uuid4())}).status_code==422
    reply=client.post(path+'/reply/submit',json=body,headers={'Idempotency-Key':str(uuid.uuid4())}).json()
    assert reply['assessment']['score']==sent['assessment']['score']
    login(client,'demo-staff-1')
    correction=client.post(prefix+'/'+rid+'/financial-corrections',json={'version':reply['version'],'reason':'Проверено сотрудником по документу','values':[{'kind':'expenses_rub','month':sent['submission']['snapshot']['company']['finance']['months'][0]['month'],'value_rub':'900000.00'}]},headers={'Idempotency-Key':str(uuid.uuid4())})
    assert correction.status_code==200,correction.text
    assert correction.json()['assessment']['score']!=sent['assessment']['score']
