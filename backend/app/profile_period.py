"""One Moscow calendar for prepared datasets, live profiles and submitted periods."""
from calendar import monthrange
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

MOSCOW = ZoneInfo('Europe/Moscow')


def shift_month(value: date, offset: int) -> date:
    absolute = value.year * 12 + value.month - 1 + offset
    year, month = absolute // 12, absolute % 12 + 1
    return date(year, month, min(value.day, monthrange(year, month)[1]))


def period_for(now: datetime) -> dict[str, str]:
    first = now.astimezone(MOSCOW).date().replace(day=1)
    return {'start_date': shift_month(first, -6).isoformat(), 'end_date': (first - timedelta(days=1)).isoformat()}


def months_for(period: dict[str, str]) -> list[date]:
    start = date.fromisoformat(period['start_date'])
    return [shift_month(start, offset) for offset in range(6)]


def full_months(registered: date, as_of: date) -> int:
    return max(0, (as_of.year - registered.year) * 12 + as_of.month - registered.month - (as_of.day < registered.day))
