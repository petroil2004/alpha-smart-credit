"""Connected MVP review: structured financial facts, score and staff decision."""
import uuid

from test_submissions import draft, submit


def login(client, account):
    assert client.post('/api/v1/auth/demo-login', json={'account_id': account}).status_code == 200


def test_staff_sees_server_score_and_confirms_decision(client):
    item = draft(client, amount_rub='300000.00', term_months=36)
    sent = submit(client, item).json()
    assessment = sent['assessment']
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


def test_only_accepted_structured_financial_answer_changes_assessment(client):
    item = draft(client, amount_rub='300000.00', term_months=36)
    sent = submit(client, item).json()
    login(client, 'demo-staff-1')
    request = client.post(f"/api/v1/staff/applications/{item['id']}/info-requests", json={
        'version': sent['version'], 'question': 'Уточните расходы за один месяц', 'reason': 'Нужно завершить расчёт',
        'document_required': False, 'financial_required': True,
    }, headers={'Idempotency-Key': str(uuid.uuid4())})
    assert request.status_code == 200, request.text
    request_body = request.json(); info = request_body['info_requests'][0]
    login(client, 'demo-client-1')
    saved = client.patch(f"/api/v1/applications/{item['id']}/info-requests/{info['id']}/reply", json={
        'revision': info['revision'], 'reply_text': 'Прикладываю уточнение расходов.'
    }).json()
    info = saved['info_requests'][0]
    closed = client.post(f"/api/v1/applications/{item['id']}/info-requests/{info['id']}/reply/submit", json={
        'version': saved['version'], 'revision': info['revision'], 'financial_values': [{
            'kind': 'expenses_rub', 'month': sent['submission']['snapshot']['company']['finance']['months'][0]['month'],
            'value_rub': '900000.00', 'source': 'CLIENT_CONFIRMED',
        }]
    }, headers={'Idempotency-Key': str(uuid.uuid4())})
    assert closed.status_code == 200, closed.text
    # The submitted number is self-reported and still must not alter the score.
    assert closed.json()['assessment']['score'] == sent['assessment']['score']

    login(client, 'demo-staff-1')
    accepted = client.post(f"/api/v1/staff/applications/{item['id']}/info-requests/{info['id']}/accept-financial", headers={'Idempotency-Key': str(uuid.uuid4())})
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()['info_requests'][0]['financial_accepted_at']
    assert accepted.json()['assessment']['score'] != sent['assessment']['score']
    assert client.post(f"/api/v1/staff/applications/{item['id']}/info-requests/{info['id']}/accept-financial", headers={'Idempotency-Key': str(uuid.uuid4())}).status_code == 409
