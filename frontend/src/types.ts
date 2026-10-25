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

export interface ClientSession {
  user: { id: string; name: string; role: "CLIENT" };
  company: { id: string; name: string };
}

export interface StaffSession {
  user: { id: string; name: string; role: "STAFF" };
  company: null;
}
export type Session = ClientSession | StaffSession;
export interface CompanyDetails {
  legal_form:string|null; tax_id:string|null; okved:string|null; registration_date:string|null;
  registry_source?:"FNS_MOCK"|null; business_age_months:number|null; registration_status:string|null; is_bank_client:boolean|null;
}
export interface CompanyFinance {
  period:{start_date:string;end_date:string};
  months:{month:string;income_rub:string|null;expenses_rub:string|null;income_source:string|null;expenses_source:string|null}[];
  debt_payment_rub:string|null; debt_source:string|null; debt_as_of:string|null;
  average_income_rub:string|null; average_expenses_rub:string|null;
}
export interface CompanyProfile {
  details?:CompanyDetails; finance?:CompanyFinance;
  prepared_on?:string|null; as_of_date?:string; data_version?:string|null;
  company_id: string; company_name: string; profile_version: string; source: "BANK_DATA";
}
export interface SubmitInput {
  version: number; profile_version: string; catalog_version: string; confirmed: true;
}
export interface SubmissionSnapshot {
  application: DraftPayload;
  company: CompanyProfile;
  calculation: AnnuityResult;
  financial_period: {start_date: string; end_date: string};
  confirmed_at: string; confirmed_by: string;
}
export interface ApplicationEvent {
  id: number; actor_id: string | null; actor_role: string; occurred_at: string;
  from_status: string; to_status: string; reason_code: string; comment: string | null;
  catalog_version: string; offer_version: number | null; check_version: number | null;
}

export interface DraftPayload {
  purpose: string | null;
  product_code: ProductCode | null;
  amount_rub: string | null;
  term_months: number | null;
  usage_days: number | null;
  expected_inflow_date: string | null;
  expected_inflow_amount_rub: string | null;
  equipment_cost_rub: string | null;
  planned_payment_rub: string | null;
  planned_payment_date: string | null;
  expected_inflow_source: "BUYER" | "CONTRACT" | "REGULAR_REVENUE" | "OTHER" | null;
}

export interface Application extends DraftPayload {
  application_number?:number;
  disbursement?:{confirmed_at:string;amount_rub:string;kind:"CREDITED"|"OVERDRAFT_LIMIT"}|null;
  id: string;
  company_id: string;
  status: "DRAFT" | "UNDER_REVIEW" | (string & {});
  company_name?: string;
  submitted_at?: string | null;
  submission?: {submitted_at: string; submitted_by: string; snapshot: SubmissionSnapshot} | null;
  history?: ApplicationEvent[];
  info_requests?: InfoRequest[];
  next_action?: "CLIENT"|"STAFF"|null;
  assessment?: Assessment | null;
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
  equipment_cost_rub: string;
  planned_payment_rub: string;
  planned_payment_date: string;
  expected_inflow_source: "" | "BUYER" | "CONTRACT" | "REGULAR_REVENUE" | "OTHER";
}

export interface Assessment {
  model_version: string; score: number | null; group: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  recommendation: "REQUEST_INFO" | "RECOMMEND_DECLINE" | "OFFER_REQUESTED";
  reasons: string[]; missing: string[]; formal_checks: string[]; calculated_at: string;
  criteria?: {label:string;input:string;factor:string;weight:number;points:number}[];
}

export type FieldErrors = Partial<Record<keyof DraftFields, string>>;

export interface AssistantMessage {role:'user'|'assistant';content:string;}
export interface AssistantStatus {request_timeout_seconds?:number;enabled:boolean;available:boolean;model:string;reason:string|null;}
export interface AssistantReply {
  answer:string;suggested_product:ProductCode|null;products:Product[];catalog_version:string;
  source:'SERVER_CATALOG';model:string;disclaimer:string;
}

export interface ClientNotification {
  id:number; application_id:string; application_number?:number; status:string; title:string; message:string|null; occurred_at:string; read:boolean;
}
export interface NotificationList {items:ClientNotification[];unread_count:number;}

export interface StaffProfile {account_id:string;full_name:string;position:string;department:string;city:string;source:"DEMO";}
export interface ManualFinancialInput {version:number;reason:string;values:{kind:FinancialValue["kind"];month:string|null;value_rub:string}[];}
export interface StaffCorrection {id:number;actor_id:string;actor_name?:string;recorded_at:string;reason:string;values:(Omit<FinancialValue,"source">&{source:"STAFF_VERIFIED"})[];}

export interface Api {
  staffProfile?():Promise<StaffProfile>;
  disburse?(id:string,body:{version:number;confirmed:true},key:string):Promise<Application>;
  notifications?: {list():Promise<NotificationList>;read(id:number):Promise<void>};
  assistant?:{
    status():Promise<AssistantStatus>;
    chat(body:{application_id:string;message:string;history:AssistantMessage[]}):Promise<AssistantReply>;
  };
  info?: InfoApi;
  companyProfile(): Promise<CompanyProfile>;
  submit(id: string, input: SubmitInput, key: string): Promise<Application>;
  staffList(): Promise<{items: Application[]}>;
  staffGet(id: string): Promise<Application>;
  assessment(id: string): Promise<Assessment>;
  decide(id: string, body: {version:number;decision:"APPROVE"|"DECLINE";comment:string}, key:string): Promise<Application>;
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

export interface InfoAttachment {
  id:string; filename:string; content_type:string; size_bytes:number; actor_id:string; created_at:string;
}
export interface InfoMessage {id:number; text:string; actor_id:string; actor_role:string; created_at:string;}
export interface InfoRequest {
  id:string; question:string; reason:string; document_required:boolean; revision:number; reply_text:string;
  source:'SELF_REPORTED'; created_at:string; created_by:string; reply_by:string|null; closed_at:string|null; closed_by:string|null;
  staff_corrections?:StaffCorrection[];
  financial_required?:boolean; financial_values?:FinancialValue[]|null; financial_accepted_at?:string|null;
  messages:InfoMessage[]; attachments:InfoAttachment[];
}
export interface FinancialValue {kind:"income_rub"|"expenses_rub"|"debt_payment_rub";month:string|null;value_rub:string;source:"CLIENT_DOCUMENT"|"CLIENT_CONFIRMED";}
export interface InfoCreate {version:number; question:string; reason:string; document_required:boolean; financial_required?:boolean;}
export interface InfoSubmit {version:number; revision:number; financial_values?:FinancialValue[];}
export interface InfoApi {
  correctFinancial?(id:string,rid:string,body:ManualFinancialInput,key:string):Promise<Application>;
  create(id:string,body:InfoCreate,key:string):Promise<Application>;
  save(id:string,rid:string,revision:number,text:string):Promise<Application>;
  submit(id:string,rid:string,body:InfoSubmit,key:string):Promise<Application>;
  message(id:string,rid:string,staff:boolean,text:string,key:string):Promise<Application>;
  upload(id:string,rid:string,fid:string,revision:number,file:File):Promise<Application>;
  detach(id:string,rid:string,fid:string,revision:number):Promise<Application>;
  acceptFinancial(id:string,rid:string,key:string):Promise<Application>;
  download(id:string,rid:string,fid:string,staff:boolean):Promise<Blob>;
}
