"""Application-scoped verified data. Original submission snapshots stay immutable."""
from copy import deepcopy
from datetime import date, datetime, timezone
from decimal import Decimal
from sqlalchemy import select
from .models import InfoRequest, StaffFinancialCorrection, StaffProfileCorrection
from .profile_period import MOSCOW, period_for, months_for, full_months


def snapshot_period(snapshot, submitted_at=None):
    company=snapshot.get('company') or {};finance=company.get('finance') or {}
    period=finance.get('period')
    if not period:
        stamp=company.get('as_of_date')
        now=datetime.fromisoformat(stamp).replace(tzinfo=MOSCOW) if stamp else submitted_at or datetime.now(timezone.utc)
        period=period_for(now)
    return period


def financial_rows(snapshot, submitted_at=None):
    finance=(snapshot.get('company') or {}).get('finance') or {}
    stored={row['month']:row for row in finance.get('months',[])}
    return [dict({'month':month.strftime('%Y-%m'),'income_rub':None,'expenses_rub':None,'income_source':None,'expenses_source':None},**stored.get(month.strftime('%Y-%m'),{})) for month in months_for(snapshot_period(snapshot,submitted_at))]


def accepted_financial_values(application_id,db):
    accepted=[(item.financial_accepted_at,0,str(item.id),item.financial_values or []) for item in db.scalars(select(InfoRequest).where(InfoRequest.application_id==application_id,InfoRequest.financial_accepted_at.is_not(None)))]
    accepted += [(item.recorded_at,1,item.id,item.values) for item in db.scalars(select(StaffFinancialCorrection).where(StaffFinancialCorrection.application_id==application_id))]
    return [value for _,_,_,values in sorted(accepted) for value in values]


def effective_company(application,submission,db):
    company=deepcopy(submission.snapshot['company']);finance=company.get('finance') or {}
    finance.update(period=snapshot_period(submission.snapshot,submission.submitted_at),months=financial_rows(submission.snapshot,submission.submitted_at))
    by_month={row['month']:row for row in finance['months']}
    for value in accepted_financial_values(application.id,db):
        if value['kind']=='debt_payment_rub':finance.update(debt_payment_rub=value['value_rub'],debt_source=value['source'])
        elif value.get('month') in by_month:
            by_month[value['month']][value['kind']]=value['value_rub']
            by_month[value['month']][value['kind'].replace('_rub','_source')]=value['source']
    for field in ('income','expenses'):
        values=[row[field+'_rub'] for row in finance['months']]
        finance['average_'+field+'_rub']=format(sum(map(Decimal,values))/6,'.2f') if all(v is not None for v in values) else None
    for field in ('debt_payment_rub','debt_source','debt_as_of'):finance.setdefault(field,None)
    company['finance']=finance
    details=company.get('details') or {}
    for field in ('legal_form','tax_id','okved','registration_date','registration_status','is_bank_client','business_age_months','registry_source'):details.setdefault(field,None)
    corrections=db.scalars(select(StaffProfileCorrection).where(StaffProfileCorrection.application_id==application.id).order_by(StaffProfileCorrection.recorded_at,StaffProfileCorrection.id)).all()
    for correction in corrections:details.update(correction.details)
    if corrections:
        if any(set(correction.details)-{'is_bank_client'} for correction in corrections):details['registry_source']='STAFF_VERIFIED'
        if details.get('registration_date'):
            as_of=date.fromisoformat(company['as_of_date']) if company.get('as_of_date') else submission.submitted_at.astimezone(MOSCOW).date()
            details['business_age_months']=full_months(date.fromisoformat(details['registration_date']),as_of)
    company['details']=details
    return company
