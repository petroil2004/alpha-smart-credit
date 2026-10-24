const record=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const text=(v:unknown)=>typeof v==='string'&&v.trim().length>0;
const nullableText=(v:unknown)=>v===null||text(v);
const money=(v:unknown)=>v===null||(typeof v==='string'&&/^\d+\.\d{2}$/.test(v));
function date(v:unknown):v is string {
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
 const parsed=new Date(v+'T00:00:00Z');
 return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===v;
}
const nullableDate=(v:unknown)=>v===null||date(v);
const monthDate=(year:number,month:number,day:number)=>new Date(Date.UTC(year,month,day)).toISOString().slice(0,10);

// Live API responses require the full current DTO. Historical snapshots are
// rendered separately and retain compatibility with their original fields.
export function validateCompanyProfile(profile:unknown){
 if(!record(profile)||!text(profile.company_id)||!text(profile.profile_version)||!text(profile.company_name)||profile.source!=='BANK_DATA'
   ||!date(profile.as_of_date)||!nullableDate(profile.prepared_on)||!nullableText(profile.data_version))throw Error('Invalid company profile');
 const d=profile.details;
 if(!record(d)||!(d.legal_form===null||d.legal_form==='OOO'||d.legal_form==='IP')||!nullableText(d.tax_id)||!nullableText(d.okved)||!(d.registry_source===undefined||d.registry_source===null||d.registry_source==='FNS_MOCK')
   ||!nullableDate(d.registration_date)||!(d.business_age_months===null||(typeof d.business_age_months==='number'&&Number.isSafeInteger(d.business_age_months)&&d.business_age_months>=0))
   ||!(d.registration_status===null||d.registration_status==='ACTIVE'||d.registration_status==='TERMINATED')
   ||!(d.is_bank_client===null||typeof d.is_bank_client==='boolean'))throw Error('Invalid company details');
 const f=profile.finance;
 if(!record(f)||!record(f.period)||!Array.isArray(f.months)||f.months.length!==6)throw Error('Invalid company finances');
 const asOf=new Date(profile.as_of_date+'T00:00:00Z'),year=asOf.getUTCFullYear(),month=asOf.getUTCMonth();
 if(f.period.start_date!==monthDate(year,month-6,1)||f.period.end_date!==monthDate(year,month,0))throw Error('Invalid financial period');
 for(let i=0;i<6;i++){
  const row:unknown=f.months[i];
  if(!record(row)||row.month!==monthDate(year,month-6+i,1).slice(0,7)||!money(row.income_rub)||!money(row.expenses_rub)
    ||!nullableText(row.income_source)||!nullableText(row.expenses_source))throw Error('Invalid financial month');
 }
 if(!money(f.debt_payment_rub)||!nullableText(f.debt_source)||!nullableDate(f.debt_as_of)
   ||!money(f.average_income_rub)||!money(f.average_expenses_rub)
   ||(f.months.some(row=>row.income_rub===null)!==(f.average_income_rub===null))
   ||(f.months.some(row=>row.expenses_rub===null)!==(f.average_expenses_rub===null)))throw Error('Invalid financial summary');
}
