import type {
  Application,
  DraftFields,
  DraftPayload,
  FieldErrors,
} from "./types";

export class DraftValidationError extends Error {
  constructor(public fields: FieldErrors) {
    super("Проверьте заполнение полей");
    this.name = "DraftValidationError";
  }
}

export function emptyDraft(): DraftFields {
  return {
    purpose: "",
    product_code: "",
    amount_rub: "",
    term_months: "",
    usage_days: "",
    expected_inflow_date: "",
    expected_inflow_amount_rub: "",
    equipment_cost_rub: "",
    planned_payment_rub: "",
    planned_payment_date: "",
    expected_inflow_source: "",
  };
}

export function fromApplication(application: Application): DraftFields {
  return {
    purpose: application.purpose ?? "",
    product_code: application.product_code ?? "",
    amount_rub: application.amount_rub ?? "",
    term_months: application.term_months?.toString() ?? "",
    usage_days: application.usage_days?.toString() ?? "",
    expected_inflow_date: application.expected_inflow_date ?? "",
    expected_inflow_amount_rub: application.expected_inflow_amount_rub ?? "",
    equipment_cost_rub: application.equipment_cost_rub ?? "",
    planned_payment_rub: application.planned_payment_rub ?? "",
    planned_payment_date: application.planned_payment_date ?? "",
    expected_inflow_source: application.expected_inflow_source ?? "",
  };
}

export function normalizeMoney(input: string): string | null {
  const value = input.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  if (!value) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(value) || !/[1-9]/.test(value)) {
    throw new Error(
      "Укажите положительную сумму, не более двух знаков после запятой",
    );
  }
  const [whole, fraction = ""] = value.split(".");
  return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.padEnd(2, "0")}`;
}

export function formatMoneyRub(value: string | null): string {
  if (value && /^0+(?:\.0{1,2})?$/.test(value)) return "0,00 ₽";
  try {
    const money = normalizeMoney(value ?? "");
    if (!money) return "Не указано";
    const [whole, cents] = money.split(".");
    return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${cents} ₽`;
  } catch { return value ?? "Не указано"; }
}

export function prepareDraftPayload(fields: DraftFields): { payload: DraftPayload; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const money = (key: "amount_rub" | "expected_inflow_amount_rub" | "equipment_cost_rub" | "planned_payment_rub") => {
    try {
      return normalizeMoney(fields[key]);
    } catch (error) {
      errors[key] = (error as Error).message;
      return null;
    }
  };
  const integer = (key: "term_months" | "usage_days") => {
    const text = fields[key].trim();
    if (!text) return null;
    const value = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value <= 0) {
      errors[key] = "Укажите положительное целое число";
      return null;
    }
    return value;
  };
  const purpose = fields.purpose.trim();
  if (purpose.length > 500) errors.purpose = "Не более 500 символов";
  const overdraft = fields.product_code === "overdraft";
  const date = overdraft ? fields.expected_inflow_date.trim() : "";
  if (
    date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
  ) {
    errors.expected_inflow_date = "Укажите корректную дату";
  }
  const payload: DraftPayload = {
    purpose: purpose || null,
    product_code: fields.product_code || null,
    amount_rub: money("amount_rub"),
    term_months:
      fields.product_code && !overdraft ? integer("term_months") : null,
    usage_days: overdraft ? integer("usage_days") : null,
    expected_inflow_date: date || null,
    expected_inflow_amount_rub: overdraft
      ? money("expected_inflow_amount_rub")
      : null,
    equipment_cost_rub: fields.product_code === "equipment" ? money("equipment_cost_rub") : null,
    planned_payment_rub: overdraft ? money("planned_payment_rub") : null,
    planned_payment_date: overdraft ? fields.planned_payment_date.trim() || null : null,
    expected_inflow_source: overdraft ? fields.expected_inflow_source || null : null,
  };
  return { payload, errors };
}

export function toDraftPayload(fields: DraftFields): DraftPayload {
  const { payload, errors } = prepareDraftPayload(fields);
  if (Object.keys(errors).length) throw new DraftValidationError(errors);
  return payload;
}
