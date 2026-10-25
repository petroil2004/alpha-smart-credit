"""Staff information requests, independent conversations and explicit client reply."""
import uuid
from typing import Annotated
from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, StrictBool
from sqlalchemy import select
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
    reason:StrictStr=""
    document_required:StrictBool=False


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


class Message(Payload):
    text:StrictStr


@router.post('/staff/applications/{app_id}/info-requests')
def create_request(app_id:uuid.UUID,payload:CreateRequest,account:StaffAccount,db:Session=Depends(get_db),key:str|None=Header(None,alias='Idempotency-Key')):
    application=accessible_application(db,app_id,account)
    key,sig,replay=operation(db,account,key,'create',app_id,None,payload.model_dump())
    if replay:return serialize_application(application,db,staff=account.role=='STAFF')
    check_version(application.version,payload.version)
    if application.status!='UNDER_REVIEW':raise ApiProblem(409,'INVALID_STATE','Запрос доступен только при рассмотрении заявки')
    if db.scalar(select(InfoRequest.id).where(InfoRequest.application_id==app_id,InfoRequest.closed_at.is_(None))):
        raise ApiProblem(409,'REQUEST_OPEN','Один запрос уже открыт')
    question=text_value(payload.question,'question',2000);reason=text_value(payload.reason,'reason',1000,False)
    now=utc_now()
    db.add(InfoRequest(application_id=app_id,question=question,reason=reason,document_required=payload.document_required,financial_required=False,created_by=account.id,created_at=now))
    event(db,application,account,'INFO_REQUESTED',now,'NEEDS_INFO',question)
    commit_operation(db,account,key,sig)
    return serialize_application(application,db,staff=account.role=='STAFF')


@router.patch('/applications/{app_id}/info-requests/{rid}/reply')
def save_reply(app_id:uuid.UUID,rid:uuid.UUID,payload:SaveReply,account:ClientAccount,db:Session=Depends(get_db)):
    application=accessible_application(db,app_id,account);item=request_for(db,application,rid);require_open(application,item)
    value=text_value(payload.reply_text,'reply_text',2000,False)
    if item.reply_text==value:return serialize_application(application,db,staff=account.role=='STAFF')
    check_version(item.revision,payload.revision)
    item.reply_text=value;item.reply_by=account.id;item.revision+=1
    event(db,application,account,'INFO_REPLY_SAVED',utc_now())
    db.commit()
    return serialize_application(application,db,staff=account.role=='STAFF')


@router.post('/applications/{app_id}/info-requests/{rid}/reply/submit')
def submit_reply(app_id:uuid.UUID,rid:uuid.UUID,payload:SubmitReply,account:ClientAccount,db:Session=Depends(get_db),key:str|None=Header(None,alias='Idempotency-Key')):
    application=accessible_application(db,app_id,account);item=request_for(db,application,rid)
    key,sig,replay=operation(db,account,key,'submit',app_id,rid,payload.model_dump())
    if replay:return serialize_application(application,db,staff=account.role=='STAFF')
    require_open(application,item);check_version(application.version,payload.version);check_version(item.revision,payload.revision)
    pending=db.scalars(select(InfoAttachment).where(InfoAttachment.request_id==rid,InfoAttachment.detached_at.is_(None),InfoAttachment.message_id.is_(None))).all()
    if not item.reply_text.strip() and not pending:
        raise validation_error({'reply_text':'Напишите сообщение или прикрепите документ'})
    now=utc_now()
    message=InfoMessage(request_id=rid,actor_id=account.id,actor_role=account.role,text=item.reply_text.strip() or 'Документы для рассмотрения',created_at=now)
    db.add(message);db.flush()
    for attachment in pending:attachment.message_id=message.id
    item.reply_text='';item.reply_by=account.id;item.reply_submitted_at=now;item.revision+=1
    event(db,application,account,'INFO_REPLY_SUBMITTED',now,'NEEDS_INFO')
    commit_operation(db,account,key,sig)
    return serialize_application(application,db)


class CloseRequest(Payload):
    version:Positive
    revision:Positive


