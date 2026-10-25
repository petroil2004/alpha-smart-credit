import {prepareDraftPayload} from './draft';
import type {DraftFields,ProductCatalog} from './types';

// This checks required input, while credit limits and calculations stay on the server.
export function draftReadiness(fields:DraftFields,catalog?:ProductCatalog|null) {
  const {payload,errors}=prepareDraftPayload(fields);
  const product=!!payload.product_code;
  const required:(keyof typeof payload)[]=fields.product_code==='overdraft'
    ? ['purpose','amount_rub','usage_days','planned_payment_rub','planned_payment_date','expected_inflow_date','expected_inflow_amount_rub','expected_inflow_source']
    : ['purpose','amount_rub','term_months',...(fields.product_code==='equipment'?['equipment_cost_rub' as const]:[])];
  const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
  const dates=fields.product_code!=='overdraft'||validDate(fields.planned_payment_date);
  const terms=catalog?.items.find(row=>row.code===fields.product_code);
  const withinPolicy=!terms||(Number(payload.amount_rub)>=Number(terms.amount_min_rub)&&Number(payload.amount_rub)<=Number(terms.amount_max_rub)&&
    (fields.product_code==='overdraft'?(Number(payload.usage_days)>=Number(terms.usage_min_days)&&Number(payload.usage_days)<=Number(terms.usage_max_days)):Number(payload.term_months)>=Number(terms.term_min_months)&&Number(payload.term_months)<=Number(terms.term_max_months)));
  const overdraftValid=fields.product_code!=='overdraft'||(Number(payload.planned_payment_rub)<=Number(payload.amount_rub)&&Number(payload.expected_inflow_amount_rub)>=Number(payload.planned_payment_rub));
  const equipmentValid=fields.product_code!=='equipment'||Number(payload.equipment_cost_rub)>=Number(payload.amount_rub);
  return {product,details:withinPolicy&&overdraftValid&&equipmentValid&&product&&dates&&!Object.keys(errors).length&&required.every(key=>!!payload[key])};
}
