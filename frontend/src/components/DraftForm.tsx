import type { FormEvent } from "react";
import type {
  Application,
  DraftFields,
  FieldErrors,
  ProductCode,
} from "../types";
import { Icon } from "./Icon";

export const products: {
  code: ProductCode;
  title: string;
  description: string;
  number: string;
}[] = [
  {
    code: "working_capital",
    title: "Оборотный кредит",
    description: "Товар, материалы и текущие расходы",
    number: "01",
  },
  {
    code: "equipment",
    title: "Кредит на оборудование",
    description: "Всё, что помогает бизнесу расти",
    number: "02",
  },
  {
    code: "overdraft",
    title: "Овердрафт",
    description: "На время до следующего поступления",
    number: "03",
  },
];

interface Props {
  application: Application;
  fields: DraftFields;
  errors: FieldErrors;
  busy: boolean;
  saving: boolean;
  dirty: boolean;
  onChange: <K extends keyof DraftFields>(
    key: K,
    value: DraftFields[K],
  ) => void;
  onSave: () => void;
}

export default function DraftForm({
  application,
  fields,
  errors,
  busy,
  saving,
  dirty,
  onChange,
  onSave,
}: Props) {
  const overdraft = fields.product_code === "overdraft";
  const errorProps = (key: keyof DraftFields) => ({
    "aria-invalid": Boolean(errors[key]),
    "aria-describedby": errors[key] ? `${key}-error` : undefined,
  });
  const fieldError = (key: keyof DraftFields) =>
    errors[key] && (
      <span className="field-error" id={`${key}-error`}>
        {errors[key]}
      </span>
    );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave();
  };
  return (
    <div className="draft-layout">
      <form className="form-card" onSubmit={submit} noValidate>
        <fieldset disabled={busy}>
          <div className="section-heading">
            <span className="step-marker">01</span>
            <div>
              <h2>Расскажите о планах</h2>
              <p>Можно заполнить часть данных и вернуться позже.</p>
            </div>
          </div>
          <label className="field purpose-field">
            <span>На что нужны средства</span>
            <textarea
              aria-label="На что нужны средства"
              value={fields.purpose}
              onChange={(e) => onChange("purpose", e.target.value)}
              maxLength={500}
              placeholder="Например, закупить товар к новому сезону"
              rows={3}
              {...errorProps("purpose")}
            />
            <span className="field-hint">Коротко опишите задачу бизнеса.</span>
            {fieldError("purpose")}
          </label>
          <div className="field">
            <span id="product-label">Продукт</span>
            <div
              className="product-options"
              role="radiogroup"
              aria-labelledby="product-label"
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
            {fieldError("product_code")}
          </div>
          <div className="field-grid">
            <label className="field">
              <span>Сумма финансирования</span>
              <span className="input-with-unit">
                <input
                  aria-label="Сумма финансирования"
                  type="text"
                  inputMode="decimal"
                  value={fields.amount_rub}
                  onChange={(e) => onChange("amount_rub", e.target.value)}
                  placeholder="Укажите сумму"
                  {...errorProps("amount_rub")}
                />
                <span aria-hidden="true">₽</span>
              </span>
              {fieldError("amount_rub")}
            </label>
            {fields.product_code && (
              <label className="field">
                <span>{overdraft ? "Пользование, дней" : "Срок, месяцев"}</span>
                <input
                  aria-label={overdraft ? "Пользование, дней" : "Срок, месяцев"}
                  type="text"
                  inputMode="numeric"
                  value={overdraft ? fields.usage_days : fields.term_months}
                  onChange={(e) =>
                    onChange(
                      overdraft ? "usage_days" : "term_months",
                      e.target.value,
                    )
                  }
                  placeholder={
                    overdraft ? "Количество дней" : "Количество месяцев"
                  }
                  {...errorProps(overdraft ? "usage_days" : "term_months")}
                />
                {fieldError(overdraft ? "usage_days" : "term_months")}
              </label>
            )}
          </div>
          {overdraft && (
            <div className="overdraft-fields">
              <div className="small-note">
                Для овердрафта важно знать, когда поступят деньги для возврата.
              </div>
              <div className="field-grid">
                <label className="field">
                  <span>Дата ожидаемого поступления</span>
                  <input
                    aria-label="Дата ожидаемого поступления"
                    type="date"
                    value={fields.expected_inflow_date}
                    onChange={(e) =>
                      onChange("expected_inflow_date", e.target.value)
                    }
                    {...errorProps("expected_inflow_date")}
                  />
                  {fieldError("expected_inflow_date")}
                </label>
                <label className="field">
                  <span>Сумма ожидаемого поступления</span>
                  <span className="input-with-unit">
                    <input
                      aria-label="Сумма ожидаемого поступления"
                      type="text"
                      inputMode="decimal"
                      value={fields.expected_inflow_amount_rub}
                      onChange={(e) =>
                        onChange("expected_inflow_amount_rub", e.target.value)
                      }
                      placeholder="Укажите сумму"
                      {...errorProps("expected_inflow_amount_rub")}
                    />
                    <span aria-hidden="true">₽</span>
                  </span>
                  {fieldError("expected_inflow_amount_rub")}
                </label>
              </div>
            </div>
          )}
        </fieldset>
        <div className="form-actions">
          <button className="button primary" type="submit" disabled={busy}>
            {saving ? "Сохраняем…" : "Сохранить черновик"}
            {!saving && <Icon name="check" size={18} />}
          </button>
          <span className={`save-indicator ${dirty ? "has-changes" : ""}`}>
            <span className="status-dot" />
            {dirty ? "Есть несохранённые изменения" : "Изменения сохранены"}
          </span>
        </div>
      </form>
      <aside className="draft-aside">
        <div className="journey-card">
          <span className="eyebrow">ВАША ЗАЯВКА</span>
          <h2>
            От идеи
            <br />к следующему шагу
          </h2>
          <ol className="journey">
            <li className="current">
              <span>1</span>
              <div>
                <strong>Потребность бизнеса</strong>
                <small>Сейчас вы здесь</small>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Рассмотрение</strong>
                <small>После отправки заявки</small>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Предложение и оформление</strong>
                <small>После решения банка</small>
              </div>
            </li>
          </ol>
          <div className="aside-note">
            <Icon name="shield" />
            <p>
              Пока это черновик.
              <br />В банк он ещё не отправлен.
            </p>
          </div>
        </div>
        <div className="quiet-note">
          <Icon name="clock" size={17} />
          <p>
            Возвращайтесь, когда удобно. Сохранённые данные останутся в
            кабинете.
          </p>
        </div>
        <span className="version-label">
          Версия черновика {application.version}
        </span>
      </aside>
    </div>
  );
}