@router.post('/staff/applications/{app_id}/info-requests/{rid}/close')
def close_request(app_id:uuid.UUID,rid:uuid.UUID,payload:CloseRequest,account:StaffAccount,db:Session=Depends(get_db),key:str|None=Header(None,alias='Idempotency-Key')):
    application=accessible_application(db,app_id,account);item=request_for(db,application,rid)
    key,sig,replay=operation(db,account,key,'close',app_id,rid,payload.model_dump())
    if replay:return serialize_application(application,db,staff=True)
    require_open(application,item);check_version(application.version,payload.version);check_version(item.revision,payload.revision)
    if item.reply_submitted_at is None:raise ApiProblem(409,'REPLY_REQUIRED','Дождитесь отправленного ответа клиента')
    if item.document_required and not db.scalar(select(InfoAttachment.id).where(InfoAttachment.request_id==rid,InfoAttachment.detached_at.is_(None),InfoAttachment.message_id.is_not(None)).limit(1)):
        raise validation_error({'attachments':'Клиент ещё не отправил запрошенный документ'})
    now=utc_now();item.closed_at=now;item.closed_by=account.id;item.revision+=1
    event(db,application,account,'INFO_REQUEST_CLOSED',now,'UNDER_REVIEW')
    commit_operation(db,account,key,sig)
    return serialize_application(application,db,staff=True)


def validate_financial_values(values, application, db):
    """Text and files never alter figures; only these explicit rows may be accepted."""
    if not values:return []
    from decimal import Decimal, InvalidOperation
    import re
    from .models import ApplicationSubmission
    submission=db.get(ApplicationSubmission,application.id)
    from .verified_data import financial_rows
    months={row['month'] for row in financial_rows(submission.snapshot,submission.submitted_at)} if submission else set()
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
        if not re.fullmatch(r'\d{1,16}(?:\.\d{1,2})?',item.value_rub):raise validation_error({'financial_values':'Укажите неотрицательную сумму с точностью до копеек'})
        try:value=Decimal(item.value_rub)
        except InvalidOperation as exc:raise validation_error({'financial_values':'Укажите сумму с точностью до копеек'}) from exc
        if not value.is_finite() or value<0 or value>Decimal('9999999999999999.99') or value.as_tuple().exponent < -2:
            raise validation_error({'financial_values':'Укажите неотрицательную сумму до 9999999999999999.99 с точностью до копеек'})
        result.append({'kind':item.kind,'month':item.month,'value_rub':format(value.quantize(Decimal('0.01')),'.2f'),'source':item.source})
    return result



def add_message(app_id,rid,payload,account,db,key):
    application=accessible_application(db,app_id,account);item=request_for(db,application,rid)
    key,sig,replay=operation(db,account,key,'message',app_id,rid,payload.model_dump())
    if replay:return serialize_application(application,db,staff=account.role=='STAFF')
    require_open(application,item);value=text_value(payload.text,'text',1000);now=utc_now()
    db.add(InfoMessage(request_id=rid,actor_id=account.id,actor_role=account.role,text=value,created_at=now))
    if account.role=='CLIENT':item.reply_submitted_at=now;item.reply_by=account.id;item.revision+=1
    event(db,application,account,'INFO_MESSAGE',now)
    commit_operation(db,account,key,sig)
    return serialize_application(application,db,staff=account.role=='STAFF')


@router.post('/applications/{app_id}/info-requests/{rid}/messages')
def client_message(app_id:uuid.UUID,rid:uuid.UUID,payload:Message,account:ClientAccount,db:Session=Depends(get_db),key:str|None=Header(None,alias='Idempotency-Key')):
    return add_message(app_id,rid,payload,account,db,key)


@router.post('/staff/applications/{app_id}/info-requests/{rid}/messages')
def staff_message(app_id:uuid.UUID,rid:uuid.UUID,payload:Message,account:StaffAccount,db:Session=Depends(get_db),key:str|None=Header(None,alias='Idempotency-Key')):
    return add_message(app_id,rid,payload,account,db,key)
