import pytest
from app.financial_pulse import build_financial_pulse


def profile(income='900000.00', expenses='600000.00', debt='30000.00'):
    return {'finance': {'months':[{'month':f'2026-{n:02}','income_rub':income,'expenses_rub':expenses} for n in range(4,10)], 'debt_payment_rub':debt}}


@pytest.mark.parametrize('expenses,debt,level,score', [
    ('600000.00','30000.00','GREEN',85),
    ('750000.00','50000.00','YELLOW',76),
    ('950000.00','30000.00','RED',35),
])
def test_pulse_levels_follow_conservative_health_scale(expenses,debt,level,score):
    result=build_financial_pulse(profile(expenses=expenses,debt=debt))
    assert result['status']=='READY' and result['level']==level and result['score']==score
    assert len(result['series'])==6


def test_even_idealised_finances_do_not_display_100_and_small_deterioration_reduces_score():
    assert build_financial_pulse(profile(expenses='0.00',debt='0.00'))['score']==99
    assert build_financial_pulse(profile(expenses='650000.00'))['score'] < build_financial_pulse(profile())['score']


def test_unknown_month_never_becomes_zero_or_a_healthy_chart():
    item=profile();item['finance']['months'][0]['expenses_rub']=None
    result=build_financial_pulse(item)
    assert result['status']=='INSUFFICIENT_DATA'
    assert result['score'] is None and result['metrics'] is None and result['series']==[]
    assert 'операционные расходы за все шесть месяцев' in result['missing']


def test_profile_api_adds_pulse_without_changing_original_financial_data(client):
    client.post('/api/v1/auth/demo-login',json={'account_id':'demo-client-1'})
    result=client.get('/api/v1/company-profile').json()
    assert 80 <= result['financial_pulse']['score'] <= 85
    assert result['financial_pulse']['metrics']['free_flow_rub']=='270000.00'
    assert result['financial_pulse']['series'][0]['income_rub']==result['finance']['months'][0]['income_rub']
