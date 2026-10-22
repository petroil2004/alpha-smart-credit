"""Demonstration product terms. One source for API and calculations."""
from dataclasses import asdict, dataclass
from decimal import Decimal
from typing import Any, Literal

CATALOG_VERSION = "2026-10-23.1"


@dataclass(frozen=True)
class ProductConfig:
    code: str
    title: str
    description: str
    annual_rate_percent: Decimal
    amount_min_rub: Decimal
    amount_max_rub: Decimal
    term_min_months: int | None
    term_max_months: int | None
    calculation_kind: Literal["annuity", "overdraft"]
    calculation_available: bool
    amount_step_rub: Decimal = Decimal("10000.00")
    limit_term_months: int | None = None
    usage_min_days: int | None = None
    usage_max_days: int | None = None


PRODUCTS = (
    ProductConfig("working_capital", "Оборотный кредит", "Товар, материалы и текущие расходы",
                  Decimal("25.00"), Decimal("300000.00"), Decimal("6000000.00"), 12, 36, "annuity", True),
    ProductConfig("equipment", "Кредит на оборудование", "Всё, что помогает бизнесу расти",
                  Decimal("25.00"), Decimal("500000.00"), Decimal("10000000.00"), 12, 60, "annuity", True),
    ProductConfig("overdraft", "Овердрафт", "На время до следующего поступления",
                  Decimal("26.00"), Decimal("50000.00"), Decimal("2000000.00"), None, None, "overdraft", False,
                  limit_term_months=12, usage_min_days=1, usage_max_days=60),
)


def get_product(code: str) -> ProductConfig | None:
    return next((product for product in PRODUCTS if product.code == code), None)


def get_catalog() -> dict[str, Any]:
    return {"catalog_version": CATALOG_VERSION, "items": [
        {key: format(value, ".2f") if isinstance(value, Decimal) else value
         for key, value in asdict(product).items()} for product in PRODUCTS
    ]}
