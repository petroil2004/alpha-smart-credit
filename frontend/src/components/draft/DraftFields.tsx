import type { ReactNode } from "react";
import type { DraftFields, FieldErrors } from "../../types";
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

function Field({
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

function MoneyField({
  name,
  label,
  fields,
  errors,
  onChange,
}: EditableProps & {
  name: "amount_rub" | "expected_inflow_amount_rub";
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

export function NeedFields(props: EditableProps) {
  return (
    <>
      <Field name="purpose" label="На что нужны средства" errors={props.errors}>
        <textarea
          aria-label="На что нужны средства"
          value={props.fields.purpose}
          onChange={(event) => props.onChange("purpose", event.target.value)}
          maxLength={500}
          placeholder="Например, закупить товар к новому сезону"
          rows={3}
          {...errorProps(props.errors, "purpose")}
        />
        <span className="field-hint">Коротко опишите задачу бизнеса.</span>
      </Field>
      <MoneyField {...props} name="amount_rub" label="Сумма финансирования" />
    </>
  );
}

export function ProductFields({ fields, errors, onChange }: EditableProps) {
  return (
    <div className="field">
      <span id="product-label">Продукт</span>
      <div
        className="product-options"
        role="radiogroup"
        tabIndex={-1}
        aria-labelledby="product-label"
        {...errorProps(errors, "product_code")}
      >
        {products.map((product) => (
          <label
            key={product.code}
            className={`product-option ${fields.product_code === product.code ? "is-selected" : ""}`}
          >
            <input
              type="radio"
              name="product"
              value={product.code}
              checked={fields.product_code === product.code}
              onChange={() => onChange("product_code", product.code)}
            />
            <span className="product-radio" aria-hidden="true" />
            <span>
              <strong>{product.title}</strong>
              <small>{product.description}</small>
            </span>
          </label>
        ))}
      </div>
      {errors.product_code && (
        <span className="field-error" id="product_code-error">
          {errors.product_code}
        </span>
      )}
    </div>
  );
}

export function ParameterFields(props: EditableProps) {
  const { fields, errors, onChange } = props;
  if (!fields.product_code)
    return (
      <p className="parameter-empty">
        Выберите продукт, чтобы указать срок и другие параметры. Можно вернуться
        к выбору или сохранить черновик без этих сведений.
      </p>
    );
  const overdraft = fields.product_code === "overdraft";
  const duration = overdraft ? "usage_days" : "term_months";
  const label = overdraft ? "Пользование, дней" : "Срок, месяцев";
  return (
    <>
      <Field name={duration} label={label} errors={errors}>
        <input
          aria-label={label}
          type="text"
          inputMode="numeric"
          value={fields[duration]}
          onChange={(event) => onChange(duration, event.target.value)}
          placeholder={overdraft ? "Количество дней" : "Количество месяцев"}
          {...errorProps(errors, duration)}
        />
      </Field>
      {overdraft && (
        <div className="overdraft-fields">
          <p className="small-note">
            Для овердрафта важно знать, когда поступят деньги для возврата.
          </p>
          <div className="field-grid">
            <Field
              name="expected_inflow_date"
              label="Дата ожидаемого поступления"
              errors={errors}
            >
              <input
                aria-label="Дата ожидаемого поступления"
                type="date"
                value={fields.expected_inflow_date}
                onChange={(event) =>
                  onChange("expected_inflow_date", event.target.value)
                }
                {...errorProps(errors, "expected_inflow_date")}
              />
            </Field>
            <MoneyField
              {...props}
              name="expected_inflow_amount_rub"
              label="Сумма ожидаемого поступления"
            />
          </div>
        </div>
      )}
    </>
  );
}
