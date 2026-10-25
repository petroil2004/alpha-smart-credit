import uuid
from app.db import engine
from sqlalchemy import text
from test_submissions import draft, submit


def login(client,account):
    client.post('/api/v1/auth/demo-login',json={'account_id':account})


def test_manual_values_preserve_client_reply_recalculate_and_are_audited(client):
    original=submit(client,draft(client,amount_rub='300000.00',term_months=36)).json()
    initial_profile=client.get('/api/v1/company-profile').json()
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
    login(client,'demo-client-1')
    live=client.get('/api/v1/company-profile').json()
    assert live['profile_version']!=initial_profile['profile_version']
    assert live['finance']['months'][0]['expenses_rub']=='900000.00'
    assert live['finance']['months'][0]['expenses_source']=='STAFF_VERIFIED'
    assert live['financial_pulse']['score'] < initial_profile['financial_pulse']['score']
    login(client,'demo-client-2')
    assert client.get('/api/v1/company-profile').json()['finance']['average_expenses_rub']=='1000000.00'
    login(client,'demo-staff-1')
    assert client.post(path,json=body,headers=headers).json()==updated
    login(client,'demo-client-1')
    assert client.get('/api/v1/company-profile').json()['profile_version']==live['profile_version']
    login(client,'demo-staff-1')
    with engine.connect() as db:
        assert db.scalar(text('SELECT count(*) FROM staff_financial_corrections'))==1
    initial_expenses=original['submission']['snapshot']['company']['finance']['months'][0]['expenses_rub']
    restored=client.post(path,json={**body,'version':updated['version'],'values':[{'kind':'expenses_rub','month':month,'value_rub':initial_expenses}]},headers={'Idempotency-Key':str(uuid.uuid4())}).json()
    assert restored['assessment']['score']==original['assessment']['score']
    login(client,'demo-client-1')
    assert len(client.get(f"/api/v1/applications/{original['id']}").json()['info_requests'][0]['staff_corrections'])==2


