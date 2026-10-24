import type {CompanyProfile} from '../types';
export function companyProfile():CompanyProfile {
 return {company_id:'demo-company-1',company_name:'ООО «Демо Торг»',profile_version:'company-v2:fixture',source:'BANK_DATA',
  prepared_on:'2026-10-24',as_of_date:'2026-10-24',data_version:'demo-profiles-v1',
  details:{legal_form:'OOO',tax_id:null,okved:null,registration_date:'2023-10-24',business_age_months:36,registration_status:'ACTIVE',is_bank_client:true},
  finance:{period:{start_date:'2026-04-01',end_date:'2026-09-30'},months:['04','05','06','07','08','09'].map(month=>({month:'2026-'+month,income_rub:'900000.00',expenses_rub:'600000.00',income_source:'BANK_DATA',expenses_source:'BANK_DATA'})),debt_payment_rub:'30000.00',debt_source:'BANK_DATA',debt_as_of:'2026-10-24',average_income_rub:'900000.00',average_expenses_rub:'600000.00'}};
}
