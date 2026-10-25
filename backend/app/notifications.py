"""Client notifications derived from committed status transitions, scoped to company."""
from fastapi import APIRouter, Depends, Response
from sqlalchemy import and_, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .access import ClientAccount
from .db import get_db
from .models import Application, ApplicationEvent, NotificationRead
from .problems import ApiProblem

router = APIRouter(prefix='/api/v1/notifications')
TITLES = {
    'UNDER_REVIEW': 'Заявка на рассмотрении',
    'NEEDS_INFO': 'Банк запросил уточнения',
    'APPROVED': 'Заявка одобрена',
    'DECLINED': 'По заявке получен отказ',
}


def events(company_id):
    return select(ApplicationEvent).join(Application).where(
        Application.company_id == company_id,
        ApplicationEvent.from_status != ApplicationEvent.to_status,
        ApplicationEvent.to_status.in_(TITLES),
    )


@router.get('')
def list_notifications(account: ClientAccount, db: Session = Depends(get_db)):
    query = events(account.company_id).outerjoin(NotificationRead, and_(
        NotificationRead.event_id == ApplicationEvent.id,
        NotificationRead.account_id == account.id,
    ))
    unread = db.scalar(select(func.count()).select_from(
        query.where(NotificationRead.event_id.is_(None)).subquery()
    ))
    rows = db.execute(query.add_columns(NotificationRead.read_at).order_by(
        NotificationRead.read_at.is_not(None), ApplicationEvent.id.desc()
    ).limit(100))
    return {'unread_count': unread, 'items': [{
        'id': event.id, 'application_id': str(event.application_id),
        'status': event.to_status, 'title': TITLES[event.to_status],
        'message': event.comment, 'occurred_at': event.occurred_at.isoformat(),
        'read': read_at is not None,
    } for event, read_at in rows]}


@router.post('/{event_id}/read', status_code=204)
def mark_read(event_id: int, account: ClientAccount, db: Session = Depends(get_db)):
    event = db.scalar(events(account.company_id).where(ApplicationEvent.id == event_id))
    if event is None:
        raise ApiProblem(404, 'NOT_FOUND', 'Уведомление не найдено')
    db.execute(insert(NotificationRead).values(account_id=account.id, event_id=event.id).on_conflict_do_nothing())
    db.commit()
    return Response(status_code=204)
