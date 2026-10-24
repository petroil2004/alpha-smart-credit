"""Atomic registration for review, immutable submitted facts, staff read API."""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .access import ClientAccount, StaffAccount
from .calculator import CalculationValidationError, calculate_annuity
from .company_profile import get_company_profile
from .profile_period import period_for
from .db import get_db
from .models import Application, ApplicationSubmission, ApplicationEvent, utc_now
from .problems import ApiProblem, validation_error
from .product_catalog import get_catalog
from .serialization import application_values, serialize_application, timestamp

router = APIRouter(prefix='/api/v1')


class SubmitPayload(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    version: Annotated[StrictInt, Field(gt=0)]
    profile_version: StrictStr
    catalog_version: StrictStr
    confirmed: StrictBool


def financial_period(now) -> dict[str, str]:
    return period_for(now)


def replay(receipt, application, actor_id, body, db):
    if receipt.application_id != application.id or receipt.actor_id != actor_id or receipt.request_payload != body:
        raise ApiProblem(409, 'IDEMPOTENCY_CONFLICT', 'Этот ключ уже использован для другой отправки.')
    return serialize_application(application, db)


@router.post('/applications/{application_id}/submit')
def submit_application(application_id: uuid.UUID, payload: SubmitPayload, account: ClientAccount,
                       db: Session = Depends(get_db), idempotency_key: str | None = Header(default=None, alias='Idempotency-Key')):
    query = select(Application).where(Application.id == application_id, Application.company_id == account.company_id).with_for_update()
    application = db.scalar(query)
    if not application:
        raise ApiProblem(404, 'NOT_FOUND', 'Заявка не найдена')
    try:
        key = str(uuid.UUID(idempotency_key or ''))
    except ValueError as exc:
        raise validation_error({'Idempotency-Key': 'Укажите UUID-ключ отправки'}) from exc
    body = payload.model_dump()
    receipt = db.scalar(select(ApplicationSubmission).where(ApplicationSubmission.actor_id == account.id, ApplicationSubmission.idempotency_key == key))
    if receipt:
        return replay(receipt, application, account.id, body, db)
    if application.status != 'DRAFT':
        raise ApiProblem(409, 'APPLICATION_NOT_DRAFT', 'Заявка уже отправлена. Обновите карточку.')
    if application.version != payload.version:
        raise ApiProblem(409, 'VERSION_CONFLICT', 'Заявка изменена. Загрузите сохранённую версию.')
    now = utc_now()
    profile = get_company_profile(account, db, as_of=now)
    if payload.profile_version != profile['profile_version']:
        raise ApiProblem(409, 'PROFILE_VERSION_CONFLICT', 'Сведения компании изменились. Обновите и подтвердите их заново.')
    if payload.catalog_version != get_catalog()['catalog_version']:
        raise ApiProblem(409, 'CATALOG_VERSION_CONFLICT', 'Условия изменились. Обновите расчёт и подтвердите заново.')
    fields = {}
    if not payload.confirmed:
        fields['confirmed'] = 'Подтвердите сведения и выбранные параметры'
    if not application.purpose or not application.purpose.strip() or len(application.purpose) > 500:
        fields['purpose'] = 'Укажите, на что нужны средства'
    if application.product_code in {'equipment', 'overdraft'}:
        raise ApiProblem(422, 'SUBMISSION_NOT_AVAILABLE', 'Отправка этого продукта пока недоступна. Сохраните черновик.', {'product_code': 'Сейчас отправить можно оборотный кредит'})
    if application.product_code != 'working_capital':
        fields['product_code'] = 'Выберите оборотный кредит'
    if application.amount_rub is None:
        fields['amount_rub'] = 'Укажите сумму'
    if application.term_months is None:
        fields['term_months'] = 'Укажите срок'
    for name in ('usage_days', 'expected_inflow_date', 'expected_inflow_amount_rub'):
        if getattr(application, name) is not None:
            fields[name] = 'Поле неприменимо к оборотному кредиту'
    if fields:
        raise validation_error(fields)
    try:
        calculation = calculate_annuity(application.product_code, application.amount_rub, application.term_months)
    except CalculationValidationError as exc:
        raise validation_error(exc.fields) from exc
    values = application_values(application)
    snapshot = {
        'application': {field: values[field] for field in ('purpose', 'product_code', 'amount_rub', 'term_months', 'usage_days', 'expected_inflow_date', 'expected_inflow_amount_rub')},
        'company': profile, 'calculation': calculation, 'financial_period': profile['finance']['period'],
        'confirmed_at': timestamp(now), 'confirmed_by': account.id,
    }
    db.add(ApplicationSubmission(application_id=application.id, actor_id=account.id, idempotency_key=key,
                                 request_payload=body, submitted_at=now, snapshot=snapshot))
    for actor_id, role, previous, next_status, reason in [
        (account.id, 'CLIENT', 'DRAFT', 'SUBMITTED', 'CLIENT_SUBMITTED'),
        (None, 'SYSTEM', 'SUBMITTED', 'UNDER_REVIEW', 'REGISTERED_FOR_REVIEW'),
    ]:
        db.add(ApplicationEvent(application_id=application.id, actor_id=actor_id, actor_role=role, occurred_at=now,
                                from_status=previous, to_status=next_status, reason_code=reason, catalog_version=calculation['catalog_version']))
    application.status = 'UNDER_REVIEW'
    application.version += 1
    application.updated_at = now
    try:
        db.commit()
    except IntegrityError:
        # A simultaneous submission of ANOTHER application can race on this actor's key.
        db.rollback()
        receipt = db.scalar(select(ApplicationSubmission).where(ApplicationSubmission.actor_id == account.id, ApplicationSubmission.idempotency_key == key))
        if receipt:
            return replay(receipt, application, account.id, body, db)
        raise
    return serialize_application(application, db)


@router.get('/staff/applications')
def staff_applications(account: StaffAccount, db: Session = Depends(get_db)):
    applications = db.scalars(select(Application).join(ApplicationSubmission)
                             .where(Application.status.in_(['UNDER_REVIEW','NEEDS_INFO']))
                             .order_by(Application.updated_at.desc(), Application.id.desc())).all()
    return {'items': [serialize_application(application, db, detail=False) for application in applications]}


@router.get('/staff/applications/{application_id}')
def staff_application(application_id: uuid.UUID, account: StaffAccount, db: Session = Depends(get_db)):
    application = db.scalar(select(Application).join(ApplicationSubmission)
                            .where(Application.id == application_id, Application.status.in_(['UNDER_REVIEW','NEEDS_INFO'])))
    if not application:
        raise ApiProblem(404, 'NOT_FOUND', 'Заявка не найдена')
    return serialize_application(application, db)
