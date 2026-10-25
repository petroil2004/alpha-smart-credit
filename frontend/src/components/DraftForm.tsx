import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Api, Application, CompanyProfile, ClientSession } from "../types";
import { useLoanCalculator } from "../hooks/useLoanCalculator";
import LoanCalculator, { LoanCalculationSummary } from "./draft/LoanCalculator";
import ApplicationJourney from "./ApplicationJourney";
import {draftConstraints} from '../draft-constraints';
import {draftReadiness} from "../draft-readiness";
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
import {sameSession} from "../session";
import {validateCompanyProfile} from "../company-profile";
import { Icon } from "./Icon";
import type { SaveState } from "../autosave";

interface Props extends EditableProps {
  api: Api;
  application: Application;
  companyName: string;
  session: ClientSession;
  errorAttempt: number;
  busy: boolean;
  saveStatus: SaveState["status"];
  resetVersion: number;
  onSubmitApplication: (versions: {profile_version:string;catalog_version:string}) => void;
  onSessionChanged: () => void;
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
  } = props;
  const [profile,setProfile]=useState<CompanyProfile|null>(null);
  const [profileError,setProfileError]=useState<string|null>(null);
  const [profileAttempt,setProfileAttempt]=useState(0);
  const [confirmedStamp,setConfirmedStamp]=useState<string|null>(null);
  useEffect(()=>{
    let active=true;
    setProfile(null);setProfileError(null);
    (async()=>{
      const before=await props.api.me();
      if(!active)return;
      if(!sameSession(before,props.session)){props.onSessionChanged();return;}
      const value=await props.api.companyProfile();
      const after=await props.api.me();
      if(!active)return;
      if(!sameSession(after,props.session)||value.company_id!==application.company_id){props.onSessionChanged();return;}
      validateCompanyProfile(value);
      setProfile(value);
    })().catch(()=>{if(active)setProfileError('Не удалось загрузить сведения компании. Повторите загрузку.');});
    return()=>{active=false;};
  },[props.api,application.id,profileAttempt,props.resetVersion,props.session.user.id,props.session.company.id]);
  const [stepError,setStepError]=useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [step, setStep] = useState<DraftStep>("product");
  const lastErrorAttempt = useRef(errorAttempt);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const index = draftSteps.findIndex((item) => item.id === step);
  const current = draftSteps[index];
  const last = index === draftSteps.length - 1;
  const calculator = useLoanCalculator(props.api, fields, application.id);
  const constraints=draftConstraints(fields,calculator.catalog);
  const editableProps={...props,errors:{...errors,...constraints}};
  const readiness=draftReadiness(fields,calculator.catalog);
  const canVisit=(next:DraftStep)=>next==='product'||(next==='details'?readiness.product:readiness.details&&!Object.keys(constraints).length);
  const previousReset=useRef(props.resetVersion);
  useEffect(()=>{
    if(previousReset.current===props.resetVersion)return;
    previousReset.current=props.resetVersion;
    setConfirmedStamp(null);
    calculator.retryCatalog();
  },[props.resetVersion]);
  const reauthenticate = () => props.onReauthenticate(()=>{calculator.retryCatalog();setProfileAttempt(n=>n+1);setConfirmedStamp(null);});
  const confirmationStamp=JSON.stringify([fields,profile?.profile_version,calculator.catalog?.catalog_version,props.resetVersion]);
  useEffect(()=>{setConfirmedStamp(null);},[confirmationStamp]);
  const calculationReady=fields.product_code==='overdraft' || (calculator.status==='ready' && !!calculator.result);
  const confirmed=confirmedStamp===confirmationStamp;
  const profileNotice=profileError?<p role="alert">{profileError} <button type="button" className="text-button" onClick={()=>setProfileAttempt(n=>n+1)}>Повторить загрузку сведений</button></p>:null;

  useEffect(() => {
    if (lastErrorAttempt.current === errorAttempt) return;
    lastErrorAttempt.current = errorAttempt;
    const owner = draftSteps.find((item) =>
      item.fields.some((field) => errors[field]),
    );
    if (owner) setStep(owner.id);
  }, [errors, errorAttempt]);

  useEffect(()=>{
    if(step!=="review")return;
    const owner=draftSteps.find(item=>item.fields.some(field=>errors[field]));
    if(owner)setStep(owner.id);
  },[errors,step]);

  useEffect(() => {
    const invalid = form.current?.querySelector<HTMLElement>(
      '[aria-invalid="true"]',
    );
    if (invalid) invalid.focus();
    else heading.current?.focus();
  }, [step, errorAttempt]);

  const goTo = (next: DraftStep) => {
    if(busy)return;
    if(!canVisit(next)){setStepError(true);return;}
    setStepError(false);props.onNavigate();setStep(next);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!last) goTo(draftSteps[index + 1].id);
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
                  disabled={busy || !canVisit(item.id)}
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
              <p>{current.description}</p>
            </div>
            {step === "product" && <>
              <ProductFields {...editableProps} catalog={calculator.catalog} />
              <AssistantPreview open={assistantOpen} onToggle={() => setAssistantOpen(value => !value)} api={props.api} session={props.session} applicationId={application.id} onSelect={code=>{
                props.onChange('product_code',code);
                const choices=form.current?.querySelector<HTMLElement>('.product-options');
                choices?.scrollIntoView?.({behavior:'smooth',block:'start'});
                form.current?.querySelector<HTMLInputElement>(`input[name="product"][value="${code}"]`)?.focus({preventScroll:true});
              }} onSessionChanged={props.onSessionChanged}/>
            </>}
            {step === "details" && (
              <>
                {fields.product_code && fields.product_code !== "overdraft"
                  ? <LoanCalculator fields={fields} onChange={props.onChange} errors={errors} state={calculator} onReauthenticate={reauthenticate}/>
                  : <><MoneyField {...editableProps} name="amount_rub" label="Лимит овердрафта" /><ParameterFields {...editableProps} />{fields.product_code === "overdraft" && <p className="small-note">При отправке заявки проверим покрытие поступлением и рассчитаем проценты за указанный срок.</p>}</>}
                <PurposeField {...editableProps} />
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
              <>{profileNotice}<DraftReview fields={fields} onEdit={goTo} busy={busy} />
              {fields.product_code && <LoanCalculationSummary state={calculator} onReauthenticate={reauthenticate}/>}
              {fields.product_code ? <label className="submission-confirmation"><input type="checkbox" checked={confirmed} disabled={busy || !profile || !calculator.catalog || !calculationReady} onChange={e=>setConfirmedStamp(e.target.checked?confirmationStamp:null)}/><span>Подтверждаю актуальность указанных сведений и выбранные параметры заявки</span></label> : null}
              </>
            )}
          </fieldset>
          {!last && !canVisit(draftSteps[index+1].id) && <p className="small-note">{step==='product'?'Выберите продукт, чтобы продолжить.':'Заполните цель и обязательные параметры финансирования, чтобы перейти к проверке.'}</p>}
          {stepError&&<p role="alert" className="field-error step-validation">Корректно заполните все обязательные поля, чтобы перейти к следующему шагу.</p>}
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
            {last && fields.product_code && <button className="button primary" type="button" disabled={busy || !confirmed || !profile || !calculator.catalog || !calculationReady} onClick={()=>{
              if(profile && calculator.catalog && confirmed && calculationReady)props.onSubmitApplication({profile_version:profile.profile_version,catalog_version:calculator.catalog.catalog_version});
            }}>{busy ? 'Отправляем…' : 'Отправить заявку'}</button>}
            {!last && (
              <button
                className="button primary wizard-next"
                aria-disabled={!canVisit(draftSteps[index+1].id)}
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
        <ApplicationJourney status="DRAFT" step={`Шаг ${index+1} из ${draftSteps.length}: ${current.label.toLowerCase()}`}/>
        <div className="aside-note"><Icon name="shield"/><p>Заявка ещё не отправлена в банк.</p></div>
        <div className="quiet-note">
          <Icon name="clock" size={17} />
          <p>
            Изменения сохраняются автоматически. Перед выходом убедитесь,
            что отображается «Изменения сохранены».
          </p>
        </div>

      </aside>
    </div>
  );
}
