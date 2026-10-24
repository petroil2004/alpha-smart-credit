from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from decimal import Decimal
import pytest
from sqlalchemy import select, text
from app.db import SessionLocal, engine


def login(client,n=1):
    response=client.post('/api/v1/auth/demo-login',json={'account_id':f'demo-client-{n}'})
    assert response.status_code==200,response.text
    return response.json()


def test_profile_contains_six_persistent_months(client):
    login(client)
    profile=client.get('/api/v1/company-profile').json()
    assert 'finance' in profile
    finance=profile['finance']
    assert len(finance['months'])==6
    assert finance['average_income_rub']=='900000.00'
    assert finance['average_expenses_rub']=='600000.00'
    assert finance['debt_payment_rub']=='30000.00'
    assert profile['details']['tax_id'] == '7701000001'
    assert profile['details']['okved'] == '47.19'
    assert profile['details']['registry_source'] == 'FNS_MOCK'
    assert profile['details']['registration_status']=='ACTIVE'
    assert profile['source']=='BANK_DATA'


def test_six_accounts_staff_and_company_isolation(client):
    for n,average in [(1,'900000.00'),(2,'1500000.00'),(3,'800000.00'),(4,'900000.00'),(5,'900000.00'),(6,'4000000.00')]:
        session=login(client,n);p=client.get('/api/v1/company-profile').json()
        assert p['company_id']==session['company']['id']
        assert p['finance']['average_income_rub']==average
        assert p['details']['registration_status']==('TERMINATED' if n==5 else 'ACTIVE')
    client.post('/api/v1/auth/demo-login',json={'account_id':'demo-staff-1'})
    assert client.get('/api/v1/company-profile').status_code==403
    client.post('/api/v1/auth/logout')
    assert client.get('/api/v1/company-profile').status_code==401


def test_unknown_zero_partial_rows_and_fingerprint(client):
    from app.models import CompanyMonth, CompanyData
    login(client,4);profile=client.get('/api/v1/company-profile').json()
    assert profile['finance']['average_expenses_rub'] is None
    assert profile['finance']['months'][3]['expenses_rub'] is None
    login(client)
    old=client.get('/api/v1/company-profile').json()
    with SessionLocal.begin() as db:
        months=db.scalars(select(CompanyMonth).where(CompanyMonth.company_id=='demo-company-1').order_by(CompanyMonth.month)).all()
        months[0].expenses_rub=Decimal('0');months[0].expenses_source='SELF_REPORTED'
    zero=client.get('/api/v1/company-profile').json()
    assert zero['finance']['months'][0]['expenses_rub']=='0.00'
    assert zero['finance']['average_expenses_rub']=='510000.00'
    assert zero['profile_version']!=old['profile_version']
    with SessionLocal.begin() as db:
        db.get(CompanyData,'demo-company-1').debt_payment_rub=None
        db.delete(db.get(CompanyMonth,('demo-company-1',date.fromisoformat(zero['finance']['months'][0]['month']+'-01'))))
    missing=client.get('/api/v1/company-profile').json()
    assert missing['finance']['months'][0]['income_rub'] is None
    assert missing['finance']['average_income_rub'] is None
    assert missing['finance']['debt_payment_rub'] is None


def test_repeat_parallel_seed_keeps_values_and_dates(client):
    from app.demo_profiles import ensure_demo_profiles
    from app.models import CompanyMonth, CompanyData
    login(client);before=client.get('/api/v1/company-profile').json()
    with SessionLocal.begin() as db:
        month=db.scalar(select(CompanyMonth).where(CompanyMonth.company_id=='demo-company-1').order_by(CompanyMonth.month))
        month.income_rub=Decimal('123.45')
        db.get(CompanyData,'demo-company-1').data_version='edited-locally'
    with ThreadPoolExecutor(2) as pool:list(pool.map(lambda _:ensure_demo_profiles(date(2030,2,28)),range(2)))
    after=client.get('/api/v1/company-profile').json()
    assert after['prepared_on']==before['prepared_on']
    assert after['finance']['months'][0]['income_rub']=='123.45'
    assert after['data_version']=='edited-locally'
    with engine.connect() as db:
        assert db.scalar(text('SELECT count(*) FROM company_data'))==6
        assert db.scalar(text('SELECT count(*) FROM company_months'))==36


