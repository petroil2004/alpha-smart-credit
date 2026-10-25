from zoneinfo import ZoneInfo
from .models import utc_now


def business_today():
    return utc_now().astimezone(ZoneInfo('Europe/Moscow')).date()


def future_date_errors(values):
    today = business_today()
    return {field: 'Укажите сегодняшнюю или будущую дату' for field in ('planned_payment_date', 'expected_inflow_date')
            if values.get(field) is not None and values[field] < today}
