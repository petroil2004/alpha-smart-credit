from app.external_checks import company_checks
from test_submissions import draft, submit
from test_review import login
import uuid

DETAILS = {'registry_source': 'FNS_MOCK', 'tax_id': '7701000001', 'okved': '47.19',
           'registration_status': 'ACTIVE', 'business_age_months': 36}


def test_checks_are_deterministic_and_retry_is_explicit():
    first = company_checks('demo-company-6', DETAILS, '2026-10-25T12:00:00Z')
    assert first[1]['status'] == 'UNAVAILABLE'
    same = company_checks('demo-company-6', DETAILS, '2026-10-25T12:01:00Z', first)
    assert same[1] == first[1]
    retried = company_checks('demo-company-6', DETAILS, '2026-10-25T12:02:00Z', first, retry=True)
    assert retried[1]['reason_code'] == 'CLEAR' and retried[1]['attempt'] == 2
    assert company_checks('demo-company-3', DETAILS, 'now')[1]['reason_code'] == 'NO_HISTORY'
    verified = company_checks('demo-company-1', {**DETAILS, 'registry_source': 'STAFF_VERIFIED'}, 'now')
    assert verified[0]['source'] == 'STAFF_VERIFIED'


def test_high_score_decline_explains_requested_and_available_payment(client):
    item = draft(client, amount_rub='6000000.00', term_months=12)
    assessment = submit(client, item).json()['assessment']
    assert assessment['group'] == 'LOW'
    assert assessment['recommendation'] == 'RECOMMEND_DECLINE'
    assert 'платёж' in assessment['decision_reasons'][0]
    assert float(assessment['affordability']['requested_rub']) > float(assessment['affordability']['available_rub'])


def test_unavailable_bki_does_not_decline_and_only_explicit_retry_unblocks(client):
    item = draft(client, amount_rub='300000.00', term_months=36)
    # Change only the company of this test draft to exercise company 6's prepared scenario.
    from app.db import SessionLocal
    from app.models import Application
    with SessionLocal.begin() as db:
        db.get(Application, uuid.UUID(item['id'])).company_id = 'demo-company-6'
    login(client, 'demo-client-6')
    profile = client.get('/api/v1/company-profile').json()
    sent = client.post(f"/api/v1/applications/{item['id']}/submit", json={
        'version': item['version'], 'profile_version': profile['profile_version'],
        'catalog_version': client.get('/api/v1/products').json()['catalog_version'], 'confirmed': True
    }, headers={'Idempotency-Key':str(uuid.uuid4())}).json()
    assert sent['assessment']['recommendation'] == 'KEEP_UNDER_REVIEW'
    login(client, 'demo-staff-1')
    path = f"/api/v1/staff/applications/{item['id']}"
    rejected = client.post(path+'/decision', json={'version':sent['version'],'decision':'APPROVE'}, headers={'Idempotency-Key':str(uuid.uuid4())})
    assert rejected.status_code == 422
    assert client.post(path+'/decision', json={'version':sent['version'],'decision':'DECLINE','comment':'Источник недоступен'}, headers={'Idempotency-Key':str(uuid.uuid4())}).status_code == 422
    refreshed = client.post(path+'/assessment').json()
    assert refreshed['checks'][1]['reason_code'] == 'CLEAR'
    assert refreshed['recommendation'] == 'OFFER_REQUESTED'
    # Reopening the card and recalculating again must not restore the first failure.
    assert client.get(path).json()['assessment']==refreshed
    repeated=client.post(path+'/assessment').json()
    assert repeated['recommendation']=='OFFER_REQUESTED' and repeated['checks'][1]['attempt']==2
    approved=client.post(path+'/decision',json={'version':sent['version'],'decision':'APPROVE'},headers={'Idempotency-Key':str(uuid.uuid4())})
    assert approved.status_code==200,approved.text
    assert approved.json()['assessment']['recommendation']=='OFFER_REQUESTED'


def test_overdue_requires_staff_explanation_without_changing_score(client):
    item = draft(client, amount_rub='300000.00', term_months=36)
    from app.db import SessionLocal
    from app.models import Application
    with SessionLocal.begin() as db:
        db.get(Application, uuid.UUID(item['id'])).company_id = 'demo-company-2'
    login(client, 'demo-client-2')
    profile = client.get('/api/v1/company-profile').json()
    sent = client.post(f"/api/v1/applications/{item['id']}/submit",json={'version':item['version'],
        'profile_version':profile['profile_version'],'catalog_version':client.get('/api/v1/products').json()['catalog_version'],
        'confirmed':True},headers={'Idempotency-Key':str(uuid.uuid4())}).json()
    assert sent['assessment']['manual_review_required'] is True
    assert sent['assessment']['score'] == 100
    login(client, 'demo-staff-1')
    path=f"/api/v1/staff/applications/{item['id']}/decision"
    payload={'version':sent['version'],'decision':'APPROVE','comment':''}
    assert client.post(path,json=payload,headers={'Idempotency-Key':str(uuid.uuid4())}).status_code == 422
    assert client.post(path,json={**payload,'comment':'Обстоятельства проверены по синтетическим документам'},headers={'Idempotency-Key':str(uuid.uuid4())}).status_code == 200


def test_unknown_registration_requests_information_and_public_terms_are_safe(client):
    public = client.get('/api/v1/public/products')
    assert public.status_code == 200 and set(public.json()) == {'catalog_version','items'}
    item = draft(client, amount_rub='300000.00', term_months=36)
    from app.db import SessionLocal
    from app.models import CompanyData
    with SessionLocal.begin() as db:
        db.get(CompanyData,'demo-company-1').registration_status = None
    assessment = submit(client,item).json()['assessment']
    assert assessment['recommendation'] == 'REQUEST_INFO'
    assert assessment['checks'][0]['status'] == 'MISSING_DATA'
