export type ProductCode = "working_capital" | "equipment" | "overdraft";

export interface Product {
  code: ProductCode;
  title: string;
  description: string;
  annual_rate_percent: string;
  amount_min_rub: string;
  amount_max_rub: string;
  amount_step_rub: string;
  term_min_months: number | null;
  term_max_months: number | null;
  limit_term_months: number | null;
  usage_min_days: number | null;
  usage_max_days: number | null;
  calculation_kind: "annuity" | "overdraft";
  calculation_available: boolean;
}

export interface ProductCatalog { catalog_version: string; items: Product[]; }
export interface AnnuityRequest {
  product_code: "working_capital" | "equipment";
  amount_rub: string;
  term_months: number;
}
export interface AnnuityResult extends AnnuityRequest {
  catalog_version: string;
  annual_rate_percent: string;
  monthly_payment_rub: string;
  total_payment_rub: string;
  overpayment_rub: string;
}

export interface Session {
  user: { id: string; name: string; role: "CLIENT" };
  company: { id: string; name: string };
}

export interface DraftPayload {
  purpose: string | null;
  product_code: ProductCode | null;
  amount_rub: string | null;
  term_months: number | null;
  usage_days: number | null;
  expected_inflow_date: string | null;
  expected_inflow_amount_rub: string | null;
}

export interface Application extends DraftPayload {
  id: string;
  company_id: string;
  status: "DRAFT";
  version: number;
  created_at: string;
  updated_at: string;
}

export interface DraftFields {
  purpose: string;
  product_code: ProductCode | "";
  amount_rub: string;
  term_months: string;
  usage_days: string;
  expected_inflow_date: string;
  expected_inflow_amount_rub: string;
}

export type FieldErrors = Partial<Record<keyof DraftFields, string>>;

export interface Api {
  products(): Promise<ProductCatalog>;
  calculateAnnuity(input: AnnuityRequest): Promise<AnnuityResult>;
  me(): Promise<Session>;
  login(accountId: string): Promise<Session>;
  logout(): Promise<void>;
  list(): Promise<{ items: Application[] }>;
  create(key: string): Promise<Application>;
  get(id: string): Promise<Application>;
  remove(id: string, version: number): Promise<void>;
  update(
    id: string,
    body: Partial<DraftPayload> & { version: number },
  ): Promise<Application>;
}
