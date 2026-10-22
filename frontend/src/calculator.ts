import { normalizeMoney } from "./draft";
import type { AnnuityRequest, AnnuityResult, DraftFields, FieldErrors, Product, ProductCatalog } from "./types";

const moneyPattern = /^\d+\.\d{2}$/;
const cents = (value: string) => BigInt(value.replace(".", ""));

export function prepareCalculation(fields: DraftFields, catalog: ProductCatalog): {request: AnnuityRequest | null; errors: FieldErrors} {
  const errors: FieldErrors = {};
  const product = catalog.items.find(p => p.code === fields.product_code);
  if (!product || !product.calculation_available || product.calculation_kind !== "annuity") return {request:null, errors};
  let amount: string | null = null;
  try {
    amount = normalizeMoney(fields.amount_rub);
    if (amount && (cents(amount) < cents(product.amount_min_rub) || cents(amount) > cents(product.amount_max_rub))) {
      errors.amount_rub = `Для расчёта укажите сумму от ${product.amount_min_rub} до ${product.amount_max_rub} ₽`;
    }
  } catch { errors.amount_rub = "Для расчёта укажите положительную сумму до копеек"; }
  const rawTerm = fields.term_months.trim();
  const term = rawTerm ? Number(rawTerm) : null;
  if (rawTerm && (!/^\d+$/.test(rawTerm) || !Number.isSafeInteger(term) || term! < product.term_min_months! || term! > product.term_max_months!)) {
    errors.term_months = `Для расчёта укажите срок от ${product.term_min_months} до ${product.term_max_months} месяцев`;
  }
  if (!amount || term === null || Object.keys(errors).length) return {request:null,errors};
  return {request:{product_code: product.code as AnnuityRequest["product_code"],amount_rub:amount,term_months:term},errors};
}

export function calculationKey(applicationId:string,input:AnnuityRequest,catalogVersion:string):string {
  return JSON.stringify([applicationId,input.product_code,input.amount_rub,input.term_months,catalogVersion]);
}

export function isCurrentAnnuityResult(input:AnnuityRequest,catalog:ProductCatalog,value:unknown):value is AnnuityResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string,unknown>;
  const product = catalog.items.find(p=>p.code===input.product_code);
  return result.catalog_version===catalog.catalog_version && result.product_code===input.product_code && result.amount_rub===input.amount_rub && result.term_months===input.term_months && result.annual_rate_percent===product?.annual_rate_percent &&
    ["monthly_payment_rub","total_payment_rub","overpayment_rub"].every(key=>typeof result[key]==="string" && moneyPattern.test(result[key] as string));
}

export function sliderAmountValue(raw:string,product:Product):number {
  try {
    const amount=normalizeMoney(raw);
    if (!amount || cents(amount)<cents(product.amount_min_rub)) return Number(product.amount_min_rub);
    if (cents(amount)>cents(product.amount_max_rub)) return Number(product.amount_max_rub);
    return Number(amount);
  } catch { return Number(product.amount_min_rub); }
}

export function isProductCatalog(value: unknown): value is ProductCatalog {
  if (!value || typeof value !== "object") return false;
  const catalog = value as ProductCatalog;
  if (typeof catalog.catalog_version !== "string" || !catalog.catalog_version || !Array.isArray(catalog.items) || catalog.items.length !== 3) return false;
  return ["working_capital","equipment","overdraft"].every(code=>catalog.items.filter(p=>p?.code===code).length===1) && catalog.items.every(p=> {
    if (typeof p.title!=="string" || typeof p.description!=="string" || typeof p.calculation_available!=="boolean") return false;
    if (![p.amount_min_rub,p.amount_max_rub,p.amount_step_rub,p.annual_rate_percent].every(v=>typeof v==="string"&&moneyPattern.test(v))) return false;
    if (cents(p.amount_min_rub)<=0n || cents(p.amount_max_rub)<cents(p.amount_min_rub) || cents(p.amount_max_rub)>BigInt(Number.MAX_SAFE_INTEGER) || cents(p.amount_step_rub)<=0n) return false;
    return p.code==="overdraft" ? p.calculation_kind==="overdraft" && !p.calculation_available : p.calculation_kind==="annuity" && p.calculation_available && Number.isSafeInteger(p.term_min_months) && Number.isSafeInteger(p.term_max_months) && p.term_min_months!>0 && p.term_max_months!>=p.term_min_months!;
  });
}
