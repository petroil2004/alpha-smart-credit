from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import Boolean, Index, LargeBinary, text, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import JSONB

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


class ApplicationSubmission(Base):
    __tablename__ = 'application_submissions'
    __table_args__ = (UniqueConstraint('actor_id', 'idempotency_key', name='uq_submission_actor_key'),)

    application_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('applications.id'), primary_key=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(36), nullable=False)
    request_payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)


class ApplicationEvent(Base):
    __tablename__ = 'application_events'

    id: Mapped[int] = mapped_column(primary_key=True)
    application_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('applications.id'), nullable=False, index=True)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey('accounts.id'), nullable=True)
    actor_role: Mapped[str] = mapped_column(String(32), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    from_status: Mapped[str] = mapped_column(String(32), nullable=False)
    to_status: Mapped[str] = mapped_column(String(32), nullable=False)
    reason_code: Mapped[str] = mapped_column(String(64), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    catalog_version: Mapped[str] = mapped_column(String(100), nullable=False)
    offer_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    check_version: Mapped[int | None] = mapped_column(Integer, nullable=True)


class InfoRequest(Base):
    __tablename__ = 'info_requests'
    __table_args__ = (Index('uq_open_info_request', 'application_id', unique=True, postgresql_where=text('closed_at IS NULL')),)
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    application_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('applications.id'), nullable=False, index=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    document_required: Mapped[bool] = mapped_column(Boolean, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    reply_text: Mapped[str] = mapped_column(Text, nullable=False, default='')
    created_by: Mapped[str] = mapped_column(ForeignKey('accounts.id'), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    reply_by: Mapped[str | None] = mapped_column(ForeignKey('accounts.id'), nullable=True)
    closed_by: Mapped[str | None] = mapped_column(ForeignKey('accounts.id'), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class InfoMessage(Base):
    __tablename__ = 'info_messages'
    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('info_requests.id'), nullable=False, index=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(32), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class InfoOperation(Base):
    __tablename__ = 'info_operations'
    actor_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), primary_key=True)
    key: Mapped[str] = mapped_column(String(36), primary_key=True)
    signature: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class InfoAttachment(Base):
    __tablename__ = 'info_attachments'
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    request_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('info_requests.id'), nullable=False, index=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey('accounts.id'), nullable=False)
    filename: Mapped[str] = mapped_column(String(128), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    content: Mapped[bytes] = mapped_column(LargeBinary, nullable=False, deferred=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    detached_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CompanyData(Base):
    __tablename__ = 'company_data'

    company_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    legal_form: Mapped[str | None] = mapped_column(String(16))
    tax_id: Mapped[str | None] = mapped_column(String(12))
    okved: Mapped[str | None] = mapped_column(String(16))
    registration_date: Mapped[date | None] = mapped_column(Date)
    registration_status: Mapped[str | None] = mapped_column(String(32))
    is_bank_client: Mapped[bool | None] = mapped_column(Boolean)
    prepared_on: Mapped[date] = mapped_column(Date, nullable=False)
    data_version: Mapped[str] = mapped_column(String(100), nullable=False)
    debt_payment_rub: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    debt_source: Mapped[str | None] = mapped_column(String(32))
    debt_as_of: Mapped[date | None] = mapped_column(Date)


class CompanyMonth(Base):
    __tablename__ = 'company_months'

    company_id: Mapped[str] = mapped_column(ForeignKey('company_data.company_id'), primary_key=True)
    month: Mapped[date] = mapped_column(Date, primary_key=True)
    income_rub: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    expenses_rub: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    income_source: Mapped[str | None] = mapped_column(String(32))
    expenses_source: Mapped[str | None] = mapped_column(String(32))
