import {prepareDraftPayload} from './draft';
import type {DraftFields} from './types';

// This checks required input, while credit limits and calculations stay on the server.
export function draftReadiness(fields:DraftFields) {
  const {payload,errors}=prepareDraftPayload(fields);
  const product=!!payload.product_code;
  const required:(keyof typeof payload)[]=fields.product_code==='overdraft'
    ? ['purpose','amount_rub','usage_days','planned_payment_rub','planned_payment_date','expected_inflow_date','expected_inflow_amount_rub','expected_inflow_source']
    : ['purpose','amount_rub','term_months',...(fields.product_code==='equipment'?['equipment_cost_rub' as const]:[])];
  const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
  const dates=fields.product_code!=='overdraft'||validDate(fields.planned_payment_date);
  return {product,details:product&&dates&&!Object.keys(errors).length&&required.every(key=>!!payload[key])};
}
