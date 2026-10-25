import type { ReactNode } from "react";
import type { DraftFields, FieldErrors, ProductCatalog } from "../../types";
import { products } from "../../products";

export interface EditableProps {
  fields: DraftFields;
  errors: FieldErrors;
  onChange: <K extends keyof DraftFields>(
    key: K,
    value: DraftFields[K],
  ) => void;
}

function errorProps(errors: FieldErrors, key: keyof DraftFields) {
  return {
    "aria-invalid": Boolean(errors[key]),
    "aria-describedby": errors[key] ? `${key}-error` : undefined,
  };
}

export function Field({
  name,
  label,
  errors,
  children,
}: {
  name: keyof DraftFields;
  label: string;
  errors: FieldErrors;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {errors[name] && (
        <span className="field-error" id={`${name}-error`}>
          {errors[name]}
        </span>
      )}
    </label>
  );
}

export function MoneyField({
  name,
  label,
  fields,
  errors,
  onChange,
}: EditableProps & {
  name: "amount_rub" | "expected_inflow_amount_rub" | "equipment_cost_rub" | "planned_payment_rub";
  label: string;
}) {
  return (
    <Field name={name} label={label} errors={errors}>
      <span className="input-with-unit">
        <input
          aria-label={label}
          type="text"
          inputMode="decimal"
          value={fields[name]}
          onChange={(event) => onChange(name, event.target.value)}
          placeholder="Укажите сумму"
          {...errorProps(errors, name)}
        />
        <span aria-hidden="true">₽</span>
      </span>
    </Field>
  );
}

export function PurposeField(props: EditableProps) {
  const equipment = props.fields.product_code === "equipment";
  return <div className="purpose-description">
    <Field name="purpose" label="На что нужны средства" errors={props.errors}>
      <textarea aria-label="На что нужны средства" value={props.fields.purpose}
        onChange={event => props.onChange("purpose", event.target.value)} maxLength={500} rows={3}
        placeholder={equipment ? "Например, купить холодильную витрину для магазина" : "Например, закупить зимнюю обувь для магазина перед сезоном"}
        {...errorProps(props.errors, "purpose")} />
    </Field>
  </div>;
}

export function ProductFields({ fields, errors, onChange, catalog }: EditableProps & {catalog?:ProductCatalog|null}) {
  const compact = (value: string) => {
    const amount = Number(value);
    return amount >= 1_000_000 ? `${new Intl.NumberFormat("ru-RU").format(amount / 1_000_000)} млн` : `${new Intl.NumberFormat("ru-RU").format(amount / 1000)} тыс.`;
  };
  return <div className="product-selector">
    <div className="product-options" role="radiogroup" tabIndex={-1} aria-label="Продукт" {...errorProps(errors, "product_code")}>
      {products.map(product => {
        const terms = catalog?.items.find(item => item.code === product.code);
        return <label key={product.code} className={`product-option ${product.tone} ${fields.product_code === product.code ? "is-selected" : ""}`}>
          <input type="radio" name="product" value={product.code} checked={fields.product_code === product.code} onChange={() => onChange("product_code", product.code)} />
          <span className="product-radio" aria-hidden="true" />
          <strong>{product.title}</strong><span className="product-description">{product.description}</span>
          <img className="product-art" src={product.image} alt="" width="180" height="180" />
          <span className="product-terms">{terms ? <><b>{compact(terms.amount_min_rub)} — {compact(terms.amount_max_rub)} ₽</b><span>{product.code === "overdraft" ? `Использование до ${terms.usage_max_days} дней` : `${terms.term_min_months}–${terms.term_max_months} месяцев`}</span><small>{terms.annual_rate_percent.replace(/\.00$/, "")}% годовых · демо</small></> : <span>Условия появятся после загрузки каталога</span>}</span>
        </label>;
      })}
    </div>
    <a className="credit-terms-link" href="/credit-terms.html" target="_blank" rel="noopener noreferrer">Полные условия финансирования ↗</a>
    {errors.product_code && <span className="field-error" id="product_code-error">{errors.product_code}</span>}
  </div>;
}