def test_first_parallel_seed_is_atomic_and_mismatch_does_not_leak(clean_database):
    from app.demo_profiles import ensure_demo_profiles
    from app.models import Account, CompanyData
    with SessionLocal.begin() as db:
        db.add(Account(id='demo-client-1',name='Existing',role='CLIENT',company_id='other-company',company_name='Existing company'))
    with ThreadPoolExecutor(2) as pool:list(pool.map(lambda _:ensure_demo_profiles(date(2026,10,24)),range(2)))
    with SessionLocal() as db:
        assert db.get(Account,'demo-client-1').company_id=='other-company'
        assert db.get(CompanyData,'demo-company-1') is None
        assert db.get(CompanyData,'other-company') is None
        assert db.scalar(text('SELECT count(*) FROM company_data'))==5
        assert db.scalar(text('SELECT count(*) FROM company_months'))==30


def test_unknown_company_returns_unknown_finances(client):
    from app.models import Account
    with SessionLocal.begin() as db:
        db.add(Account(id='unknown',name='Unknown',role='CLIENT',company_id='unknown-company',company_name='Unknown company'))
    client.post('/api/v1/auth/demo-login',json={'account_id':'unknown'})
    p=client.get('/api/v1/company-profile').json()
    assert p['prepared_on'] is None and p['data_version'] is None
    assert all(r['income_rub'] is None and r['expenses_rub'] is None for r in p['finance']['months'])
    assert p['finance']['debt_payment_rub'] is None
    assert p['details']['is_bank_client'] is None


def test_month_year_leap_and_missing_new_month(client):
    from app.profile_period import period_for, months_for, full_months
    from app.company_profile import get_company_profile
    from app.models import Account
    now=datetime(2027,1,1,0,0,tzinfo=timezone.utc)
    assert period_for(now)=={'start_date':'2026-07-01','end_date':'2026-12-31'}
    assert months_for(period_for(now))[-1]==date(2026,12,1)
    assert period_for(datetime(2026,10,31,22,0,tzinfo=timezone.utc))['end_date']=='2026-10-31'
    assert full_months(date(2024,2,29),date(2025,2,28))==11
    with SessionLocal() as db:
        p=get_company_profile(db.get(Account,'demo-client-1'),db,as_of=datetime(2035,1,1,tzinfo=timezone.utc))
    assert len(p['finance']['months'])==6
    assert p['finance']['average_income_rub'] is None
    assert all(r['income_rub'] is None for r in p['finance']['months'])


def test_invalid_seed_rolls_back_entire_dataset(clean_database,monkeypatch,tmp_path):
    import json
    from app import demo_profiles as seed
    data=json.loads(seed.DATA_FILE.read_text())
    data['companies'][1]['expenses'][2]='invalid-money'
    fixture=tmp_path/'invalid.json';fixture.write_text(json.dumps(data));monkeypatch.setattr(seed,'DATA_FILE',fixture)
    with pytest.raises(Exception):seed.ensure_demo_profiles(date(2026,10,24))
    with engine.connect() as db:
        assert db.scalar(text('SELECT count(*) FROM company_data'))==0
        assert db.scalar(text('SELECT count(*) FROM company_months'))==0
        assert db.scalar(text('SELECT count(*) FROM accounts'))==0


def test_source_only_change_changes_confirmation_version(client):
    from app.models import CompanyMonth
    login(client);old=client.get('/api/v1/company-profile').json()
    with SessionLocal.begin() as db:
        row=db.scalar(select(CompanyMonth).where(CompanyMonth.company_id=='demo-company-1').order_by(CompanyMonth.month))
        row.income_source='SELF_REPORTED'
    changed=client.get('/api/v1/company-profile').json()
    assert changed['profile_version']!=old['profile_version']
    assert changed['finance']['months'][0]['income_rub']==old['finance']['months'][0]['income_rub']
