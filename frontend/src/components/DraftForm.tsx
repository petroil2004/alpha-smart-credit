import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Api, Application } from "../types";
import { useLoanCalculator } from "../hooks/useLoanCalculator";
import LoanCalculator, { LoanCalculationSummary } from "./draft/LoanCalculator";
import { draftSteps } from "../draft-steps";
import type { DraftStep } from "../draft-steps";
import {
  MoneyField,
  PurposeField,
  ParameterFields,
  ProductFields,
} from "./draft/DraftFields";
import type { EditableProps } from "./draft/DraftFields";
import DraftReview from "./draft/DraftReview";
import AssistantPreview from "./draft/AssistantPreview";
import { Icon } from "./Icon";
import type { SaveState } from "../autosave";

interface Props extends EditableProps {
  api: Api;
  application: Application;
  companyName: string;
  errorAttempt: number;
  busy: boolean;
  saveStatus: SaveState["status"];
  onFinish: () => void;
  onNavigate: () => void;
  onReauthenticate: (after:()=>void) => void;
}

export default function DraftForm(props: Props) {
  const {
    application,
    fields,
    errors,
    errorAttempt,
    busy,
    saveStatus,
    onFinish,
  } = props;
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [step, setStep] = useState<DraftStep>("product");
  const lastErrorAttempt = useRef(errorAttempt);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const index = draftSteps.findIndex((item) => item.id === step);
  const current = draftSteps[index];
  const last = index === draftSteps.length - 1;
  const calculator = useLoanCalculator(props.api, fields, application.id);
  const reauthenticate = () => props.onReauthenticate(calculator.retryCatalog);

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
    if (!busy) { props.onNavigate(); setStep(next); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (last) onFinish();
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
          className={`form-card wizard-card wizard-${step}`}
          onSubmit={submit}
          noValidate
        >
          <fieldset disabled={busy}>
            <div className="section-heading">
              <h1 ref={heading} tabIndex={-1}>{current.title}</h1>
              <p>{step === "details" ? "Выберите подходящие сумму и срок. Расчёт обновится автоматически." : current.description}</p>
            </div>
            {step === "product" && <>
              <ProductFields {...props} catalog={calculator.catalog} />
              <AssistantPreview open={assistantOpen} onToggle={() => setAssistantOpen(value => !value)} />
            </>}
            {step === "details" && (
              <>
                {fields.product_code && fields.product_code !== "overdraft"
                  ? <LoanCalculator fields={fields} onChange={props.onChange} errors={errors} state={calculator} onReauthenticate={reauthenticate}/>
                  : <><MoneyField {...props} name="amount_rub" label="Сумма финансирования" /><ParameterFields {...props} />{fields.product_code === "overdraft" && <p className="small-note">Калькулятор овердрафта пока недоступен.</p>}</>}
                <PurposeField {...props} />
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
              {fields.product_code && <LoanCalculationSummary state={calculator} onReauthenticate={reauthenticate}/>}</>
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
            {last && <button
              className="button primary wizard-next"
              type="button"
              disabled={busy}
              onClick={onFinish}
            >
              {busy ? "Сохраняем…" : "Сохранить и выйти"}
              {!busy && <Icon name="check" size={18} />}
            </button>}
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
            className={`save-indicator wizard-save-indicator ${saveStatus !== "saved" ? "has-changes" : ""}`}
            role="status"
            aria-label="Состояние сохранения"
          >
            <span className="status-dot" />
            {saveStatus === "saved" ? "Изменения сохранены" : saveStatus === "saving" ? "Сохраняем…" : saveStatus === "error" ? "Не удалось сохранить изменения" : saveStatus === "invalid" ? "Уточните поля: часть изменений не сохранена" : "Есть несохранённые изменения"}
          </div>
        </form>
      </div>
      <aside className="draft-aside">
        <div className="journey-card">
          <h2>Путь заявки</h2>
          <ol className="journey">
            <li className="current">
              <span>1</span>
              <div>
                <strong>Подготовка заявки</strong>
                <small>
                  Шаг {index + 1} из {draftSteps.length}: {current.label.toLowerCase()}
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
              Заявка ещё не отправлена в банк.
            </p>
          </div>
        </div>
        <div className="quiet-note">
          <Icon name="clock" size={17} />
          <p>
            Изменения сохраняются автоматически. Перед выходом убедитесь,
            что отображается «Изменения сохранены».
          </p>
        </div>
        <span className="version-label">
          Версия заявки {application.version}
        </span>
      </aside>
    </div>
  );
}
