"""Only status transitions of the client's company become persistent notifications."""
import uuid
from app.db import engine
from app.models import ApplicationEvent, utc_now
from test_submissions import draft, submit


def test_notifications_are_scoped_durable_and_only_about_status_changes(client):
    item = submit(client, draft(client)).json()
    response = client.get('/api/v1/notifications')
    assert response.status_code == 200
    data = response.json()
    assert data['unread_count'] == 1
    notice = data['items'][0]
    assert notice['application_id'] == item['id']
    assert notice['status'] == 'UNDER_REVIEW' and not notice['read']
    path = f"/api/v1/notifications/{notice['id']}/read"
    client.post('/api/v1/auth/demo-login', json={'account_id': 'demo-client-2'})
    assert client.get('/api/v1/notifications').json() == {'items': [], 'unread_count': 0}
    assert client.post(path).status_code == 404
    client.post('/api/v1/auth/demo-login', json={'account_id': 'demo-staff-1'})
    assert client.get('/api/v1/notifications').status_code == 403
    assert client.post(path).status_code == 403
    client.post('/api/v1/auth/demo-login', json={'account_id': 'demo-client-1'})
    assert client.post(path).status_code == 204
    assert client.post(path).status_code == 204
    client.post('/api/v1/auth/logout')
    client.post('/api/v1/auth/demo-login', json={'account_id': 'demo-client-1'})
    assert client.get('/api/v1/notifications').json()['unread_count'] == 0
    assert client.get('/api/v1/notifications').json()['items'][0]['read']
    with engine.begin() as db:
        common = dict(application_id=uuid.UUID(item['id']), actor_id='demo-staff-1', actor_role='STAFF', occurred_at=utc_now(), catalog_version='test')
        db.execute(ApplicationEvent.__table__.insert(), [
            {**common, 'from_status':'UNDER_REVIEW', 'to_status':'NEEDS_INFO', 'reason_code':'INFO_REQUESTED', 'comment':'Нужна выписка'},
            {**common, 'from_status':'NEEDS_INFO', 'to_status':'NEEDS_INFO', 'reason_code':'INFO_MESSAGE', 'comment':'Сообщение'},
        ])
    updated = client.get('/api/v1/notifications').json()
    assert updated['unread_count'] == 1 and len(updated['items']) == 2
    assert updated['items'][0]['title'] == 'Банк запросил уточнения'
    assert updated['items'][0]['message'] == 'Нужна выписка'
    client.post('/api/v1/auth/logout')
    assert client.get('/api/v1/notifications').status_code == 401
