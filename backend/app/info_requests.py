"""Staff information requests, independent conversations and explicit client reply."""
import uuid
from typing import Annotated
from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, StrictBool
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from .access import ClientAccount, StaffAccount
from .db import get_db
from .models import InfoRequest, InfoMessage, InfoAttachment, utc_now
from .problems import ApiProblem, validation_error
from .serialization import serialize_application
from .info_common import accessible_application,request_for,require_open,check_version,text_value,operation,commit_operation,event

router=APIRouter(prefix='/api/v1')
Positive=Annotated[StrictInt,Field(gt=0)]


class Payload(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)


class CreateRequest(Payload):
    version:Positive
    question:StrictStr
    reason:StrictStr
    document_required:StrictBool
    financial_required:StrictBool=False


class FinancialValue(Payload):
    kind:StrictStr
    month:StrictStr|None=None
    value_rub:StrictStr
    source:StrictStr


class SaveReply(Payload):
    revision:Positive
    reply_text:StrictStr


class SubmitReply(Payload):
    version:Positive
    revision:Positive
    financial_values:list[FinancialValue]=[]


class Message(Payload):
    text:StrictStr


@router.post('/staff/applications/{app_id}/info-requests')
def create_request(app_id:uuid.UUID,payload:CreateRequest,account:StaffAccount,db:Session=Depends(get_db),key:str|None=Header(None,alias='Idempotency-Key')):
    application=accessible_application(db,app_id,account)
    key,sig,replay=operation(db,account,key,'create',app_id,None,payload.model_dump())
    if replay:return serialize_application(application,db)
    check_version(application.version,payload.version)
    if application.status!='UNDER_REVIEW':raise ApiProblem(409,'INVALID_STATE','Запрос доступен только при рассмотрении заявки')
    if db.scalar(select(InfoRequest.id).where(InfoRequest.application_id==app_id,InfoRequest.closed_at.is_(None))):
        raise ApiProblem(409,'REQUEST_OPEN','Один запрос уже открыт')
    question=text_value(payload.question,'question',2000);reason=text_value(payload.reason,'reason',1000)
    now=utc_now()
    db.add(InfoRequest(application_id=app_id,question=question,reason=reason,document_required=payload.document_required,financial_required=payload.financial_required,created_by=account.id,created_at=now))
    event(db,application,account,'INFO_REQUESTED',now,'NEEDS_INFO',question)
    commit_operation(db,account,key,sig)
    return serialize_application(application,db)


@router.patch('/applications/{app_id}/info-requests/{rid}/reply')
def save_reply(app_id:uuid.UUID,rid:uuid.UUID,payload:SaveReply,account:ClientAccount,db:Session=Depends(get_db)):
    application=accessible_application(db,app_id,account);item=request_for(db,application,rid);require_open(application,item)
    value=text_value(payload.reply_text,'reply_text',2000,False)
    if item.reply_text==value:return serialize_application(application,db)
    check_version(item.revision,payload.revision)
    item.reply_text=value;item.reply_by=account.id;item.revision+=1
    event(db,application,account,'INFO_REPLY_SAVED',utc_now())
    db.commit()
    return serialize_application(application,db)


@router.post('/applications/{app_id}/info-requests/{rid}/reply/submit')
def submit_reply(app_id:uuid.UUID,rid:uuid.UUID,payload:SubmitReply,account:ClientAccount,db:Session=Depends(get_db),key:str|None=Header(None,alias='Idempotency-Key')):
    application=accessible_application(db,app_id,account);item=request_for(db,application,rid)
    key,sig,replay=operation(db,account,key,'submit',app_id,rid,payload.model_dump())
    if replay:return serialize_application(application,db)
    require_open(application,item);check_version(application.version,payload.version);check_version(item.revision,payload.revision)
    text_value(item.reply_text,'reply_text',2000)
    values=validate_financial_values(payload.financial_values, application, db)
    if item.financial_required and not values:
        raise validation_error({'financial_values':'Добавьте структурированные финансовые значения для проверки'})
    if item.document_required and not db.scalar(select(func.count()).select_from(InfoAttachment).where(InfoAttachment.request_id==rid,InfoAttachment.detached_at.is_(None))):
        raise validation_error({'attachments':'Прикрепите запрошенный документ'})
    now=utc_now();item.financial_values=values or None;item.closed_at=now;item.closed_by=account.id;item.revision+=1
    event(db,application,account,'INFO_REPLY_SUBMITTED',now,'UNDER_REVIEW')
    commit_operation(db,account,key,sig)
    return serialize_application(application,db)


