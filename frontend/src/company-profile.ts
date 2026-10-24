import type {CompanyProfile} from './types';
const money=(v:unknown)=>v===null||(typeof v==='string'&&/^\d+\.\d{2}$/.test(v));
const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
export function validateCompanyProfile(profile:CompanyProfile){
 if(!profile.profile_version||!profile.company_name||profile.source!=='BANK_DATA')throw Error('Invalid company profile');
 if(profile.details){
  const d=profile.details;
  if((d.registration_date!==null&&!date(d.registration_date))||(d.business_age_months!==null&&(!Number.isSafeInteger(d.business_age_months)||d.business_age_months<0)))throw Error('Invalid company details');
 }
 if(profile.finance!==undefined){
  const f=profile.finance;
  if(!f||!date(f.period?.start_date)||!date(f.period?.end_date)||!Array.isArray(f.months)||f.months.length!==6)throw Error('Invalid company finances');
  const first=new Date(f.period.start_date+'T00:00:00Z');
  for(let i=0;i<6;i++){
   const expected=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+i,1)).toISOString().slice(0,7),r=f.months[i];
   if(!r||r.month!==expected||!money(r.income_rub)||!money(r.expenses_rub))throw Error('Invalid financial month');
  }
  if(!money(f.debt_payment_rub)||!money(f.average_income_rub)||!money(f.average_expenses_rub))throw Error('Invalid financial summary');
 }
}
