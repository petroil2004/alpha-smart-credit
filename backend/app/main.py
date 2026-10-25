from __future__ import annotations

import re
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import date, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any, Literal

from fastapi import Body, Depends, FastAPI, Header, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, StrictInt, StrictStr
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .db import Base, engine, get_db
from .models import Account, Application, ApplicationCreation, UserSession, utc_now
from .settings import settings
from .problems import ApiProblem, validation_error
from .access import CurrentAccount, ClientAccount
from .company_profile import get_company_profile
from .serialization import serialize_application
from .calculator import CalculationValidationError, calculate_annuity
from .product_catalog import get_catalog

API_PREFIX = "/api/v1"
MONEY_PATTERN = re.compile(r"^\d+(?:\.\d{1,2})?$")
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# Storage capacity of Numeric(18, 2) and PostgreSQL Integer, not credit policy.
MAX_STORED_MONEY = Decimal("9999999999999999.99")
MAX_STORED_INTEGER = 2147483647
EDITABLE_FIELDS = {
    "purpose",
    "product_code",
    "amount_rub",
    "term_months",
    "usage_days",
    "expected_inflow_date",
    "expected_inflow_amount_rub",
    "equipment_cost_rub",
    "planned_payment_rub",
    "planned_payment_date",
    "expected_inflow_source",
}


class LoginPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    account_id: StrictStr


class AnnuityPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    product_code: Literal["working_capital", "equipment"]
    amount_rub: StrictStr
    term_months: StrictInt


class PatchPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    version: StrictInt
    purpose: StrictStr | None = None
    product_code: Literal["working_capital", "equipment", "overdraft"] | None = None
    amount_rub: StrictStr | None = None
    term_months: StrictInt | None = None
    usage_days: StrictInt | None = None
    expected_inflow_date: StrictStr | None = None
    expected_inflow_amount_rub: StrictStr | None = None
    equipment_cost_rub: StrictStr | None = None
    planned_payment_rub: StrictStr | None = None
    planned_payment_date: StrictStr | None = None
    expected_inflow_source: Literal["BUYER", "CONTRACT", "REGULAR_REVENUE", "OTHER"] | None = None


def problem_response(problem: ApiProblem) -> JSONResponse:
    error: dict[str, Any] = {"code": problem.code, "message": problem.message}
    if problem.fields:
        error["fields"] = problem.fields
    return JSONResponse(status_code=problem.status_code, content={"error": error})


def request_validation_fields(error: RequestValidationError) -> dict[str, str]:
    fields: dict[str, str] = {}
    for item in error.errors():
        location = item.get("loc", ())
        field = str(location[-1]) if location else "request"
        if field == "__root__":
            field = "request"
        fields[field] = "Некорректное значение"
    return fields


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    from .schema_compat import allow_deleted_creation_receipts, allow_staff_accounts, add_mvp_review_columns

    allow_deleted_creation_receipts(engine)
    allow_staff_accounts(engine)
    add_mvp_review_columns(engine)
    from .seed import ensure_demo_accounts

    ensure_demo_accounts()
    yield


app = FastAPI(title="Alpha Smart Credit API", version="0.1.0", lifespan=lifespan)


@app.exception_handler(ApiProblem)
async def handle_api_problem(_: Request, exc: ApiProblem):
    return problem_response(exc)


@app.exception_handler(RequestValidationError)
async def handle_request_validation(_: Request, exc: RequestValidationError):
    return problem_response(
        ApiProblem(422, "VALIDATION_ERROR", "Проверьте заполнение полей", request_validation_fields(exc))
    )


@app.exception_handler(Exception)
async def handle_unexpected_error(_: Request, __: Exception):
    return problem_response(ApiProblem(500, "SERVER_ERROR", "Сервис временно недоступен. Попробуйте ещё раз."))


def serialize_session(account: Account) -> dict[str, Any]:
    return {
        "user": {"id": account.id, "name": account.name, "role": account.role},
        "company": {"id": account.company_id, "name": account.company_name} if account.role == "CLIENT" else None,
    }


def parse_money(value: str, field: str) -> Decimal:
    if not MONEY_PATTERN.fullmatch(value):
        raise validation_error({field: "Укажите положительную сумму с точностью до копеек"})
    try:
        amount = Decimal(value)
    except InvalidOperation as exc:
        raise validation_error({field: "Укажите положительную сумму"}) from exc
    if amount <= 0:
        raise validation_error({field: "Укажите положительную сумму"})
    if amount > MAX_STORED_MONEY:
        raise validation_error({field: "Сумма слишком велика для сохранения. Укажите меньшее значение"})
    return amount.quantize(Decimal("0.01"))


