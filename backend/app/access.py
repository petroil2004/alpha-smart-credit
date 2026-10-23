"""Session identity and independent role checks for every action."""
from typing import Annotated
from fastapi import Depends, Request
from sqlalchemy.orm import Session
from .db import get_db
from .models import Account, UserSession, utc_now
from .settings import settings
from .problems import ApiProblem

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



def client_account(account: CurrentAccount) -> Account:
    if account.role != "CLIENT" or not account.company_id or not account.company_name:
        raise ApiProblem(403, "FORBIDDEN", "Действие доступно только клиенту своей компании")
    return account


def staff_account(account: CurrentAccount) -> Account:
    if account.role != "STAFF":
        raise ApiProblem(403, "FORBIDDEN", "Действие доступно только сотруднику")
    return account


ClientAccount = Annotated[Account, Depends(client_account)]
StaffAccount = Annotated[Account, Depends(staff_account)]
