"""Demo employee profile and auditable manual facts after a client's reply."""
import uuid
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, StrictBool
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
    if replay:return serialize_application(application,db,staff=account.role=='STAFF')
    if application.status not in {'UNDER_REVIEW','NEEDS_INFO'} or not (request.reply_submitted_at or request.closed_at):
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
    return serialize_application(application,db,staff=account.role=='STAFF')


class ProfileChanges(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    legal_form: Literal['OOO','IP'] | None = None
    tax_id: StrictStr | None = None
    okved: StrictStr | None = None
    registration_date: StrictStr | None = None
    registration_status: Literal['ACTIVE','TERMINATED'] | None = None
    is_bank_client: StrictBool | None = None


class ProfileCorrection(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)
    version: Annotated[StrictInt,Field(gt=0)]
    reason: StrictStr
    details: ProfileChanges


@router.post('/applications/{app_id}/info-requests/{rid}/profile-corrections')
def correct_profile(app_id:uuid.UUID,rid:uuid.UUID,payload:ProfileCorrection,account:StaffAccount,db:Session=Depends(get_db),key:str|None=Header(None,alias='Idempotency-Key')):
    from datetime import date
    import re
    from .models import ApplicationSubmission, StaffProfileCorrection
    from .verified_data import effective_company
    from .profile_period import MOSCOW
    from .problems import validation_error
    application=accessible_application(db,app_id,account);request=request_for(db,application,rid)
    key,signature,replay=operation(db,account,key,'staff-profile-correction',app_id,rid,payload.model_dump())
    if replay:return serialize_application(application,db,staff=True)
    if application.status not in {'UNDER_REVIEW','NEEDS_INFO'} or not (request.reply_submitted_at or request.closed_at):
        raise ApiProblem(409,'INVALID_STATE','Корректировка доступна после отправленного ответа клиента, до итогового решения')
    check_version(application.version,payload.version)
    reason=text_value(payload.reason,'reason',1000)
    patch=payload.details.model_dump(exclude_unset=True)
    if not patch or any(value is None for value in patch.values()):raise validation_error({'details':'Укажите изменённые значения профиля'})
    submission=db.get(ApplicationSubmission,app_id);company=effective_company(application,submission,db)
    merged={**company['details'],**patch};errors={}
    if 'tax_id' in patch or 'legal_form' in patch:
        expected=12 if merged.get('legal_form')=='IP' else 10
        if not merged.get('legal_form') or not re.fullmatch(r'\d{'+str(expected)+r'}',merged.get('tax_id') or ''):errors['tax_id']=f'ИНН должен содержать {expected} цифр и соответствовать организационной форме'
    if 'okved' in patch and not re.fullmatch(r'\d{2}(?:\.\d{1,2}){0,2}',patch['okved']):errors['okved']='Укажите ОКВЭД, например 47.11'
    if 'registration_date' in patch:
        as_of=date.fromisoformat(company['as_of_date']) if company.get('as_of_date') else submission.submitted_at.astimezone(MOSCOW).date()
        try:
            registered=date.fromisoformat(patch['registration_date'])
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',patch['registration_date']) or registered>as_of:raise ValueError()
        except ValueError:errors['registration_date']='Дата регистрации должна быть корректной и не позже даты сведений заявки'
    if errors:raise validation_error(errors)
    if all(company['details'].get(field)==value for field,value in patch.items()):raise validation_error({'details':'Измените хотя бы одно поле'})
    now=utc_now();db.add(StaffProfileCorrection(application_id=app_id,request_id=rid,actor_id=account.id,recorded_at=now,reason=reason,details=patch))
    application.version+=1;request.revision+=1
    db.flush();calculate_assessment(application,db,now)
    event(db,application,account,'STAFF_PROFILE_CORRECTED',now,None,reason)
    commit_operation(db,account,key,signature)
    return serialize_application(application,db,staff=True)
