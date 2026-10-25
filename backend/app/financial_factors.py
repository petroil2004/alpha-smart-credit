"""Shared financial factors for the credit score and the informational company pulse."""
from decimal import Decimal, ROUND_HALF_UP


def percent(value):
    return format((value * 100).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP), '.2f')


def missing_finances(facts):
    months = facts['months']
    missing = []
    if len(months) != 6:
        missing.append('шесть месяцев финансовых данных')
    if any(row.get('income_rub') is None for row in months):
        missing.append('поступления за все шесть месяцев')
    if any(row.get('expenses_rub') is None for row in months):
        missing.append('операционные расходы за все шесть месяцев')
    if facts['debt_payment_rub'] is None:
        missing.append('ежемесячные платежи по действующим долгам')
    return missing


def financial_factors(facts):
    income = [Decimal(row['income_rub']) for row in facts['months']]
    expenses = [Decimal(row['expenses_rub']) for row in facts['months']]
    average_income, average_expenses = sum(income) / 6, sum(expenses) / 6
    flow = average_income - average_expenses
    debt = Decimal(facts['debt_payment_rub'])
    volatility = (max(income) - min(income)) / average_income if average_income else Decimal(1)
    margin = flow / average_income if average_income else Decimal(0)
    debt_ratio = debt / flow if flow > 0 else Decimal('999')
    inputs = [
        ('Стабильность поступлений', f'Разброс {percent(volatility)}%', '1' if volatility <= Decimal('0.20') else '0.60' if volatility <= Decimal('0.35') else '0.20'),
        ('Операционный поток', f'Доля потока {percent(margin)}%', '1' if margin >= Decimal('0.30') else '0.60' if margin >= Decimal('0.15') else '0.20'),
        ('Действующая долговая нагрузка', f'{percent(debt_ratio)}% потока' if flow > 0 else 'Нет положительного потока', '1' if debt_ratio <= Decimal('0.10') else '0.60' if debt_ratio <= Decimal('0.30') else '0.20'),
    ]
    return inputs, {'income': average_income, 'expenses': average_expenses, 'flow': flow, 'debt': debt,
                    'margin': margin, 'debt_ratio': debt_ratio if flow > 0 else None}