def parse_date(value: str) -> date:
    if not DATE_PATTERN.fullmatch(value):
        raise validation_error({"expected_inflow_date": "Укажите дату в формате YYYY-MM-DD"})
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise validation_error({"expected_inflow_date": "Укажите корректную дату"}) from exc


def validate_final_values(values: dict[str, Any]) -> None:
    fields: dict[str, str] = {}
    product = values["product_code"]
    if product is None:
        for field in ("term_months", "usage_days", "expected_inflow_date", "expected_inflow_amount_rub", "equipment_cost_rub", "planned_payment_rub", "planned_payment_date", "expected_inflow_source"):
            if values[field] is not None:
                fields[field] = "Поле доступно после выбора подходящего продукта"
    elif product in {"working_capital", "equipment"}:
        for field in ("usage_days", "expected_inflow_date", "expected_inflow_amount_rub", "planned_payment_rub", "planned_payment_date", "expected_inflow_source"):
            if values[field] is not None:
                fields[field] = "Поле применимо только к овердрафту"
    elif product == "overdraft" and values["term_months"] is not None:
        fields["term_months"] = "Срок в месяцах неприменим к овердрафту"
    if product != "equipment" and values["equipment_cost_rub"] is not None:
        fields["equipment_cost_rub"] = "Поле применимо только к кредиту на оборудование"
    if fields:
        raise validation_error(fields)


def application_for_account(
    application_id: uuid.UUID, account: Account, db: Session, *, lock: bool = False
) -> Application:
    query = select(Application).where(
        Application.id == application_id, Application.company_id == account.company_id
    )
    if lock:
        query = query.with_for_update()
    application = db.scalar(query)
    if not application:
        raise ApiProblem(404, "NOT_FOUND", "Заявка не найдена")
    return application


@app.get(f"{API_PREFIX}/health")
@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post(f"{API_PREFIX}/auth/demo-login")
def demo_login(payload: LoginPayload, response: Response, db: Session = Depends(get_db)) -> dict[str, Any]:
    account = db.get(Account, payload.account_id)
    if not account or account.role not in {"CLIENT", "STAFF"} or (account.role == "CLIENT" and not account.company_id):
        raise validation_error({"account_id": "Неизвестный демонстрационный аккаунт"})

    session_id = secrets.token_urlsafe(32)
    db.add(
        UserSession(
            id=session_id,
            account_id=account.id,
            expires_at=utc_now() + timedelta(seconds=settings.session_ttl_seconds),
        )
    )
    db.commit()
    response.set_cookie(
        key=settings.cookie_name,
        value=session_id,
        max_age=settings.session_ttl_seconds,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )
    return serialize_session(account)


@app.get(f"{API_PREFIX}/me")
def me(account: CurrentAccount) -> dict[str, Any]:
    return serialize_session(account)


@app.get(f"{API_PREFIX}/products")
def products(account: ClientAccount) -> dict[str, Any]:
    return get_catalog()


@app.post(f"{API_PREFIX}/calculations/annuity")
def annuity(payload: AnnuityPayload, account: ClientAccount) -> dict[str, Any]:
    amount = parse_money(payload.amount_rub, "amount_rub")
    try:
        return calculate_annuity(payload.product_code, amount, payload.term_months)
    except CalculationValidationError as error:
        raise validation_error(error.fields) from error


@app.post(f"{API_PREFIX}/auth/logout", status_code=204)
def logout(request: Request, db: Session = Depends(get_db)) -> Response:
    session_id = request.cookies.get(settings.cookie_name)
    if session_id:
        user_session = db.get(UserSession, session_id)
        if user_session:
            db.delete(user_session)
            db.commit()
    response = Response(status_code=204)
    response.delete_cookie(settings.cookie_name, path="/")
    return response


@app.get(f"{API_PREFIX}/applications")
def list_applications(account: ClientAccount, db: Session = Depends(get_db)) -> dict[str, list[dict[str, Any]]]:
    applications = db.scalars(
        select(Application)
        .where(Application.company_id == account.company_id)
        .order_by(Application.updated_at.desc(), Application.id.desc())
    ).all()
    return {"items": [serialize_application(application, db, detail=False) for application in applications]}


def creation_replay(receipt: ApplicationCreation, db: Session):
    application = db.get(Application, receipt.application_id) if receipt.application_id else None
    if application is None:
        raise ApiProblem(410, "APPLICATION_DELETED", "Этот черновик удалён. Создайте новую заявку.")
    return JSONResponse(status_code=200, content=serialize_application(application, db))


