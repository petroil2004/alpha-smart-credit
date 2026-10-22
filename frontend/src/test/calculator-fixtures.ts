import type { AnnuityResult, ProductCatalog } from "../types";

export const catalog: ProductCatalog = {
  catalog_version: "2026-10-23.1",
  items: [
    { code: "working_capital", title: "Оборотный кредит", description: "Товар, материалы и текущие расходы", annual_rate_percent: "25.00", amount_min_rub: "300000.00", amount_max_rub: "6000000.00", amount_step_rub: "10000.00", term_min_months: 12, term_max_months: 36, limit_term_months: null, usage_min_days: null, usage_max_days: null, calculation_kind: "annuity", calculation_available: true },
    { code: "equipment", title: "Кредит на оборудование", description: "Всё, что помогает бизнесу расти", annual_rate_percent: "25.00", amount_min_rub: "500000.00", amount_max_rub: "10000000.00", amount_step_rub: "10000.00", term_min_months: 12, term_max_months: 60, limit_term_months: null, usage_min_days: null, usage_max_days: null, calculation_kind: "annuity", calculation_available: true },
    { code: "overdraft", title: "Овердрафт", description: "На время до следующего поступления", annual_rate_percent: "26.00", amount_min_rub: "50000.00", amount_max_rub: "2000000.00", amount_step_rub: "10000.00", term_min_months: null, term_max_months: null, limit_term_months: 12, usage_min_days: 1, usage_max_days: 60, calculation_kind: "overdraft", calculation_available: false },
  ],
};

// Fixed HTTP fixture, deliberately no loan formula in browser test code.
export function annuityResult(overrides: Partial<AnnuityResult> = {}): AnnuityResult {
  return { catalog_version: catalog.catalog_version, product_code: "working_capital", amount_rub: "3000000.00", term_months: 36, annual_rate_percent: "25.00", monthly_payment_rub: "119279.48", total_payment_rub: "4294061.28", overpayment_rub: "1294061.28", ...overrides };
}
