"""Deterministic MVP assessment and staff decision. It is not a real credit model."""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from .access import StaffAccount
from .calculator import calculate_annuity, calculate_overdraft
from .db import get_db
from .info_common import accessible_application, commit_operation, event, operation, text_value
from .models import Application, ApplicationAssessment, ApplicationSubmission, InfoRequest, utc_now
from .problems import ApiProblem, validation_error
from .serialization import serialize_application

router = APIRouter(prefix='/api/v1')
SCORECARD_VERSION = 'demo-scorecard-v0-temporary'
MONEY = Decimal('0.01')


class DecisionPayload(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    version: Annotated[StrictInt, Field(gt=0)]
    decision: Literal['APPROVE', 'DECLINE']
    comment: StrictStr = ''


def money(value: Decimal) -> str:
    return format(value.quantize(MONEY, rounding=ROUND_HALF_UP), '.2f')


def accepted_financial_values(application_id: uuid.UUID, db: Session) -> list[dict[str, Any]]:
    return [value for item in db.scalars(select(InfoRequest).where(
        InfoRequest.application_id == application_id, InfoRequest.financial_accepted_at.is_not(None)
    )) for value in (item.financial_values or [])]


def assessment_facts(application: Application, submission: ApplicationSubmission, db: Session) -> dict[str, Any]:
    finance = submission.snapshot['company'].get('finance', {})
    months = [dict(row) for row in finance.get('months', [])]
    debt = finance.get('debt_payment_rub')
    by_month = {item['month']: item for item in months}
    for value in accepted_financial_values(application.id, db):
        if value['kind'] == 'debt_payment_rub':
            debt = value['value_rub']
        elif value.get('month') in by_month:
            row = by_month[value['month']]
            row[value['kind']] = value['value_rub']
            row[value['kind'].replace('_rub', '_source')] = value['source']
    return {'months': months, 'debt_payment_rub': debt}


def score(facts: dict[str, Any], details: dict[str, Any]) -> tuple[int | None, str, list[str], list[str]]:
    months, debt = facts['months'], facts['debt_payment_rub']
    missing: list[str] = []
    if len(months) != 6:
        missing.append('шесть месяцев финансовых данных')
    if any(row.get('income_rub') is None for row in months):
        missing.append('поступления за все шесть месяцев')
    if any(row.get('expenses_rub') is None for row in months):
        missing.append('операционные расходы за все шесть месяцев')
    if debt is None:
        missing.append('ежемесячные платежи по действующим долгам')
    if details.get('business_age_months') is None:
        missing.append('возраст бизнеса')
    if missing:
        return None, 'UNKNOWN', [], missing
    income = [Decimal(row['income_rub']) for row in months]
    expenses = [Decimal(row['expenses_rub']) for row in months]
    average_income = sum(income) / 6
    average_expenses = sum(expenses) / 6
    flow = average_income - average_expenses
    debt_value = Decimal(debt)
    reasons: list[str] = []
    age = details['business_age_months']
    age_points = 25 if age >= 36 else 18 if age >= 18 else 10
    reasons.append(f'Возраст бизнеса {age} мес.: +{age_points}')
    volatility = (max(income) - min(income)) / average_income if average_income else Decimal(1)
    stability_points = 25 if volatility <= Decimal('0.20') else 15 if volatility <= Decimal('0.35') else 5
    reasons.append(f'Стабильность поступлений: +{stability_points}')
    margin = flow / average_income if average_income else Decimal(0)
    margin_points = 25 if margin >= Decimal('0.30') else 15 if margin >= Decimal('0.15') else 5
    reasons.append(f'Операционный поток: +{margin_points}')
    debt_ratio = debt_value / flow if flow > 0 else Decimal('999')
    debt_points = 25 if debt_ratio <= Decimal('0.10') else 15 if debt_ratio <= Decimal('0.30') else 5
    reasons.append(f'Действующая долговая нагрузка: +{debt_points}')
    total = age_points + stability_points + margin_points + debt_points
    group = 'LOW' if total >= 80 else 'MEDIUM' if total >= 50 else 'HIGH'
    return total, group, reasons, []


def calculate_assessment(application: Application, db: Session, now: datetime | None = None) -> dict[str, Any]:
    submission = db.get(ApplicationSubmission, application.id)
    if submission is None:
        raise ApiProblem(409, 'NOT_SUBMITTED', 'Сначала отправьте заявку на рассмотрение')
    snapshot = submission.snapshot
    details = snapshot['company'].get('details') or {}
    facts = assessment_facts(application, submission, db)
    score_value, group, reasons, missing = score(facts, details)
    formal: list[str] = []
    decline: list[str] = []
    if details.get('registry_source') != 'FNS_MOCK' or not details.get('tax_id') or not details.get('okved'):
        missing.append('сведения ИНН и ОКВЭД из имитации ФНС')
    if details.get('registration_status') != 'ACTIVE':
        decline.append('В имитации ФНС статус регистрации не «Действует»')
    if details.get('is_bank_client') is not True:
        decline.append('Компания не подтверждена как действующий клиент банка')
    if (details.get('business_age_months') or 0) < 9:
        decline.append('Возраст бизнеса меньше 9 полных месяцев')
    app = snapshot['application']
    try:
        if app['product_code'] in {'working_capital', 'equipment'}:
            calc = calculate_annuity(app['product_code'], Decimal(app['amount_rub']), app['term_months'])
            if app['product_code'] == 'equipment' and Decimal(app.get('equipment_cost_rub') or '0') < Decimal(app['amount_rub']):
                decline.append('Сумма кредита превышает стоимость оборудования')
            if not missing:
                income = sum(Decimal(row['income_rub']) for row in facts['months']) / 6
                expenses = sum(Decimal(row['expenses_rub']) for row in facts['months']) / 6
                limit = max(Decimal(0), Decimal('0.50') * max(income - expenses, Decimal(0)) - Decimal(facts['debt_payment_rub']))
                if Decimal(calc['monthly_payment_rub']) > limit:
                    decline.append('Новый ежемесячный платёж превышает допустимую нагрузку')
                formal.append(f'Допустимый новый платёж: {money(limit)} ₽')
        else:
            calc = calculate_overdraft(Decimal(app['amount_rub']), Decimal(app['planned_payment_rub']), app['usage_days'],
                                       datetime.fromisoformat(app['planned_payment_date']).date(),
                                       datetime.fromisoformat(app['expected_inflow_date']).date(), Decimal(app['expected_inflow_amount_rub']))
            if not missing:
                income = sum(Decimal(row['income_rub']) for row in facts['months']) / 6
                expenses = sum(Decimal(row['expenses_rub']) for row in facts['months']) / 6
                if Decimal(app['amount_rub']) > min(Decimal('2000000'), Decimal('0.30') * income):
                    decline.append('Лимит превышает 30% средних поступлений')
                if income - expenses - Decimal(facts['debt_payment_rub']) <= 0:
                    decline.append('После долгов операционный поток не положительный')
                formal.append(f'Оценка процентов: {calc["interest_rub"]} ₽')
    except (KeyError, TypeError, ValueError):
        missing.append('полные параметры заявки')
    if missing:
        recommendation = 'REQUEST_INFO'
        reasons.extend(f'Нужно уточнить: {value}' for value in missing)
    elif decline or group == 'HIGH':
        recommendation = 'RECOMMEND_DECLINE'
        reasons.extend(decline)
        if group == 'HIGH': reasons.append('Высокая группа риска по демонстрационному скорингу')
    else:
        recommendation = 'OFFER_REQUESTED'
        if group == 'MEDIUM': reasons.append('Средняя группа риска: сотрудник должен указать причину ручного решения')
    result = {'model_version': SCORECARD_VERSION, 'score': score_value, 'group': group,
              'recommendation': recommendation, 'reasons': reasons, 'missing': missing, 'formal_checks': formal,
              'calculated_at': (now or utc_now()).isoformat().replace('+00:00', 'Z')}
    stored = db.get(ApplicationAssessment, application.id)
    if stored is None:
        db.add(ApplicationAssessment(application_id=application.id, financial_facts=facts, result=result, calculated_at=now or utc_now()))
    else:
        stored.financial_facts, stored.result, stored.calculated_at = facts, result, now or utc_now()
    return result


@router.post('/staff/applications/{application_id}/assessment')
def refresh_assessment(application_id: uuid.UUID, account: StaffAccount, db: Session = Depends(get_db)):
    application = accessible_application(db, application_id, account)
    if application.status not in {'UNDER_REVIEW', 'NEEDS_INFO'}:
        raise ApiProblem(409, 'INVALID_STATE', 'Оценить можно только заявку на рассмотрении')
    result = calculate_assessment(application, db)
    db.commit()
    return result


@router.post('/staff/applications/{application_id}/decision')
def decide(application_id: uuid.UUID, payload: DecisionPayload, account: StaffAccount, db: Session = Depends(get_db),
           key: str | None = Header(default=None, alias='Idempotency-Key')):
    application = accessible_application(db, application_id, account)
    operation_key, signature, replay = operation(db, account, key, 'decision', application_id, None, payload.model_dump())
    if replay:
        return serialize_application(application, db)
    if application.status != 'UNDER_REVIEW':
        raise ApiProblem(409, 'INVALID_STATE', 'Итоговое решение доступно только при рассмотрении')
    if application.version != payload.version:
        raise ApiProblem(409, 'VERSION_CONFLICT', 'Заявка изменилась. Обновите карточку.')
    assessment = calculate_assessment(application, db)
    comment = text_value(payload.comment, 'comment', 1000, payload.decision == 'DECLINE' or assessment['group'] == 'MEDIUM')
    if payload.decision == 'APPROVE' and assessment['recommendation'] != 'OFFER_REQUESTED':
        raise validation_error({'decision': 'Одобрение недоступно: сначала устраните причины в оценке или запросите сведения'})
    now = utc_now()
    event(db, application, account, 'STAFF_APPROVED' if payload.decision == 'APPROVE' else 'STAFF_DECLINED', now,
          'APPROVED' if payload.decision == 'APPROVE' else 'DECLINED', comment)
    commit_operation(db, account, operation_key, signature)
    return serialize_application(application, db)