@app.post(f"{API_PREFIX}/applications")
def create_application(
    account: ClientAccount,
    db: Session = Depends(get_db),
    body: Any = Body(...),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    if body != {}:
        raise validation_error({"request": "Для создания черновика передайте пустой объект"})
    try:
        key = str(uuid.UUID(idempotency_key or ""))
    except ValueError as exc:
        raise validation_error({"Idempotency-Key": "Укажите UUID-ключ повторного запроса"}) from exc

    existing = db.scalar(
        select(ApplicationCreation).where(
            ApplicationCreation.account_id == account.id,
            ApplicationCreation.idempotency_key == key,
        )
    )
    if existing:
        return creation_replay(existing, db)

    application = Application(company_id=account.company_id)
    db.add(application)
    db.flush()
    db.add(ApplicationCreation(account_id=account.id, idempotency_key=key, application_id=application.id))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(
            select(ApplicationCreation).where(
                ApplicationCreation.account_id == account.id,
                ApplicationCreation.idempotency_key == key,
            )
        )
        if not existing:
            raise
        return creation_replay(existing, db)
    return JSONResponse(status_code=201, content=serialize_application(application, db))


@app.get(f"{API_PREFIX}/applications/{{application_id}}")
def get_application(application_id: uuid.UUID, account: ClientAccount, db: Session = Depends(get_db)):
    return serialize_application(application_for_account(application_id, account, db), db)


@app.patch(f"{API_PREFIX}/applications/{{application_id}}")
def update_application(
    application_id: uuid.UUID,
    payload: PatchPayload,
    account: ClientAccount,
    db: Session = Depends(get_db),
):
    application = application_for_account(application_id, account, db, lock=True)
    if application.status != "DRAFT":
        raise validation_error({"status": "Редактировать можно только черновик"})
    if payload.version != application.version:
        raise ApiProblem(409, "VERSION_CONFLICT", "Черновик изменился. Загрузите сохранённую версию")

    updates = payload.model_dump(exclude_unset=True)
    updates.pop("version")
    values = {field: getattr(application, field) for field in EDITABLE_FIELDS}
    for field, value in updates.items():
        if field == "purpose" and value is not None:
            value = value.strip() or None
            if value is not None and len(value) > 500:
                raise validation_error({"purpose": "Текст не должен быть длиннее 500 символов"})
        elif field in {"amount_rub", "expected_inflow_amount_rub", "equipment_cost_rub", "planned_payment_rub"} and value is not None:
            value = parse_money(value, field)
        elif field in {"term_months", "usage_days"} and value is not None:
            if not 0 < value <= MAX_STORED_INTEGER:
                raise validation_error({field: "Укажите положительное целое число не больше 2147483647"})
        elif field in {"expected_inflow_date", "planned_payment_date"} and value is not None:
            value = parse_date(value)
        values[field] = value

    validate_final_values(values)
    for field, value in values.items():
        setattr(application, field, value)
    application.version += 1
    application.updated_at = utc_now()
    db.commit()
    return serialize_application(application, db)


@app.delete(f"{API_PREFIX}/applications/{{application_id}}", status_code=204)
def delete_application(
    application_id: uuid.UUID,
    version: Annotated[int, Query(gt=0)],
    account: ClientAccount,
    db: Session = Depends(get_db),
):
    application = application_for_account(application_id, account, db, lock=True)
    if application.status != "DRAFT":
        raise ApiProblem(409, "APPLICATION_NOT_DRAFT", "Удалить можно только неотправленный черновик.")
    if version != application.version:
        raise ApiProblem(409, "VERSION_CONFLICT", "Заявка изменена в другом окне. Обновите список перед удалением.")
    # Retain creation keys so a late POST cannot recreate a deleted draft.
    db.execute(update(ApplicationCreation).where(
        ApplicationCreation.application_id == application.id
    ).values(application_id=None))
    db.delete(application)
    db.commit()
    return Response(status_code=204)


@app.get(f"{API_PREFIX}/company-profile")
def company_profile(account: ClientAccount, db: Session = Depends(get_db)):
    return get_company_profile(account, db)


from .submissions import router as submissions_router
app.include_router(submissions_router)

from .info_requests import router as info_router
app.include_router(info_router)

from .info_files import router as info_files_router
app.include_router(info_files_router)

from .review import router as review_router
app.include_router(review_router)

from .assistant import router as assistant_router
app.include_router(assistant_router)

from .notifications import router as notifications_router
app.include_router(notifications_router)
