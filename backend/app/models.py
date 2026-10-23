from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="CLIENT")
    company_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    company_name: Mapped[str | None] = mapped_column(String(200), nullable=True)


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class Application(Base):
    __tablename__ = "applications"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    company_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    purpose: Mapped[str | None] = mapped_column(Text, nullable=True)
    product_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    amount_rub: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    term_months: Mapped[int | None] = mapped_column(Integer, nullable=True)
    usage_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    expected_inflow_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expected_inflow_amount_rub: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class ApplicationCreation(Base):
    __tablename__ = "application_creations"
    __table_args__ = (UniqueConstraint("account_id", "idempotency_key", name="uq_creation_account_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(36), nullable=False)
    application_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("applications.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
