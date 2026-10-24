from datetime import datetime,timezone
from decimal import Decimal
import json
import uuid
import pytest
from sqlalchemy import select,event,text
from app.db import SessionLocal,engine
from test_submissions import draft,operation,submit


def test_month_rollover_requires_new_confirmation(client,monkeypatch):
    from app import company_profile,submissions
    item=draft(client)
    old=datetime(2026,10,31,20,59,tzinfo=timezone.utc)
    new=datetime(2026,10,31,21,0,tzinfo=timezone.utc)
    monkeypatch.setattr(company_profile,'utc_now',lambda:old)
    body=operation(client,item)
    monkeypatch.setattr(submissions,'utc_now',lambda:new)
    response=submit(client,item,body)
    assert response.status_code==409,response.text
    assert response.json()['error']['code']=='PROFILE_VERSION_CONFLICT'
    monkeypatch.setattr(company_profile,'utc_now',lambda:new)
    response=submit(client,item)
    assert response.status_code==200,response.text
    snapshot=response.json()['submission']['snapshot']
    assert snapshot['financial_period']==snapshot['company']['finance']['period']
    assert snapshot['financial_period']=={'start_date':'2026-05-01','end_date':'2026-10-31'}
    assert snapshot['company']['finance']['months'][-1]['income_rub'] is None


def test_new_snapshot_freezes_finances_and_replays_old_version(client):
    from app.models import CompanyData,CompanyMonth
    item=draft(client);body=operation(client,item);key=str(uuid.uuid4())
    sent=submit(client,item,body,key).json();snapshot=sent['submission']['snapshot']
    assert snapshot['company']['finance']['average_income_rub']=='900000.00'
    with SessionLocal.begin() as db:
        db.get(CompanyData,'demo-company-1').debt_payment_rub=Decimal('999.00')
        row=db.scalar(select(CompanyMonth).where(CompanyMonth.company_id=='demo-company-1').order_by(CompanyMonth.month));row.income_rub=Decimal('1.00')
    assert client.get('/api/v1/applications/'+item['id']).json()==sent
    assert submit(client,item,body,key).json()==sent
    client.post('/api/v1/auth/demo-login',json={'account_id':'demo-staff-1'})
    assert client.get('/api/v1/staff/applications/'+item['id']).json()==sent
    assert client.get('/api/v1/company-profile').status_code==403


def test_finance_null_change_conflicts_without_partial_submission(client):
    from app.models import CompanyMonth
    item=draft(client);body=operation(client,item)
    with SessionLocal.begin() as db:
        row=db.scalar(select(CompanyMonth).where(CompanyMonth.company_id=='demo-company-1').order_by(CompanyMonth.month));row.expenses_rub=None
    response=submit(client,item,body)
    assert response.status_code==409
    with engine.connect() as db:
        assert db.scalar(text('SELECT count(*) FROM application_submissions'))==0
        assert db.scalar(text('SELECT count(*) FROM application_events'))==0


def test_partial_finances_are_allowed_and_old_snapshots_stay_old(client):
    item=draft(client)
    from app.models import CompanyMonth
    with SessionLocal.begin() as db:
        row=db.scalar(select(CompanyMonth).where(CompanyMonth.company_id=='demo-company-1').order_by(CompanyMonth.month));row.expenses_rub=None
    sent=submit(client,item).json();assert sent['status']=='UNDER_REVIEW'
    assert sent['submission']['snapshot']['company']['finance']['average_expenses_rub'] is None
    legacy=sent['submission']['snapshot']
    legacy['company']={k:legacy['company'][k] for k in ['company_id','company_name','profile_version','source']}
    with engine.begin() as db:db.execute(text('UPDATE application_submissions SET snapshot=CAST(:snapshot AS jsonb) WHERE application_id=:id'),{'snapshot':json.dumps(legacy),'id':item['id']})
    current=client.get('/api/v1/applications/'+item['id']).json()
    assert current['submission']['snapshot']==legacy
    assert 'finance' not in current['submission']['snapshot']['company']


def test_profile_is_one_statement_snapshot_under_concurrent_change(client):
    client.post('/api/v1/auth/demo-login',json={'account_id':'demo-client-1'})
    before=client.get('/api/v1/company-profile').json();changed=False
    def mutate_after_select(conn,cursor,statement,parameters,context,executemany):
        nonlocal changed
        if not changed and statement.lstrip().startswith('SELECT') and 'LEFT OUTER JOIN company_months' in statement:
            changed=True
            with engine.begin() as writer:
                writer.execute(text("UPDATE company_data SET debt_payment_rub=123.45 WHERE company_id='demo-company-1'"))
                writer.execute(text("UPDATE company_months SET income_rub=77.77 WHERE company_id='demo-company-1'"))
    event.listen(engine,'after_cursor_execute',mutate_after_select)
    try:during=client.get('/api/v1/company-profile').json()
    finally:event.remove(engine,'after_cursor_execute',mutate_after_select)
    assert changed
    assert during==before
    after=client.get('/api/v1/company-profile').json()
    assert after['finance']['debt_payment_rub']=='123.45'
    assert after['finance']['average_income_rub']=='77.77'
    assert after['profile_version']!=before['profile_version']
