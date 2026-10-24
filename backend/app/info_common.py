"""Authorisation, locking and durable replay shared by clarification actions."""
import uuid
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from .models import Application, ApplicationSubmission, ApplicationEvent, InfoRequest, InfoOperation
from .problems import ApiProblem, validation_error


def accessible_application(db, app_id, account, lock=True):
    query=select(Application).join(ApplicationSubmission).where(Application.id==app_id)
    if account.role=='CLIENT':query=query.where(Application.company_id==account.company_id)
    if lock:query=query.with_for_update(of=Application)
    item=db.scalar(query)
    if item is None:raise ApiProblem(404,'NOT_FOUND','Заявка не найдена')
    return item


def request_for(db, application, rid):
    item=db.scalar(select(InfoRequest).where(InfoRequest.id==rid,InfoRequest.application_id==application.id))
    if item is None:raise ApiProblem(404,'NOT_FOUND','Запрос не найден')
    return item


def require_open(application,item):
    if application.status!='NEEDS_INFO' or item.closed_at is not None:
        raise ApiProblem(409,'REQUEST_CLOSED','Запрос уже завершён. Обновите карточку.')


def check_version(actual,expected):
    if actual!=expected:raise ApiProblem(409,'VERSION_CONFLICT','Сведения изменились. Обновите сохранённую версию.')


def text_value(value,field,limit,required=True):
    if len(value)>limit or (required and not value.strip()):
        raise validation_error({field:f'Укажите текст до {limit} символов' if required else f'Не более {limit} символов'})
    return value.strip() if required else value


def operation(db,account,key,action,app_id,rid,body):
    try:key=str(uuid.UUID(key or ''))
    except ValueError as exc:raise validation_error({'Idempotency-Key':'Укажите UUID-ключ операции'}) from exc
    signature={'action':action,'application_id':str(app_id),'request_id':str(rid) if rid else None,'body':body}
    existing=db.get(InfoOperation,(account.id,key))
    if existing and existing.signature!=signature:raise ApiProblem(409,'IDEMPOTENCY_CONFLICT','Ключ уже использован для другой операции')
    return key,signature,existing is not None


def commit_operation(db,account,key,signature):
    db.add(InfoOperation(actor_id=account.id,key=key,signature=signature))
    try:db.commit()
    except IntegrityError:
        db.rollback()
        existing=db.get(InfoOperation,(account.id,key))
        if not existing:raise
        if existing.signature!=signature:raise ApiProblem(409,'IDEMPOTENCY_CONFLICT','Ключ уже использован для другой операции')


def event(db,application,account,reason,now,to_status=None,comment=None):
    submission=db.get(ApplicationSubmission,application.id)
    previous=application.status
    if to_status:
        application.status=to_status;application.version+=1;application.updated_at=now
    db.add(ApplicationEvent(application_id=application.id,actor_id=account.id,actor_role=account.role,
                            occurred_at=now,from_status=previous,to_status=application.status,reason_code=reason,
                            comment=comment,catalog_version=submission.snapshot['calculation']['catalog_version']))
