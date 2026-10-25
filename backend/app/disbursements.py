"""Explicit client consent and exactly one simulated funding record per approved loan."""
import uuid
from typing import Annotated
from decimal import Decimal
from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt
from sqlalchemy.orm import Session
from .access import ClientAccount
from .db import get_db
from .info_common import accessible_application, operation, event, commit_operation
from .models import ApplicationDisbursement, ApplicationSubmission, utc_now
from .problems import ApiProblem
from .serialization import serialize_application

router = APIRouter(prefix='/api/v1/applications')


class Consent(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    version: Annotated[StrictInt, Field(gt=0)]
    confirmed: StrictBool


@router.post('/{application_id}/disbursement')
def disburse(application_id: uuid.UUID, payload: Consent, account: ClientAccount,
             db: Session = Depends(get_db), key: str | None = Header(None, alias='Idempotency-Key')):
    application = accessible_application(db, application_id, account)
    operation_key, signature, replay = operation(db, account, key, 'disbursement', application_id, None, payload.model_dump())
    if not payload.confirmed:
        raise ApiProblem(422, 'CONSENT_REQUIRED', 'Подтвердите одобренные параметры и демонстрационное получение средств')
    if replay or (application.status == 'ISSUED' and db.get(ApplicationDisbursement, application.id)):
        return serialize_application(application, db)
    if application.status != 'APPROVED':
        raise ApiProblem(409, 'INVALID_STATE', 'Получение средств доступно только после одобрения')
    if application.version != payload.version:
        raise ApiProblem(409, 'VERSION_CONFLICT', 'Заявка изменилась. Обновите карточку и подтвердите условия заново.')
    snapshot = db.get(ApplicationSubmission, application.id).snapshot['application']
    now = utc_now()
    db.add(ApplicationDisbursement(application_id=application.id, actor_id=account.id, confirmed_at=now,
                                  amount_rub=Decimal(snapshot['amount_rub']),
                                  kind='OVERDRAFT_LIMIT' if snapshot['product_code']=='overdraft' else 'CREDITED'))
    event(db, application, account, 'DEMO_DISBURSED', now, 'ISSUED', 'Клиент подтвердил демонстрационное получение финансирования. Реальные деньги не переводились.')
    commit_operation(db, account, operation_key, signature)
    return serialize_application(application, db)
