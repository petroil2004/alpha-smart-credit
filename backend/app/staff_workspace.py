"""Demo employee profile and auditable manual facts after a client's reply."""
import uuid
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr
from sqlalchemy.orm import Session
from .access import StaffAccount
from .db import get_db
from .info_common import accessible_application, request_for, check_version, text_value, operation, event, commit_operation
from .info_requests import FinancialValue, validate_financial_values
from .models import StaffFinancialCorrection, utc_now
from .problems import ApiProblem
from .review import calculate_assessment
from .serialization import serialize_application

router = APIRouter(prefix='/api/v1/staff')


@router.get('/profile')
def profile(account: StaffAccount):
    return {'account_id':account.id,'full_name':'Иванов Иван Иванович','position':'Кредитный аналитик',
            'department':'Кредитование малого бизнеса','city':'Москва','source':'DEMO'}


class ManualValue(BaseModel):
    model_config = ConfigDict(extra='forbid',strict=True)
    kind: Literal['income_rub','expenses_rub','debt_payment_rub']
    month: StrictStr | None = None
    value_rub: StrictStr


class Correction(BaseModel):
    model_config = ConfigDict(extra='forbid',strict=True)
    version: Annotated[StrictInt,Field(gt=0)]
    reason: StrictStr
    values: Annotated[list[ManualValue],Field(min_length=1,max_length=13)]


@router.post('/applications/{app_id}/info-requests/{rid}/financial-corrections')
def correct(app_id:uuid.UUID,rid:uuid.UUID,payload:Correction,account:StaffAccount,
            db:Session=Depends(get_db),key:str|None=Header(None,alias='Idempotency-Key')):
    application=accessible_application(db,app_id,account)
    request=request_for(db,application,rid)
    key,signature,replay=operation(db,account,key,'staff-financial-correction',app_id,rid,payload.model_dump())
    if replay:return serialize_application(application,db)
    if application.status!='UNDER_REVIEW' or request.closed_at is None:
        raise ApiProblem(409,'INVALID_STATE','Ручные значения можно внести после отправки ответа клиентом, пока заявка на рассмотрении')
    check_version(application.version,payload.version)
    reason=text_value(payload.reason,'reason',1000)
    values=validate_financial_values([FinancialValue(**value.model_dump(),source='CLIENT_DOCUMENT') for value in payload.values],application,db)
    values=[{**value,'source':'STAFF_VERIFIED'} for value in values]
    now=utc_now()
    db.add(StaffFinancialCorrection(application_id=application.id,request_id=request.id,actor_id=account.id,recorded_at=now,reason=reason,values=values))
    application.version+=1;application.updated_at=now;request.revision+=1
    db.flush()
    calculate_assessment(application,db,now)
    event(db,application,account,'STAFF_FINANCIAL_CORRECTED',now,None,reason)
    commit_operation(db,account,key,signature)
    return serialize_application(application,db)
