"""Insert a complete deterministic dataset once; never replace existing customer data."""
import json
import logging
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path
from sqlalchemy import text
from .db import SessionLocal
from .models import Account, CompanyData, CompanyMonth, utc_now
from .profile_period import MOSCOW, months_for, period_for, shift_month

log = logging.getLogger(__name__)
DATA_FILE = Path(__file__).with_name('demo_data') / 'company-profiles.json'


def ensure_demo_profiles(prepared_on: date | None = None) -> None:
    data = json.loads(DATA_FILE.read_text())
    day = prepared_on or utc_now().astimezone(MOSCOW).date()
    months = months_for(period_for(datetime.combine(day, time.min, MOSCOW)))
    with SessionLocal.begin() as db:
        # One transaction-wide lock covers accounts, dataset marker and every monthly row.
        db.execute(text('SELECT pg_advisory_xact_lock(732416902)'))
        if db.get(Account, 'demo-staff-1') is None:
            db.add(Account(id='demo-staff-1', name='Демо-сотрудник', role='STAFF', company_id=None, company_name=None))
        for number, item in enumerate(data['companies'], 1):
            account = db.get(Account, item['account_id'])
            if account is None:
                account = Account(id=item['account_id'], name=f'Демо-клиент {number}', role='CLIENT',
                                  company_id=item['company_id'], company_name=item['company_name'])
                db.add(account)
            if (account.role, account.company_id, account.company_name) != ('CLIENT', item['company_id'], item['company_name']):
                log.warning('Demo profile skipped: existing account %s differs from its fixture', item['account_id'])
                continue
            if db.get(CompanyData, item['company_id']) is not None:
                continue
            db.add(CompanyData(company_id=item['company_id'], legal_form=item['legal_form'], tax_id=None, okved=None,
                               registration_date=shift_month(day, -36), registration_status=item['registration_status'],
                               is_bank_client=True, prepared_on=day, data_version=data['data_version'],
                               debt_payment_rub=Decimal(item['debt_payment_rub']), debt_source='BANK_DATA', debt_as_of=day))
            db.flush()
            for month, income, expenses in zip(months, item['income'], item['expenses'], strict=True):
                db.add(CompanyMonth(company_id=item['company_id'], month=month,
                                    income_rub=Decimal(income) if income is not None else None,
                                    expenses_rub=Decimal(expenses) if expenses is not None else None,
                                    income_source='BANK_DATA' if income is not None else None,
                                    expenses_source='BANK_DATA' if expenses is not None else None))
