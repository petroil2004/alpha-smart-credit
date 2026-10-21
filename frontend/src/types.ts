export type ProductCode = 'working_capital' | 'equipment' | 'overdraft';

export interface Session {
  user: { id: string; name: string; role: 'CLIENT' };
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
  status: 'DRAFT';
  version: number;
  created_at: string;
  updated_at: string;
}

export interface DraftFields {
  purpose: string;
  product_code: ProductCode | '';
  amount_rub: string;
  term_months: string;
  usage_days: string;
  expected_inflow_date: string;
  expected_inflow_amount_rub: string;
}

export type FieldErrors = Partial<Record<keyof DraftFields, string>>;

export interface Api {
  me(): Promise<Session>;
  login(accountId: string): Promise<Session>;
  logout(): Promise<void>;
  list(): Promise<{ items: Application[] }>;
  create(key: string): Promise<Application>;
  get(id: string): Promise<Application>;
  update(id: string, body: Partial<DraftPayload> & { version: number }): Promise<Application>;
}
