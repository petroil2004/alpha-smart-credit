"""Read-only Decimal calculations; no database or application decisions."""
from decimal import Decimal, ROUND_HALF_UP, localcontext
from typing import Any

from .product_catalog import CATALOG_VERSION, get_product


class CalculationValidationError(Exception):
    def __init__(self, fields: dict[str, str]):
        self.fields = fields
        super().__init__("Некорректные параметры расчёта")


def annuity_payment(amount_rub: Decimal, annual_rate_percent: Decimal, term_months: int) -> Decimal:
    with localcontext() as context:
        context.prec = 50
        rate = annual_rate_percent / Decimal(100) / Decimal(12)
        payment = (amount_rub / term_months if rate == 0 else
                   amount_rub * rate / (1 - (1 + rate) ** (-term_months)))
        return payment.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def calculate_annuity(product_code: str, amount_rub: Decimal, term_months: int) -> dict[str, Any]:
    product = get_product(product_code)
    if not product or product.calculation_kind != "annuity":
        raise CalculationValidationError({"product_code": "Аннуитетный расчёт доступен для оборотного кредита и оборудования"})
    fields = {}
    if not amount_rub.is_finite() or not product.amount_min_rub <= amount_rub <= product.amount_max_rub:
        fields["amount_rub"] = f"Для расчёта укажите сумму от {product.amount_min_rub} до {product.amount_max_rub} ₽"
    if not product.term_min_months <= term_months <= product.term_max_months:
        fields["term_months"] = f"Для расчёта укажите срок от {product.term_min_months} до {product.term_max_months} месяцев"
    if fields:
        raise CalculationValidationError(fields)
    with localcontext() as context:
        context.prec = 50
        payment = annuity_payment(amount_rub, product.annual_rate_percent, term_months)
        total = payment * term_months
        return {
            "catalog_version": CATALOG_VERSION, "product_code": product_code,
            "amount_rub": format(amount_rub, ".2f"), "term_months": term_months,
            "annual_rate_percent": format(product.annual_rate_percent, ".2f"),
            "monthly_payment_rub": format(payment, ".2f"), "total_payment_rub": format(total, ".2f"),
            "overpayment_rub": format(total - amount_rub, ".2f"),
        }
