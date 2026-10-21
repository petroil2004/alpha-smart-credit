from __future__ import annotations

import re
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import date, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Annotated, Any, Literal

from fastapi import Body, Depends, FastAPI, Header, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, StrictInt, StrictStr
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .db import Base, engine, get_db
from .models import Account, Application, ApplicationCreation, UserSession, utc_now
from .settings import settings

API_PREFIX = "/api/v1"
MONEY_PATTERN = re.compile(r"^\d+(?:\.\d{1,2})?$")
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
EDITABLE_FIELDS = {
    "purpose",
    "product_code",
    "amount_rub",
    "term_months",
    "usage_days",
    "expected_inflow_date",
    "expected_inflow_amount_rub",
}


class ApiProblem(Exception):
    def __init__(self, status_code: int, code: str, message: str, fields: dict[str, str] | None = None):
        self.status_code = status_code
        self.code = code
        self.message = message
        self.fields = fields or {}


class LoginPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    account_id: StrictStr


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
        "company": {"id": account.company_id, "name": account.company_name},
    }


def timestamp(value) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def serialize_application(application: Application) -> dict[str, Any]:
    money = lambda value: format(value, ".2f") if value is not None else None
    return {
        "id": str(application.id),
        "company_id": application.company_id,
        "status": application.status,
        "purpose": application.purpose,
        "product_code": application.product_code,
        "amount_rub": money(application.amount_rub),
        "term_months": application.term_months,
        "usage_days": application.usage_days,
        "expected_inflow_date": application.expected_inflow_date.isoformat() if application.expected_inflow_date else None,
        "expected_inflow_amount_rub": money(application.expected_inflow_amount_rub),
        "version": application.version,
        "created_at": timestamp(application.created_at),
        "updated_at": timestamp(application.updated_at),
    }


def current_account(request: Request, db: Session = Depends(get_db)) -> Account:
    session_id = request.cookies.get(settings.cookie_name)
    if not session_id:
        raise ApiProblem(401, "UNAUTHENTICATED", "Войдите в демонстрационный аккаунт")

    user_session = db.get(UserSession, session_id)
    if not user_session or user_session.expires_at <= utc_now():
        if user_session:
            db.delete(user_session)
            db.commit()
        raise ApiProblem(401, "UNAUTHENTICATED", "Сессия истекла. Войдите снова")

    account = db.get(Account, user_session.account_id)
    if not account:
        raise ApiProblem(401, "UNAUTHENTICATED", "Сессия недействительна. Войдите снова")
    return account


CurrentAccount = Annotated[Account, Depends(current_account)]


def validation_error(fields: dict[str, str]) -> ApiProblem:
    return ApiProblem(422, "VALIDATION_ERROR", "Проверьте заполнение полей", fields)


def parse_money(value: str, field: str) -> Decimal:
    if not MONEY_PATTERN.fullmatch(value):
        raise validation_error({field: "Укажите положительную сумму с точностью до копеек"})
    try:
        amount = Decimal(value)
    except InvalidOperation as exc:
        raise validation_error({field: "Укажите положительную сумму"}) from exc
    if amount <= 0:
        raise validation_error({field: "Укажите положительную сумму"})
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
        for field in ("term_months", "usage_days", "expected_inflow_date", "expected_inflow_amount_rub"):
            if values[field] is not None:
                fields[field] = "Поле доступно после выбора подходящего продукта"
    elif product in {"working_capital", "equipment"}:
        for field in ("usage_days", "expected_inflow_date", "expected_inflow_amount_rub"):
            if values[field] is not None:
                fields[field] = "Поле применимо только к овердрафту"
    elif product == "overdraft" and values["term_months"] is not None:
        fields["term_months"] = "Срок в месяцах неприменим к овердрафту"
    if fields:
        raise validation_error(fields)


def application_for_account(application_id: uuid.UUID, account: Account, db: Session) -> Application:
    application = db.scalar(
        select(Application).where(Application.id == application_id, Application.company_id == account.company_id)
    )
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
    if not account or account.role != "CLIENT":
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
def list_applications(account: CurrentAccount, db: Session = Depends(get_db)) -> dict[str, list[dict[str, Any]]]:
    applications = db.scalars(
        select(Application)
        .where(Application.company_id == account.company_id)
        .order_by(Application.updated_at.desc(), Application.id.desc())
    ).all()
    return {"items": [serialize_application(application) for application in applications]}


@app.post(f"{API_PREFIX}/applications")
def create_application(
    account: CurrentAccount,
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
        application = db.get(Application, existing.application_id)
        return JSONResponse(status_code=200, content=serialize_application(application))

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
        application = db.get(Application, existing.application_id)
        return JSONResponse(status_code=200, content=serialize_application(application))
    return JSONResponse(status_code=201, content=serialize_application(application))


@app.get(f"{API_PREFIX}/applications/{{application_id}}")
def get_application(application_id: uuid.UUID, account: CurrentAccount, db: Session = Depends(get_db)):
    return serialize_application(application_for_account(application_id, account, db))


@app.patch(f"{API_PREFIX}/applications/{{application_id}}")
def update_application(
    application_id: uuid.UUID,
    payload: PatchPayload,
    account: CurrentAccount,
    db: Session = Depends(get_db),
):
    application = application_for_account(application_id, account, db)
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
        elif field in {"amount_rub", "expected_inflow_amount_rub"} and value is not None:
            value = parse_money(value, field)
        elif field in {"term_months", "usage_days"} and value is not None and value <= 0:
            raise validation_error({field: "Укажите положительное целое число"})
        elif field == "expected_inflow_date" and value is not None:
            value = parse_date(value)
        values[field] = value

    validate_final_values(values)
    for field, value in values.items():
        setattr(application, field, value)
    application.version += 1
    application.updated_at = utc_now()
    db.commit()
    return serialize_application(application)