def validate_financial_values(values, application, db):
    """Text and files never alter figures; only these explicit rows may be accepted."""
    if not values:return []
    from decimal import Decimal, InvalidOperation
    from .models import ApplicationSubmission
    submission=db.get(ApplicationSubmission,application.id)
    months={row.get('month') for row in (submission.snapshot.get('company',{}).get('finance',{}).get('months') or [])} if submission else set()
    result=[];seen=set()
    for item in values:
        if item.kind not in {'income_rub','expenses_rub','debt_payment_rub'} or item.source not in {'CLIENT_DOCUMENT','CLIENT_CONFIRMED'}:
            raise validation_error({'financial_values':'Недопустимое структурированное финансовое значение'})
        if item.kind=='debt_payment_rub':
            if item.month is not None:raise validation_error({'financial_values':'Для платежа по долгам не указывайте месяц'})
        elif item.month not in months:
            raise validation_error({'financial_values':'Укажите один из шести месяцев зафиксированного периода'})
        key=(item.kind,item.month)
        if key in seen:raise validation_error({'financial_values':'Не повторяйте один финансовый показатель'})
        seen.add(key)
        try:value=Decimal(item.value_rub)
        except InvalidOperation as exc:raise validation_error({'financial_values':'Укажите сумму с точностью до копеек'}) from exc
        if not value.is_finite() or value<0 or value>Decimal('9999999999999999.99') or value.as_tuple().exponent < -2:
            raise validation_error({'financial_values':'Укажите неотрицательную сумму до 9999999999999999.99 с точностью до копеек'})
        result.append({'kind':item.kind,'month':item.month,'value_rub':format(value.quantize(Decimal('0.01')),'.2f'),'source':item.source})
    return result


@router.post('/staff/applications/{app_id}/info-requests/{rid}/accept-financial')
def accept_financial(app_id:uuid.UUID,rid:uuid.UUID,account:StaffAccount,db:Session=Depends(get_db),key:str|None=Header(None,alias='Idempotency-Key')):
    application=accessible_application(db,app_id,account);item=request_for(db,application,rid)
    key,sig,replay=operation(db,account,key,'accept-financial',app_id,rid,{})
    if replay:return serialize_application(application,db)
    if application.status!='UNDER_REVIEW' or item.closed_at is None or not item.financial_values:
        raise ApiProblem(409,'INVALID_STATE','Можно принять только отправленное структурированное финансовое уточнение')
    if item.financial_accepted_at is not None:raise ApiProblem(409,'FINANCIAL_ALREADY_ACCEPTED','Эти финансовые сведения уже приняты')
    now=utc_now();item.financial_accepted_at=now;item.financial_accepted_by=account.id
    # SessionLocal intentionally disables autoflush.  The score queries only
    # accepted rows, therefore persist this state before recalculating it.
    db.flush()
    from .review import calculate_assessment
    calculate_assessment(application,db,now)
    event(db,application,account,'FINANCIAL_INFO_ACCEPTED',now,None,'Приняты структурированные финансовые сведения')
    commit_operation(db,account,key,sig)
    return serialize_application(application,db)


def add_message(app_id,rid,payload,account,db,key):
    application=accessible_application(db,app_id,account);item=request_for(db,application,rid)
    key,sig,replay=operation(db,account,key,'message',app_id,rid,payload.model_dump())
    if replay:return serialize_application(application,db)
    require_open(application,item);value=text_value(payload.text,'text',1000);now=utc_now()
    db.add(InfoMessage(request_id=rid,actor_id=account.id,actor_role=account.role,text=value,created_at=now))
    event(db,application,account,'INFO_MESSAGE',now)
    commit_operation(db,account,key,sig)
    return serialize_application(application,db)


@router.post('/applications/{app_id}/info-requests/{rid}/messages')
def client_message(app_id:uuid.UUID,rid:uuid.UUID,payload:Message,account:ClientAccount,db:Session=Depends(get_db),key:str|None=Header(None,alias='Idempotency-Key')):
    return add_message(app_id,rid,payload,account,db,key)


@router.post('/staff/applications/{app_id}/info-requests/{rid}/messages')
def staff_message(app_id:uuid.UUID,rid:uuid.UUID,payload:Message,account:StaffAccount,db:Session=Depends(get_db),key:str|None=Header(None,alias='Idempotency-Key')):
    return add_message(app_id,rid,payload,account,db,key)
