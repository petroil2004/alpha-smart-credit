import { formatMoneyRub } from "../../draft";
import { sliderAmountValue } from "../../calculator";
import type { CalculatorState } from "../../hooks/useLoanCalculator";
import type { FieldErrors } from "../../types";
import { MoneyField, ParameterFields } from "./DraftFields";
import type { EditableProps } from "./DraftFields";

export function LoanCalculationSummary({state,onReauthenticate}:{state:CalculatorState;onReauthenticate?:()=>void}) {
  if(state.status==="unsupported") return <p className="small-note">Калькулятор овердрафта пока недоступен.</p>;
  const result=state.result;
  return <section className="loan-summary" aria-label="Предварительный расчёт платежа" aria-busy={state.status==="loading"}>
    <h3>Предварительный расчёт платежа</h3>
    <div aria-live="polite">
      {result ? <dl className="loan-results">
        <div className="loan-payment"><dt>Ежемесячный платёж</dt><dd>{formatMoneyRub(result.monthly_payment_rub)}</dd></div>
        <div><dt>Годовая ставка</dt><dd>{result.annual_rate_percent.replace(".00","")}%</dd></div>
        <div><dt>Общая сумма выплат</dt><dd>{formatMoneyRub(result.total_payment_rub)}</dd></div>
        <div><dt>Переплата</dt><dd>{formatMoneyRub(result.overpayment_rub)}</dd></div>
      </dl> : <p className={state.status==="error"?"field-error":"small-note"}>
        {state.message??(state.catalogStatus==="loading"?"Загружаем условия…":state.status==="loading"?"Рассчитываем платёж…":state.status==="invalid"?"Уточните параметры для расчёта. Неполные данные сохраняются.":"Укажите сумму и срок, чтобы увидеть платёж.")}
      </p>}
    </div>
    {state.status==="error" && <div className="calculator-actions">
      {state.authenticationRequired && onReauthenticate ? <button type="button" className="text-button" onClick={onReauthenticate}>Войти снова</button> : <>
        {state.catalogStatus!=="error" && <button type="button" className="text-button" onClick={state.retryCalculation}>Повторить расчёт</button>}
        <button type="button" className="text-button" onClick={state.retryCatalog}>Повторить загрузку условий</button>
      </>}
    </div>}
    <img className="calculation-art" src="/images/credit/hero.png" alt="" width="200" height="200" />
    <p className="calculator-disclaimer">Демонстрационные условия. Без комиссий и дополнительных платных услуг. Расчёт не означает одобрения кредита. Итог рассчитан как равный платёж × число месяцев; полный график не строится.</p>
  </section>;
}

export default function LoanCalculator({fields,onChange,state,errors:saveErrors={},onReauthenticate}:Pick<EditableProps,"fields"|"onChange"> & {state:CalculatorState;errors?:FieldErrors;onReauthenticate?:()=>void}) {
  const product=state.catalog?.items.find(p=>p.code===fields.product_code);
  const errors={...state.errors,...saveErrors};
  const props={fields,onChange,errors};
  const term=Number(fields.term_months);
  return <div className="loan-calculator">
    <div className="loan-controls">
    <div className="loan-control-group"><MoneyField {...props} name="amount_rub" label="Сумма финансирования"/>
    {product && <div className="slider-control">
      <input type="range" aria-label="Сумма финансирования, ползунок" min={product.amount_min_rub} max={product.amount_max_rub} step={product.amount_step_rub} value={sliderAmountValue(fields.amount_rub,product)} onChange={e=>onChange("amount_rub",Number(e.target.value).toFixed(2))}/>
      <div className="slider-limits"><span>{formatMoneyRub(product.amount_min_rub)}</span><span>{formatMoneyRub(product.amount_max_rub)}</span></div>
    </div>}
    </div>
    <div className="loan-control-group"><ParameterFields {...props} includeEquipment={false}/>
    {product && product.term_min_months!==null && product.term_max_months!==null && <div className="slider-control">
      <input type="range" aria-label="Срок, месяцев, ползунок" min={product.term_min_months} max={product.term_max_months} step={1} value={Number.isSafeInteger(term)?Math.max(product.term_min_months,Math.min(product.term_max_months,term)):product.term_min_months} onChange={e=>onChange("term_months",e.target.value)}/>
      <div className="slider-limits"><span>{product.term_min_months} мес.</span><span>{product.term_max_months} мес.</span></div>
    </div>}
    </div>
    {fields.product_code==="equipment"&&<div className="loan-control-group"><MoneyField {...props} name="equipment_cost_rub" label="Стоимость оборудования"/></div>}
    </div>
    <LoanCalculationSummary state={state} onReauthenticate={onReauthenticate}/>
  </div>;
}
