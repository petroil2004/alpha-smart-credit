import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Api, Application } from "../types";
import { useLoanCalculator } from "../hooks/useLoanCalculator";
import LoanCalculator, { LoanCalculationSummary } from "./draft/LoanCalculator";
import { draftSteps } from "../draft-steps";
import type { DraftStep } from "../draft-steps";
import {
  NeedFields,
  ParameterFields,
  ProductFields,
} from "./draft/DraftFields";
import type { EditableProps } from "./draft/DraftFields";
import DraftReview from "./draft/DraftReview";
import { Icon } from "./Icon";

interface Props extends EditableProps {
  api: Api;
  application: Application;
  companyName: string;
  errorAttempt: number;
  busy: boolean;
  saving: boolean;
  dirty: boolean;
  onSave: () => void;
}

export default function DraftForm(props: Props) {
  const {
    application,
    companyName,
    fields,
    errors,
    errorAttempt,
    busy,
    saving,
    dirty,
    onSave,
  } = props;
  const [step, setStep] = useState<DraftStep>("need");
  const lastErrorAttempt = useRef(errorAttempt);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const index = draftSteps.findIndex((item) => item.id === step);
  const current = draftSteps[index];
  const last = index === draftSteps.length - 1;
  const calculator = useLoanCalculator(props.api, fields, application.id);

  useEffect(() => {
    if (lastErrorAttempt.current === errorAttempt) return;
    lastErrorAttempt.current = errorAttempt;
    const owner = draftSteps.find((item) =>
      item.fields.some((field) => errors[field]),
    );
    if (owner) setStep(owner.id);
  }, [errors, errorAttempt]);

  useEffect(() => {
    const invalid = form.current?.querySelector<HTMLElement>(
      '[aria-invalid="true"]',
    );
    if (invalid) invalid.focus();
    else heading.current?.focus();
  }, [step, errorAttempt]);

  const goTo = (next: DraftStep) => {
    if (!busy) setStep(next);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (last) onSave();
    else goTo(draftSteps[index + 1].id);
  };

  return (
    <div className="draft-layout">
      <div className="wizard-main">
        <nav className="draft-stepper" aria-label="Шаги оформления">
          <ol>
            {draftSteps.map((item, position) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Перейти к шагу «${item.label}»`}
                  aria-current={step === item.id ? "step" : undefined}
                  className={`step-button ${step === item.id ? "is-current" : ""} ${item.fields.some((field) => errors[field]) ? "has-error" : ""}`}
                  onClick={() => goTo(item.id)}
                >
                  <span className="step-number">{position + 1}</span>
                  <span>{item.label}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <form
          ref={form}
          className="form-card wizard-card"
          onSubmit={submit}
          noValidate
        >
          <fieldset disabled={busy}>
            <div className="company-context">
              <Icon name="building" size={19} />
              <div>
                <span>Ваша компания</span>
                <strong>{companyName}</strong>
              </div>
            </div>
            <div className="section-heading">
              <span className="step-marker">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h2 ref={heading} tabIndex={-1}>
                  {current.title}
                </h2>
                <p>{current.description}</p>
              </div>
            </div>
            {step === "need" && <NeedFields {...props} />}
            {step === "product" && <ProductFields {...props} catalog={calculator.catalog} />}
            {step === "details" && (
              <>
                {fields.product_code && fields.product_code !== "overdraft"
                  ? <LoanCalculator fields={fields} onChange={props.onChange} errors={errors} state={calculator}/>
                  : <ParameterFields {...props} />}
                {!fields.product_code && (
                  <button
                    className="text-button choose-product"
                    type="button"
                    onClick={() => goTo("product")}
                  >
                    Выбрать продукт
                  </button>
                )}
              </>
            )}
            {step === "review" && (
              <><DraftReview fields={fields} onEdit={goTo} busy={busy} />
              {fields.product_code && <LoanCalculationSummary state={calculator}/>}</>
            )}
          </fieldset>
          <div className="wizard-navigation">
            {index > 0 && (
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => goTo(draftSteps[index - 1].id)}
              >
                Назад
              </button>
            )}
            <button
              className={`button ${last ? "primary wizard-next" : "secondary"}`}
              type="button"
              disabled={busy}
              onClick={onSave}
            >
              {saving ? "Сохраняем…" : "Сохранить черновик"}
              {!saving && <Icon name="check" size={18} />}
            </button>
            {!last && (
              <button
                className="button primary wizard-next"
                type="submit"
                disabled={busy}
              >
                Продолжить
                <Icon name="arrow" size={18} />
              </button>
            )}
          </div>
          <div
            className={`save-indicator wizard-save-indicator ${dirty ? "has-changes" : ""}`}
          >
            <span className="status-dot" />
            {dirty ? "Есть несохранённые изменения" : "Изменения сохранены"}
          </div>
        </form>
      </div>
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
                <strong>Подготовка черновика</strong>
                <small>
                  Шаг {index + 1} из {draftSteps.length}:{" "}
                  {current.label.toLowerCase()}
                </small>
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
            Переходы между шагами сохраняют ввод на экране. Чтобы вернуться к
            нему позже, сохраните черновик.
          </p>
        </div>
        <span className="version-label">
          Версия черновика {application.version}
        </span>
      </aside>
    </div>
  );
}