function DateField({name,label,fields,errors,onChange}:EditableProps&{name:'planned_payment_date'|'expected_inflow_date';label:string}){
 const value=fields[name],display=/^\d{4}-\d{2}-\d{2}$/.test(value)?value.slice(8,10)+'.'+value.slice(5,7)+'.'+value.slice(0,4):value;
 return <Field name={name} label={label} errors={errors}><input aria-label={label} type="text" inputMode="numeric" autoComplete="off" maxLength={10} placeholder="дд.мм.гггг" value={display} onChange={event=>{
  if(/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)){onChange(name,event.target.value);return;}
  const digits=event.target.value.replace(/\D/g,'').slice(0,8);
  const text=digits.slice(0,2)+(digits.length>2?'.'+digits.slice(2,4):'')+(digits.length>4?'.'+digits.slice(4,8):'');
  onChange(name,digits.length===8?digits.slice(4,8)+'-'+digits.slice(2,4)+'-'+digits.slice(0,2):text);
 }} {...errorProps(errors,name)}/></Field>;
}

export function ParameterFields(props: EditableProps & {includeEquipment?:boolean}) {
  const { fields, errors, onChange } = props;
  if (!fields.product_code)
    return (
      <p className="parameter-empty">
        Выберите продукт, чтобы указать срок и другие параметры. Можно вернуться
        к выбору или продолжить без этих сведений.
      </p>
    );
  const overdraft = fields.product_code === "overdraft";
  const duration = overdraft ? "usage_days" : "term_months";
  const label = overdraft ? "Пользование, дней" : "Срок, месяцев";
  return (
    <>
      {!overdraft&&<Field name={duration} label={label} errors={errors}>
        <input
          aria-label={label}
          type="text"
          inputMode="numeric"
          value={fields[duration]}
          onChange={(event) => onChange(duration, event.target.value)}
          placeholder={overdraft ? "Количество дней" : "Количество месяцев"}
          {...errorProps(errors, duration)}
        />
      </Field>}
      {overdraft && (
        <div className="overdraft-fields">
          <p className="small-note">Укажите, какую часть лимита планируете использовать и когда поступят деньги для её погашения. Проценты считаются от используемой суммы.</p>
          <div className="field-grid">
            <MoneyField {...props} name="planned_payment_rub" label="Сумма использования лимита" />
            <DateField {...props} name="planned_payment_date" label="Дата использования средств"/>
            <DateField {...props} name="expected_inflow_date" label="Дата поступления для погашения"/>
            <MoneyField
              {...props}
              name="expected_inflow_amount_rub"
              label="Сумма ожидаемого поступления"
            />
          </div>
          {fields.planned_payment_date&&fields.expected_inflow_date&&Number.isFinite(Date.parse(fields.planned_payment_date))&&Number.isFinite(Date.parse(fields.expected_inflow_date))&&<p className="small-note">Срок использования: {Math.round((Date.parse(fields.expected_inflow_date)-Date.parse(fields.planned_payment_date))/86400000)} дн. Рассчитывается по указанным датам.</p>}
          <Field name="expected_inflow_source" label="Источник ожидаемого поступления" errors={errors}>
            <select aria-label="Источник ожидаемого поступления" value={fields.expected_inflow_source} onChange={event=>onChange("expected_inflow_source", event.target.value as typeof fields.expected_inflow_source)} {...errorProps(errors,"expected_inflow_source")}>
              <option value="">Выберите источник</option><option value="BUYER">Покупатель</option><option value="CONTRACT">Договор</option><option value="REGULAR_REVENUE">Обычная выручка</option><option value="OTHER">Другое</option>
            </select>
          </Field>
        </div>
      )}
    </>
  );
}