def test_missing_months_and_profile_can_be_corrected_without_changing_snapshot(client):
    from app.db import SessionLocal
    from app.models import ApplicationSubmission, CompanyMonth
    from sqlalchemy import delete
    original=submit(client,draft(client,amount_rub='300000.00',term_months=36)).json()
    with SessionLocal() as db:
        submission=db.get(ApplicationSubmission,uuid.UUID(original['id']))
        snapshot={**submission.snapshot,'company':{**submission.snapshot['company'],'finance':{'period':{'start_date':'2026-04-01','end_date':'2026-09-30'},'months':[],'debt_payment_rub':None}}}
        submission.snapshot=snapshot
        db.execute(delete(CompanyMonth).where(CompanyMonth.company_id=='demo-company-1'))
        db.commit()
    login(client,'demo-staff-1');prefix=f"/api/v1/staff/applications/{original['id']}/info-requests"
    requested=client.post(prefix,json={'version':original['version'],'question':'Уточните сведения'},headers={'Idempotency-Key':str(uuid.uuid4())}).json()
    assert len(requested['verified_company']['finance']['months'])==6
    request=requested['info_requests'][0];rid=request['id']
    login(client,'demo-client-1');path=f"/api/v1/applications/{original['id']}/info-requests/{rid}"
    saved=client.patch(path+'/reply',json={'revision':request['revision'],'reply_text':'Сведения предоставлены'}).json()
    replied=client.post(path+'/reply/submit',json={'version':saved['version'],'revision':saved['info_requests'][0]['revision']},headers={'Idempotency-Key':str(uuid.uuid4())}).json()
    profile_path=prefix+'/'+rid+'/profile-corrections'
    payload={'version':replied['version'],'reason':'Проверено сотрудником','details':{'is_bank_client':True}}
    assert client.post(profile_path,json=payload,headers={'Idempotency-Key':str(uuid.uuid4())}).status_code==403
    login(client,'demo-staff-1')
    for details in [{'tax_id':'abc'},{'registration_date':'9999-01-01'},{'is_bank_client':'yes'},{'okved':'abc'}]:
        assert client.post(profile_path,json={**payload,'details':details},headers={'Idempotency-Key':str(uuid.uuid4())}).status_code==422
    values=[{'kind':kind,'month':f'2026-{month:02d}','value_rub':'900000.00' if kind=='income_rub' else '500000.00'} for month in range(4,10) for kind in ['income_rub','expenses_rub']]
    values.append({'kind':'debt_payment_rub','month':None,'value_rub':'0.00'})
    response=client.post(prefix+'/'+rid+'/financial-corrections',json={'version':replied['version'],'reason':'Проверено по сведениям клиента','values':values},headers={'Idempotency-Key':str(uuid.uuid4())})
    assert response.status_code==200,response.text
    updated=response.json();assert updated['verified_company']['finance']['average_income_rub']=='900000.00'
    payload={'version':updated['version'],'reason':'Проверено по регистрационным сведениям','details':{'legal_form':'OOO','tax_id':'7700000001','okved':'47.11','registration_date':'2020-01-01','registration_status':'ACTIVE','is_bank_client':True}}
    key={'Idempotency-Key':str(uuid.uuid4())};corrected=client.post(profile_path,json=payload,headers=key)
    assert corrected.status_code==200,corrected.text
    corrected=corrected.json()
    assert corrected['verified_company']['details']['registration_date']=='2020-01-01'
    assert corrected['verified_company']['details']['registry_source']=='STAFF_VERIFIED'
    assert corrected['verified_company']['details']['business_age_months']>=72
    assert corrected['submission']['snapshot']==snapshot
    assert corrected['assessment']['recommendation']=='OFFER_REQUESTED'
    assert client.post(profile_path,json=payload,headers=key).json()==corrected
    assert len(corrected['info_requests'][0]['profile_corrections'])==1
    login(client,'demo-client-1')
    live=client.get('/api/v1/company-profile').json()
    assert live['details']['registration_date']=='2020-01-01'
    assert live['details']['registry_source']=='STAFF_VERIFIED'
    assert live['details']['tax_id']=='7700000001'
    assert len(live['finance']['months'])==6
    assert all(row['income_rub']=='900000.00' and row['expenses_rub']=='500000.00' for row in live['finance']['months'])
    assert live['finance']['debt_payment_rub']=='0.00'
    assert live['finance']['debt_source']=='STAFF_VERIFIED'


def test_document_toggle_is_enforced_by_upload_api(client):
    from test_info_requests import opened
    from test_info_files import upload
    item,request=opened(client,False);login(client,'demo-client-1')
    assert upload(client,item,request)[0].status_code==409
    assert client.get('/api/v1/applications/'+item['id']).json()['info_requests'][0]['attachments']==[]


def test_overdraft_inconsistent_amounts_and_dates_cannot_be_saved_or_submitted(client):
    item=draft(client,product_code='overdraft',amount_rub='100000.00',term_months=None,planned_payment_rub='90000.00',planned_payment_date='2099-10-24',expected_inflow_date='2099-11-01',expected_inflow_amount_rub='100000.00',expected_inflow_source='BUYER')
    path='/api/v1/applications/'+item['id']
    for changes in [{'planned_payment_rub':'100001.00'},{'expected_inflow_date':'2099-10-23'},{'expected_inflow_date':'2100-01-01'}]:
        response=client.patch(path,json={'version':item['version'],**changes})
        assert response.status_code==422,response.text
    assert client.get(path).json()==item
    changed=client.patch(path,json={'version':item['version'],'expected_inflow_amount_rub':'90000.00'}).json()
    assert submit(client,changed).status_code==422  # principal alone does not cover interest
    response=client.patch(path,json={'version':changed['version'],'expected_inflow_amount_rub':'100000.00'})
    assert response.status_code==200
    sent=submit(client,response.json());assert sent.status_code==200,sent.text
    assert sent.json()['submission']['snapshot']['calculation']['usage_days']==8
