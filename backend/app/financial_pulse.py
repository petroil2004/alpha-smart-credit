"""Informational financial health, calculated from stored facts, never a loan decision."""
from decimal import Decimal, ROUND_HALF_UP
from .financial_factors import missing_finances, financial_factors, percent


def money(value):
    return format(value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP), '.2f')


def build_financial_pulse(profile):
    finance = profile.get('finance') or {}
    facts = {'months': finance.get('months', []), 'debt_payment_rub': finance.get('debt_payment_rub')}
    missing = missing_finances(facts)
    result = {'status': 'INSUFFICIENT_DATA', 'model_version': 'financial-pulse-v2', 'score': None,
              'level': None, 'metrics': None, 'series': [], 'missing': missing}
    if missing:
        return result
    inputs, values = financial_factors(facts)
    # Continuous demo health scale, independent of credit policy. Full marks would
    # require constant receipts, no operational expenses and no existing debt.
    volatility = (max(Decimal(row['income_rub']) for row in facts['months'])
                  - min(Decimal(row['income_rub']) for row in facts['months'])) / values['income'] if values['income'] else Decimal(0)
    stability = 1 / (1 + volatility) if values['income'] else Decimal(0)
    margin = min(Decimal(1), max(Decimal(0), values['margin']))
    profitability = margin ** (Decimal(1) / 3)
    debt_health = 1 / (1 + values['debt_ratio']) if values['debt_ratio'] is not None else Decimal(0)
    points = stability * 35 + profitability * 40 + debt_health * 25
    score = min(99, int(points.quantize(Decimal('1'), rounding=ROUND_HALF_UP)))
    level = 'GREEN' if score >= 80 else 'YELLOW' if score >= 50 else 'RED'
    incomes = [Decimal(row['income_rub']) for row in facts['months']]
    before, after = sum(incomes[:3]), sum(incomes[3:])
    change = percent((after - before) / before) if before > 0 else None
    return {**result, 'status': 'READY', 'score': score, 'level': level, 'metrics': {
        'average_income_rub': money(values['income']), 'income_change_percent': change,
        'margin_percent': percent(values['margin']),
        'debt_load_percent': percent(values['debt_ratio']) if values['debt_ratio'] is not None else None,
        'free_flow_rub': money(values['flow'] - values['debt']),
        'margin_level': 'GREEN' if inputs[1][2] == '1' else 'YELLOW' if inputs[1][2] == '0.60' else 'RED',
        'debt_level': 'GREEN' if inputs[2][2] == '1' else 'YELLOW' if inputs[2][2] == '0.60' else 'RED',
    }, 'series': [{'month': row['month'], 'income_rub': row['income_rub'], 'expenses_rub': row['expenses_rub']} for row in facts['months']]}
