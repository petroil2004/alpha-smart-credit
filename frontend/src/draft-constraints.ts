import type {DraftFields,FieldErrors,ProductCatalog} from './types';
import {prepareDraftPayload} from './draft';
export function draftConstraints(fields:DraftFields,catalog?:ProductCatalog|null):FieldErrors{
 const {payload:p,errors}=prepareDraftPayload(fields),terms=catalog?.items.find(row=>row.code===fields.product_code);
 const money=(value:string)=>BigInt(value.replace('.',''));
 if(!terms)return errors;
 if(p.amount_rub&&(money(p.amount_rub)<money(terms.amount_min_rub)||money(p.amount_rub)>money(terms.amount_max_rub)))errors.amount_rub=`Укажите сумму от ${Number(terms.amount_min_rub).toLocaleString('ru-RU')} до ${Number(terms.amount_max_rub).toLocaleString('ru-RU')} ₽`;
 if(fields.product_code!=='overdraft'){
  if(p.term_months!==null&&(p.term_months<terms.term_min_months!||p.term_months>terms.term_max_months!))errors.term_months=`Срок должен быть от ${terms.term_min_months} до ${terms.term_max_months} месяцев`;
  return errors;
 }
 if(p.planned_payment_rub&&p.amount_rub&&money(p.planned_payment_rub)>money(p.amount_rub))errors.planned_payment_rub='Сумма использования не может превышать лимит';
 if(p.usage_days!==null&&(p.usage_days<terms.usage_min_days!||p.usage_days>terms.usage_max_days!))errors.expected_inflow_date=`Срок использования должен быть от ${terms.usage_min_days} до ${terms.usage_max_days} дней`;
 if(p.planned_payment_rub&&p.expected_inflow_amount_rub&&p.usage_days!==null&&p.usage_days>0&&p.usage_days<=terms.usage_max_days!){
  const cents=money(p.planned_payment_rub),rate=money(terms.annual_rate_percent),denominator=3_650_000n;
  const interest=(cents*rate*BigInt(p.usage_days)+denominator/2n)/denominator;
  if(money(p.expected_inflow_amount_rub)<cents+interest)errors.expected_inflow_amount_rub='Ожидаемое поступление должно покрыть сумму использования и проценты';
 }
 return errors;
}
