"""Explicit API projections; internal replay receipts are never exposed."""
from datetime import timezone
from typing import Any
from sqlalchemy import select
from sqlalchemy.orm import Session
from .info_serialization import serialize_info_requests
from .models import Account, Application, ApplicationSubmission, ApplicationEvent, ApplicationDisbursement

def timestamp(value) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def application_values(application: Application) -> dict[str, Any]:
    money = lambda value: format(value, ".2f") if value is not None else None
    return {
        "id": str(application.id),
        "application_number": application.application_number,
        "company_id": application.company_id,
        "status": application.status,
        "purpose": application.purpose,
        "product_code": application.product_code,
        "amount_rub": money(application.amount_rub),
        "term_months": application.term_months,
        "usage_days": application.usage_days,
        "expected_inflow_date": application.expected_inflow_date.isoformat() if application.expected_inflow_date else None,
        "expected_inflow_amount_rub": money(application.expected_inflow_amount_rub),
        "equipment_cost_rub": money(application.equipment_cost_rub),
        "planned_payment_rub": money(application.planned_payment_rub),
        "planned_payment_date": application.planned_payment_date.isoformat() if application.planned_payment_date else None,
        "expected_inflow_source": application.expected_inflow_source,
        "version": application.version,
        "created_at": timestamp(application.created_at),
        "updated_at": timestamp(application.updated_at),
    }



def serialize_application(application: Application, db: Session, *, detail: bool = True) -> dict:
    result = application_values(application)
    submission = db.get(ApplicationSubmission, application.id)
    company_name = (submission.snapshot['company']['company_name'] if submission else
                    db.scalar(select(Account.company_name).where(Account.company_id == application.company_id).order_by(Account.id).limit(1)))
    result.update(company_name=company_name, submitted_at=timestamp(submission.submitted_at) if submission else None)
    result['next_action'] = 'CLIENT' if application.status == 'NEEDS_INFO' else 'STAFF' if application.status == 'UNDER_REVIEW' else None
    if detail:
        if submission:
            funding = db.get(ApplicationDisbursement, application.id)
            result['disbursement'] = {'confirmed_at':timestamp(funding.confirmed_at), 'amount_rub':format(funding.amount_rub,'.2f'), 'kind':funding.kind} if funding else None
        result['info_requests'] = serialize_info_requests(application.id, db)
        result['submission'] = {'submitted_at': timestamp(submission.submitted_at), 'submitted_by': submission.actor_id,
                                'snapshot': submission.snapshot} if submission else None
        events = db.scalars(select(ApplicationEvent).where(ApplicationEvent.application_id == application.id)
                            .order_by(ApplicationEvent.occurred_at, ApplicationEvent.id)).all()
        result['history'] = [{key: getattr(event, key) for key in
                             ('id', 'actor_id', 'actor_role', 'from_status', 'to_status', 'reason_code', 'comment', 'catalog_version', 'offer_version', 'check_version')}
                            | {'occurred_at': timestamp(event.occurred_at)} for event in events]
        # A draft has no assessment.  Keeping the key absent for drafts also
        # preserves the compact draft/list projection used by existing clients.
        if submission:
            from .models import ApplicationAssessment
            assessment = db.get(ApplicationAssessment, application.id)
            result['assessment'] = assessment.result if assessment else None
    return result
