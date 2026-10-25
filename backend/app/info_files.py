"""Bounded binary uploads stored transactionally alongside clarification requests."""
import hashlib
import unicodedata
import uuid
from urllib.parse import quote
from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from .access import ClientAccount, StaffAccount
from .db import get_db
from .models import InfoAttachment, utc_now
from .info_common import accessible_application, request_for, require_open, check_version, event
from .info_requests import Payload, Positive
from .problems import ApiProblem, validation_error
from .serialization import serialize_application

router=APIRouter(prefix='/api/v1')
MAX_BYTES=5_000_000


class Detach(Payload):
    revision:Positive


def file_values(filename,content_type,content):
    name=unicodedata.normalize('NFC',filename).strip()
    if not name or len(name)>128 or any(unicodedata.category(c).startswith('C') or c in '/\\:"<>|?*' for c in name):
        raise validation_error({'filename':'Укажите имя файла без пути, до 128 символов'})
    kind=content_type.split(';')[0].strip().lower()
    extension=name.rsplit('.',1)[-1].lower()
    signatures={('application/pdf','pdf'):b'%PDF-',('image/png','png'):b'\x89PNG\r\n\x1a\n',('image/jpeg','jpg'):b'\xff\xd8\xff',('image/jpeg','jpeg'):b'\xff\xd8\xff'}
    signature=signatures.get((kind,extension))
    if not content or signature is None or not content.startswith(signature):
        raise ApiProblem(415,'FILE_FORMAT','Выберите PDF, PNG или JPG с соответствующим содержимым')
    return name,kind,hashlib.sha256(content).hexdigest()


def preflight(db,app_id,rid,account):
    application=accessible_application(db,app_id,account,lock=False)
    request_for(db,application,rid)
    # Do not retain a database transaction while the browser sends file bytes.
    db.rollback()


def store_file(db,app_id,rid,fid,account,revision,filename,kind,digest,content):
    application=accessible_application(db,app_id,account);item=request_for(db,application,rid)
    existing=db.get(InfoAttachment,fid)
    if existing:
        if existing.request_id!=rid or existing.actor_id!=account.id or (existing.filename,existing.content_type,existing.sha256)!=(filename,kind,digest):
            raise ApiProblem(409,'FILE_KEY_CONFLICT','Ключ файла уже использован для другого вложения')
        if existing.detached_at:raise ApiProblem(410,'FILE_DETACHED','Файл откреплён. Для новой загрузки выберите файл снова.')
        return serialize_application(application,db)
    require_open(application,item);check_version(item.revision,revision)
    count=db.scalar(select(func.count()).select_from(InfoAttachment).where(InfoAttachment.request_id==rid,InfoAttachment.detached_at.is_(None)))
    if count>=5:raise validation_error({'attachments':'Допускается до пяти файлов. Открепите лишний.'})
    now=utc_now()
    db.add(InfoAttachment(id=fid,request_id=rid,actor_id=account.id,filename=filename,content_type=kind,
                          size_bytes=len(content),sha256=digest,content=content,created_at=now))
    item.revision+=1
    event(db,application,account,'INFO_FILE_ATTACHED',now,comment=filename)
    # The global file UUID also prevents its reuse across two application locks.
    from sqlalchemy.exc import IntegrityError
    try:db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ApiProblem(409,'FILE_KEY_CONFLICT','Ключ файла уже использован. Обновите карточку.') from exc
    return serialize_application(application,db)


@router.put('/applications/{app_id}/info-requests/{rid}/attachments/{fid}')
async def upload(app_id:uuid.UUID,rid:uuid.UUID,fid:uuid.UUID,request:Request,account:ClientAccount,
                 filename:str=Query(...),revision:int=Query(...,gt=0),db:Session=Depends(get_db)):
    await run_in_threadpool(preflight,db,app_id,rid,account)
    data=bytearray()
    async for chunk in request.stream():
        if len(data)+len(chunk)>MAX_BYTES:raise ApiProblem(413,'FILE_TOO_LARGE','Размер файла — не более 5 МБ')
        data.extend(chunk)
    content=bytes(data)
    name,kind,digest=file_values(filename,request.headers.get('content-type',''),content)
    return await run_in_threadpool(store_file,db,app_id,rid,fid,account,revision,name,kind,digest,content)


def attachment_for(db,rid,fid):
    item=db.scalar(select(InfoAttachment).where(InfoAttachment.id==fid,InfoAttachment.request_id==rid,InfoAttachment.detached_at.is_(None)))
    if item is None:raise ApiProblem(404,'NOT_FOUND','Файл не найден')
    return item


@router.post('/applications/{app_id}/info-requests/{rid}/attachments/{fid}/detach')
def detach(app_id:uuid.UUID,rid:uuid.UUID,fid:uuid.UUID,payload:Detach,account:ClientAccount,db:Session=Depends(get_db)):
    application=accessible_application(db,app_id,account);item=request_for(db,application,rid)
    attachment=db.get(InfoAttachment,fid)
    if attachment is None or attachment.request_id!=rid:raise ApiProblem(404,'NOT_FOUND','Файл не найден')
    if attachment.detached_at:return serialize_application(application,db)
    require_open(application,item)
    if attachment.message_id is not None:raise ApiProblem(409,'FILE_SENT','Отправленный документ нельзя открепить')
    check_version(item.revision,payload.revision)
    now=utc_now();attachment.detached_at=now;item.revision+=1
    event(db,application,account,'INFO_FILE_DETACHED',now,comment=attachment.filename)
    db.commit()
    return serialize_application(application,db)


def download_file(db,app_id,rid,fid,account):
    application=accessible_application(db,app_id,account,lock=False);clarification=request_for(db,application,rid)
    item=attachment_for(db,rid,fid)
    if account.role=='STAFF' and item.message_id is None and (clarification.closed_at is None or clarification.reply_submitted_at is not None):
        raise ApiProblem(404,'NOT_FOUND','Файл не найден')
    return Response(content=item.content,media_type=item.content_type,headers={
        'Content-Disposition':"attachment; filename*=UTF-8''"+quote(item.filename,safe=''),
        'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'})


@router.get('/applications/{app_id}/info-requests/{rid}/attachments/{fid}')
def client_download(app_id:uuid.UUID,rid:uuid.UUID,fid:uuid.UUID,account:ClientAccount,db:Session=Depends(get_db)):
    return download_file(db,app_id,rid,fid,account)


@router.get('/staff/applications/{app_id}/info-requests/{rid}/attachments/{fid}')
def staff_download(app_id:uuid.UUID,rid:uuid.UUID,fid:uuid.UUID,account:StaffAccount,db:Session=Depends(get_db)):
    return download_file(db,app_id,rid,fid,account)
