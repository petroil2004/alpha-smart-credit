"""One authorised, fingerprinted projection of the stored synthetic bank dataset."""
import hashlib
import json
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from sqlalchemy import select
from sqlalchemy.orm import Session
from .models import Account, CompanyData, CompanyMonth, utc_now
from .profile_period import MOSCOW, full_months, months_for, period_for


def money(value: Decimal | None) -> str | None:
    return format(value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP), '.2f') if value is not None else None


def get_company_profile(account: Account, db: Session, *, as_of: datetime | None = None) -> dict:
    now = as_of or utc_now()
    day = now.astimezone(MOSCOW).date()
    period = period_for(now)
    expected_months = months_for(period)
    # A single statement snapshot prevents mismatching metadata with monthly facts.
    rows = db.execute(select(CompanyData, CompanyMonth).outerjoin(CompanyMonth, (CompanyMonth.company_id == CompanyData.company_id)
                       & CompanyMonth.month.in_(expected_months)).where(CompanyData.company_id == account.company_id)
                       .execution_options(populate_existing=True)).all()
    dataset = rows[0][0] if rows else None
    stored = {row.month: row for _, row in rows if row is not None}
    months = []
    for month in expected_months:
        row = stored.get(month)
        months.append({'month': month.strftime('%Y-%m'),
                       'income_rub': money(row.income_rub) if row else None,
                       'expenses_rub': money(row.expenses_rub) if row else None,
                       'income_source': row.income_source if row else None,
                       'expenses_source': row.expenses_source if row else None})

    def average(field):
        values = [row[field] for row in months]
        return money(sum(map(Decimal, values), Decimal('0')) / 6) if all(v is not None for v in values) else None

    details = {field: getattr(dataset, field) if dataset else None for field in
               ('legal_form', 'tax_id', 'okved', 'registry_source', 'registration_status', 'is_bank_client')}
    details['registration_date'] = dataset.registration_date.isoformat() if dataset and dataset.registration_date else None
    details['business_age_months'] = full_months(dataset.registration_date, day) if dataset and dataset.registration_date else None
    displayed = {
        'company_id': account.company_id, 'company_name': account.company_name, 'source': 'BANK_DATA',
        'details': details, 'as_of_date': day.isoformat(),
        'prepared_on': dataset.prepared_on.isoformat() if dataset else None,
        'data_version': dataset.data_version if dataset else None,
        'finance': {'period': period, 'months': months,
                    'debt_payment_rub': money(dataset.debt_payment_rub) if dataset else None,
                    'debt_source': dataset.debt_source if dataset else None,
                    'debt_as_of': dataset.debt_as_of.isoformat() if dataset and dataset.debt_as_of else None,
                    'average_income_rub': average('income_rub'), 'average_expenses_rub': average('expenses_rub')},
    }
    digest = hashlib.sha256(json.dumps(displayed, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return {**displayed, 'profile_version': 'company-v2:' + digest}
