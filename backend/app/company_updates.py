"""Persist staff-verified changes to the live company, within the correction transaction."""
import uuid
from datetime import date
from decimal import Decimal
from sqlalchemy import select
from .models import CompanyData, CompanyMonth
from .profile_period import MOSCOW


def update_company_data(db, company_id, now, *, financial_values=None, details=None):
    # Serialize writes from different applications belonging to the same company.
    dataset = db.scalar(select(CompanyData).where(CompanyData.company_id == company_id).with_for_update())
    if dataset is None:
        dataset = CompanyData(company_id=company_id, prepared_on=now.astimezone(MOSCOW).date())
        db.add(dataset)
    dataset.data_version = 'staff-verified:' + uuid.uuid4().hex
    db.flush()
    months = {}
    for value in financial_values or []:
        if value['kind'] == 'debt_payment_rub':
            dataset.debt_payment_rub = Decimal(value['value_rub'])
            dataset.debt_source = 'STAFF_VERIFIED'
            dataset.debt_as_of = now.astimezone(MOSCOW).date()
        else:
            month = date.fromisoformat(value['month'] + '-01')
            row = months.get(month)
            if row is None:
                row = db.get(CompanyMonth, (company_id, month))
            if row is None:
                row = CompanyMonth(company_id=company_id, month=month)
                db.add(row)
            months[month] = row
            setattr(row, value['kind'], Decimal(value['value_rub']))
            setattr(row, value['kind'].replace('_rub', '_source'), 'STAFF_VERIFIED')
    for field, value in (details or {}).items():
        setattr(dataset, field, date.fromisoformat(value) if field == 'registration_date' else value)
    if details and set(details) - {'is_bank_client'}:
        dataset.registry_source = 'STAFF_VERIFIED'
