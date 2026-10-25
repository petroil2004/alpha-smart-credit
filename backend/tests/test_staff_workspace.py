import uuid
from app.db import engine
from sqlalchemy import text
from test_submissions import draft, submit


def login(client,account):
    client.post('/api/v1/auth/demo-login',json={'account_id':account})


def test_manual_values_preserve_client_reply_recalculate_and_are_audited(client):
    original=submit(client,draft(client,amount_rub='300000.00',term_months=36)).json()
    assert client.get('/api/v1/staff/profile').status_code==403
    login(client,'demo-staff-1')
    profile=client.get('/api/v1/staff/profile')
    assert profile.status_code==200 and all(profile.json()[key] for key in ['full_name','position','department','city'])
    prefix=f"/api/v1/staff/applications/{original['id']}/info-requests"
    requested=client.post(prefix,json={'version':original['version'],'question':'Уточните расходы','reason':'Проверка документа','document_required':False},headers={'Idempotency-Key':str(uuid.uuid4())}).json()
    request=requested['info_requests'][0];rid=request['id'];path=f'{prefix}/{rid}/financial-corrections'
    month=original['submission']['snapshot']['company']['finance']['months'][0]['month']
    body={'version':requested['version'],'reason':'Проверено по выписке клиента','values':[{'kind':'expenses_rub','month':month,'value_rub':'900000.00'}]}
    headers={'Idempotency-Key':str(uuid.uuid4())}
    assert client.post(path,json=body,headers=headers).status_code==409
    login(client,'demo-client-1')
    assert client.post(path,json=body,headers=headers).status_code==403
    saved=client.patch(f"/api/v1/applications/{original['id']}/info-requests/{rid}/reply",json={'revision':request['revision'],'reply_text':'Расходы подтверждены выпиской'}).json()
    replied=client.post(f"/api/v1/applications/{original['id']}/info-requests/{rid}/reply/submit",json={'version':saved['version'],'revision':saved['info_requests'][0]['revision']},headers={'Idempotency-Key':str(uuid.uuid4())}).json()
    login(client,'demo-staff-1')
    assert client.post(path,json=body,headers=headers).status_code==409
    body['version']=replied['version']
    for change in [{'reason':''},{'values':[{'kind':'expenses_rub','month':'1999-01','value_rub':'2'}]},{'values':[{'kind':'expenses_rub','month':month,'value_rub':'-1'}]}]:
        assert client.post(path,json={**body,**change},headers=headers).status_code==422
    response=client.post(path,json=body,headers=headers)
    assert response.status_code==200,response.text
    updated=response.json();correction=updated['info_requests'][0]['staff_corrections'][0]
    assert updated['assessment']['score']!=original['assessment']['score']
    assert updated['submission']==original['submission']
    assert updated['version']==replied['version']+1
    assert updated['info_requests'][0]['messages'][-1]['text']=='Расходы подтверждены выпиской'
    assert updated['info_requests'][0]['revision']==replied['info_requests'][0]['revision']+1
    assert correction['actor_id']=='demo-staff-1' and correction['values'][0]['source']=='STAFF_VERIFIED'
    assert client.post(path,json=body,headers=headers).json()==updated
    with engine.connect() as db:
        assert db.scalar(text('SELECT count(*) FROM staff_financial_corrections'))==1
    initial_expenses=original['submission']['snapshot']['company']['finance']['months'][0]['expenses_rub']
    restored=client.post(path,json={**body,'version':updated['version'],'values':[{'kind':'expenses_rub','month':month,'value_rub':initial_expenses}]},headers={'Idempotency-Key':str(uuid.uuid4())}).json()
    assert restored['assessment']['score']==original['assessment']['score']
    login(client,'demo-client-1')
    assert len(client.get(f"/api/v1/applications/{original['id']}").json()['info_requests'][0]['staff_corrections'])==2
