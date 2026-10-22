from decimal import Decimal as D, localcontext

import pytest

from app.calculator import CalculationValidationError, annuity_payment, calculate_annuity


@pytest.mark.parametrize("code,amount,months,payment,total,overpayment", [
    ("working_capital", "3000000.00", 36, "119279.48", "4294061.28", "1294061.28"),
    ("equipment", "5000000.00", 45, "172289.03", "7753006.35", "2753006.35"),
])
def test_annuity_reference_examples(code, amount, months, payment, total, overpayment):
    result = calculate_annuity(code, D(amount), months)
    assert result == {
        "catalog_version": "2026-10-23.1", "product_code": code,
        "amount_rub": amount, "term_months": months, "annual_rate_percent": "25.00",
        "monthly_payment_rub": payment, "total_payment_rub": total,
        "overpayment_rub": overpayment,
    }


def test_zero_rate_and_half_up_rounding():
    assert annuity_payment(D("1200"), D("0"), 12) == D("100.00")
    assert annuity_payment(D("1"), D("0"), 8) == D("0.13")


@pytest.mark.parametrize("code,amount,months", [
    ("working_capital", "300000.00", 12), ("working_capital", "6000000.00", 36),
    ("equipment", "500000.00", 12), ("equipment", "10000000.00", 60),
])
def test_product_boundaries(code, amount, months):
    assert calculate_annuity(code, D(amount), months)["amount_rub"] == amount


@pytest.mark.parametrize("code,amount,months,field", [
    ("working_capital", "299999.99", 12, "amount_rub"),
    ("working_capital", "6000000.01", 36, "amount_rub"),
    ("equipment", "499999.99", 12, "amount_rub"),
    ("equipment", "10000000.01", 60, "amount_rub"),
    ("working_capital", "300000", 11, "term_months"),
    ("working_capital", "300000", 37, "term_months"),
    ("equipment", "500000", 11, "term_months"),
    ("equipment", "500000", 61, "term_months"),
    ("overdraft", "500000", 12, "product_code"),
    ("unknown", "500000", 12, "product_code"),
])
def test_rejects_outside_product_boundaries(code, amount, months, field):
    with pytest.raises(CalculationValidationError) as caught:
        calculate_annuity(code, D(amount), months)
    assert field in caught.value.fields


def test_decimal_precision_is_local_and_kopecks_survive():
    with localcontext() as context:
        context.prec = 6
        result = calculate_annuity("working_capital", D("300000.01"), 36)
        assert context.prec == 6
    assert result["amount_rub"] == "300000.01"
    assert result["monthly_payment_rub"] == "11927.95"
