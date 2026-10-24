import {expect,it} from 'vitest';
import {validateCompanyProfile} from './company-profile';
import {companyProfile} from './test/company-fixtures';

it.each([
 ['details',null],['finance',null],['as_of_date',undefined],['prepared_on',undefined],['data_version',42],['company_id',undefined],
])('rejects damaged live field %s', (field,value)=>{
 const p=companyProfile();Object.assign(p,{[field]:value});expect(()=>validateCompanyProfile(p)).toThrow();
});
it.each([
 ['legal_form',false],['tax_id',10],['okved',{}],['registration_status',[]],['is_bank_client','false'],['is_bank_client',undefined],['registration_date','2026-02-30'],['business_age_months',undefined],
])('rejects damaged company detail %s', (field,value)=>{
 const p=companyProfile();Object.assign(p.details!,{[field]:value});expect(()=>validateCompanyProfile(p)).toThrow();
});
it.each(['mid-month start','wrong end','wrong as-of period','missing row source','wrong debt date','partial income average','partial expenses average'])('rejects inconsistent finances: %s',damage=>{
 const p=companyProfile(),f=p.finance!;
 if(damage==='mid-month start')f.period.start_date='2026-04-02';
 if(damage==='wrong end')f.period.end_date='2026-09-29';
 if(damage==='wrong as-of period')p.as_of_date='2026-11-01';
 if(damage==='missing row source')Reflect.deleteProperty(f.months[0],'income_source');
 if(damage==='wrong debt date')f.debt_as_of='yesterday';
 if(damage==='partial income average')f.months[0].income_rub=null;
 if(damage==='partial expenses average')f.months[0].expenses_rub=null;
 expect(()=>validateCompanyProfile(p)).toThrow();
});
it('accepts explicitly unknown data and confirmed zero without calculating averages in the browser',()=>{
 const p=companyProfile();p.details={legal_form:null,tax_id:null,okved:null,registration_date:null,business_age_months:null,registration_status:null,is_bank_client:null};p.prepared_on=null;p.data_version=null;
 const f=p.finance!;f.months[0].expenses_rub=null;f.months[0].expenses_source=null;f.average_expenses_rub=null;f.months[1].income_rub='0.00';
 f.debt_payment_rub=null;f.debt_source=null;f.debt_as_of=null;
 expect(()=>validateCompanyProfile(p)).not.toThrow();
});
it('accepts the six complete months crossing a year and leap February',()=>{
 const p=companyProfile(),f=p.finance!;p.as_of_date='2024-03-01';f.period={start_date:'2023-09-01',end_date:'2024-02-29'};
 f.months.forEach((row,i)=>{row.month=new Date(Date.UTC(2023,8+i,1)).toISOString().slice(0,7);});expect(()=>validateCompanyProfile(p)).not.toThrow();
});
