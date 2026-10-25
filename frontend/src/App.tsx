import {applicationNumber} from "./application-number";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Api,
  Application,
  DraftFields,
  FieldErrors,
  Session,
  ProductCode,
} from "./types";
import { ApiError, createApi } from "./api";
import {
  DraftValidationError,
  emptyDraft,
  fromApplication,
} from "./draft";
import { useDraftAutosave } from "./hooks/useDraftAutosave";
import DraftForm from "./components/DraftForm";
import ApplicationsList from "./components/ApplicationsList";
import DeleteDraftDialog from "./components/DeleteDraftDialog";
import SubmittedApplication from "./components/SubmittedApplication";
import StatusBadge from './components/StatusBadge';
import StaffApplications from "./components/StaffApplications";
import {demoAccounts} from "./demo-accounts";
import {sameSession} from "./session";
import {readAttempt,saveAttempt,clearAttempt} from "./submission";
import type {SubmissionAttempt} from "./submission";
import { Icon } from "./components/Icon";

import InfoRequests from "./components/InfoRequests";
import type {InfoController} from "./components/InfoRequests";
import FundingPanel from "./components/FundingPanel";
import ReviewPanel from './components/ReviewPanel';
import ApplicationJourney from "./components/ApplicationJourney";
import ClientNotifications from "./components/ClientNotifications";
import StaffProfilePage from "./components/StaffProfilePage";
import CompanyProfilePage from './components/CompanyProfilePage';

const defaultApi = createApi();
const asError = (error: unknown) =>
  error instanceof ApiError
    ? error
    : new ApiError(
        0,
        "UNKNOWN_ERROR",
        "Не удалось выполнить действие. Попробуйте ещё раз.",
      );
function selectedFromUrl() {
  try {
    return window.location.hash.startsWith("#draft/")
      ? decodeURIComponent(window.location.hash.slice(7))
      : null;
  } catch {
    return null;
  }
}
function setUrl(id?: string) {
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${id ? `#draft/${encodeURIComponent(id)}` : ""}`,
  );
}

export default function App({ api = defaultApi }: { api?: Api }) {
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef=useRef<Session|null>(null);
  const acceptSession=(value:Session)=>{sessionRef.current=value;setSession(value);};
  const [pendingSubmit,setPendingSubmit]=useState<SubmissionAttempt|null>(null);
  const [receiptBlocked,setReceiptBlocked]=useState(false);
  const [booting, setBooting] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState("");
  const lock = useRef(false);
  const [items, setItems] = useState<Application[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Application | null>(null);
  const [selected, setSelected] = useState<Application | null>(null);
  const [profilePage,setProfilePage]=useState(()=>['#company-profile','#staff-profile'].includes(window.location.hash));
  const [fields, setFields] = useState<DraftFields>(emptyDraft);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [fieldErrorAttempt, setFieldErrorAttempt] = useState(0);
  const [purposeReset, setPurposeReset] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState("");
  const [account, setAccount] = useState("demo-client-1");
  const createKey = useRef<string | null>(null);
  const infoController=useRef<InfoController|null>(null);
  const [infoDirty,setInfoDirty]=useState(false);
  const registerInfo=useCallback((controller:InfoController|null)=>{infoController.current=controller;setInfoDirty(controller?.dirty??false);},[]);

  const clearProfile = () => {
    setProfilePage(false);
    infoController.current=null;setInfoDirty(false);
    sessionRef.current=null;
    setSession(null);
    setPendingSubmit(null);
    setReceiptBlocked(false);
    setDeleteTarget(null);
    setItems([]);
    setSelected(null);
    setFields(emptyDraft());
    setFieldErrors({});
    setNotice("");
    createKey.current = null;
    setUrl();
  };
  const requireCompany = (
    companyId: string,
    expected = sessionRef.current?.company?.id,
  ) => {
    if (!expected || companyId !== expected) {
      clearProfile();
      throw new ApiError(
        401,
        "SESSION_CHANGED",
        "Профиль изменился в другом окне. Войдите в кабинет заново.",
      );
    }
  };
  const verifySession = async (expected=sessionRef.current) => {
    const current = await api.me();
    if (!expected || !sameSession(current,expected)) {
      clearProfile();
      throw new ApiError(401,"SESSION_CHANGED","Профиль изменился в другом окне. Войдите в кабинет заново.");
    }
    return current;
  };
  const listFor=(current:Session)=>current.company ? api.list() : api.staffList();
  const getFor=(id:string,current:Session)=>current.company ? api.get(id) : api.staffGet(id);
  const adopt = (application: Application, expected = sessionRef.current) => {
    if(!expected) return;
    if(expected.company) requireCompany(application.company_id,expected.company.id);
    setProfilePage(false);
    setSelected(application);
    setFields(fromApplication(application));
    setFieldErrors({});
    setReceiptBlocked(false);
    setPendingSubmit(null);
    if(expected.company) {
      if(application.status!=='DRAFT') clearAttempt(expected.user.id,application.id);
      else {
        try{setPendingSubmit(readAttempt(expected.user.id,application.id));}
        catch(issue){setReceiptBlocked(true);setError(asError(issue));}
      }
    }
    setUrl(application.id);
  };
  const upsert = (application: Application) => {
    if(sessionRef.current?.company)requireCompany(application.company_id);
    setItems((current) =>
      [
        application,
        ...current.filter((item) => item.id !== application.id),
      ].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    );
  };
  const autosave = useDraftAutosave({
    api, application: session?.company ? selected : null, fields, reset: purposeReset, userId:session?.user.id,
    onSaved: (application) => { upsert(application); setSelected(application); },
    onScopeChanged: clearProfile,
  });
  const dirty = autosave.dirty || autosave.status === "saving" || infoDirty;

  useEffect(() => {
    let active = true;
    setBooting(true);
    setError(null);
    (async () => {
      try {
        const current = await api.me();
        const list = await listFor(current);
        await verifySession(current);
        if (!active) return;
        if(current.company) list.items.forEach((item) => requireCompany(item.company_id,current.company!.id));
        acceptSession(current);
        setItems(list.items);
        setAccount(current.user.id);
        const id = selectedFromUrl();
        if (id) {
          try {
            const application = await getFor(id,current);
            await verifySession(current);
            if (active) adopt(application,current);
          } catch (issue) {
            if (active) {
              setUrl();
              setError(asError(issue));
            }
          }
        }
      } catch (issue) {
        if (active) {
          clearProfile();
          if (!(issue instanceof ApiError && issue.code === "UNAUTHENTICATED"))
            setError(asError(issue));
        }
      } finally {
        if (active) setBooting(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [api, attempt]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function run(name: string, action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(name);
    setError(null);
    setNotice("");
    try {
      await action();
    } catch (issue) {
      setFieldErrorAttempt((value) => value + 1);
      if (issue instanceof DraftValidationError) {
        setFieldErrors(issue.fields);
        setError(new ApiError(422, "VALIDATION_ERROR", issue.message));
      } else {
        const problem = asError(issue);
        setError(problem);
        setFieldErrors(problem.fields);
      }
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  const allowDiscard = () =>
    !dirty ||
    window.confirm(
      "Есть несохранённые изменения. Продолжить без их сохранения?",
    );
  const login = () =>
    run("login", async () => {
      const current = await api.login(account);
      const list = await listFor(current);
      await verifySession(current);
      if(current.company)list.items.forEach(item=>requireCompany(item.company_id,current.company!.id));
      acceptSession(current);
      setItems(list.items);
      setSelected(null);
      setFields(emptyDraft());
      setFieldErrors({});
      createKey.current = null;
      const id = selectedFromUrl();
      if (id) {
        try {
          const application=await getFor(id,current);
          await verifySession(current);
          adopt(application,current);
        } catch (issue) {
          setUrl();
          setError(asError(issue));
        }
      }
    });
  const closeApplication = () => {
    setProfilePage(false);
    setPendingSubmit(null);
    setReceiptBlocked(false);
    setSelected(null);
    setFields(emptyDraft());
    setFieldErrors({});
    setError(null);
    setNotice("");
    setUrl();
  };
  const leave = (name: string, action: () => Promise<void> | void) => {
    void run(name, async () => {
      if (selected && (!await autosave.flush() || (infoController.current&&!await infoController.current.flush())) && !window.confirm("Не все изменения сохранены. Выйти без их сохранения?")) return;
      await action();
    });
  };
  const logout = () => leave("logout", async () => { await api.logout(); clearProfile(); });
  const showList = () => leave("leave", closeApplication);
  const showCompanyProfile=()=>leave('profile',async()=>{
    await verifySession();closeApplication();setProfilePage(true);
    window.history.replaceState(null,'',`${window.location.pathname}${window.location.search}${sessionRef.current?.company?"#company-profile":"#staff-profile"}`);
  });
  const open = (id: string) => {
    if (busy || !allowDiscard()) return;
    void run("open", async () => {
      await verifySession();
      const current=sessionRef.current!;
      const application=await getFor(id,current);
      await verifySession(current);
      adopt(application,current);
    });
  };
  const openNotification=async(item:import('./types').ClientNotification)=>{
    let opened=false;
    await run('notification',async()=>{
      if(selected&&(!await autosave.flush()||(infoController.current&&!await infoController.current.flush()))&&!window.confirm('Не все изменения сохранены. Выйти без их сохранения?'))return;
      await verifySession();const current=sessionRef.current!;
      const application=await getFor(item.application_id,current);
      await verifySession(current);
      adopt(application,current);opened=true;
      try{await api.notifications?.read(item.id);}catch{setNotice('Заявка открыта. Не удалось отметить уведомление прочитанным.');}
    });
    return opened;
  };
  const create = (product?:ProductCode) => {
    if (busy || !allowDiscard()) return;
    void run("create", async () => {
      await verifySession();
      createKey.current ??= crypto.randomUUID();
      let application: Application;
      try { application = await api.create(createKey.current); }
      catch (issue) {
        if (issue instanceof ApiError && issue.code === "APPLICATION_DELETED") createKey.current = null;
        throw issue;
      }
      if(product)application=await api.update(application.id,{version:application.version,product_code:product});
      await verifySession();
      createKey.current = null;
      upsert(application);
      adopt(application);
    });
  };
  const refreshList = () => void run("refresh-list", async () => {
    await verifySession();
    const current=sessionRef.current!;
    const list = await listFor(current);
    await verifySession(current);
    if(current.company)list.items.forEach(item => requireCompany(item.company_id));
    setItems(list.items);
  });
  const removeDraft = (id: string) => {
    if (lock.current || selected) return;
    const item = items.find(item => item.id === id);
    if (!item || item.status !== "DRAFT") return;
    setError(null);
    setDeleteTarget(item);
  };
  const confirmRemoveDraft = () => {
    if (!deleteTarget || lock.current) return;
    const {id, version} = deleteTarget;
    const number=applicationNumber(deleteTarget);
    void run("delete", async () => {
      await verifySession();
      await api.remove(id, version);
      await verifySession();
      setItems(current => current.filter(item => item.id !== id));
      setDeleteTarget(null);
      setNotice(`Черновик № ${number} удалён.`);
    });
  };
  const change = <K extends keyof DraftFields>(
    key: K,
    value: DraftFields[K],
  ) => {
    setFields((current) => {
      const next = { ...current, [key]: value };
      if (key === "product_code") {
        if (!value || value === "overdraft") next.term_months = "";
        if (value !== "equipment") next.equipment_cost_rub = "";
        if (value !== "overdraft") {
          next.usage_days = "";
          next.expected_inflow_date = "";
          next.expected_inflow_amount_rub = "";
          next.planned_payment_rub = "";
          next.planned_payment_date = "";
          next.expected_inflow_source = "";
        }
      }
      return next;
    });
    setNotice("");
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[key];
      if (key === "product_code") {
        if (!value || value === "overdraft") delete next.term_months;
        if (value !== "equipment") delete next.equipment_cost_rub;
        if (value !== "overdraft") {
          delete next.usage_days;
          delete next.expected_inflow_date;
          delete next.expected_inflow_amount_rub;
          delete next.planned_payment_rub;
          delete next.planned_payment_date;
          delete next.expected_inflow_source;
        }
      }
      return next;
    });
  };
  const reloadSelected = () => {
    if (selected && allowDiscard())
      void run("reload", async () => {
        await verifySession();
        const application = await getFor(selected.id,sessionRef.current!);
        await verifySession();
        // Recovery is explicit and follows an authoritative, authorised server read.
        // A new submission still needs fresh confirmation; no POST is retried here.
        if(receiptBlocked && sessionRef.current?.company)clearAttempt(sessionRef.current.user.id,application.id);
        upsert(application);
        adopt(application);
        setPurposeReset((value) => value + 1);
      });
  };
  const reauthenticate = (after?:()=>void) => {
    if (session)
      void run("reauth", async () => {
        const current = await api.login(session.user.id);
        if(!sessionRef.current || !sameSession(current,sessionRef.current)){clearProfile();throw new ApiError(401,"SESSION_CHANGED","Профиль изменился. Войдите заново.");}
        acceptSession(current);
        setNotice("Вход подтверждён.");
        void autosave.retry();
        after?.();
      });
  };

  const submitApplication = (versions?: {profile_version:string;catalog_version:string}) => {
    if(!selected || !session?.company || receiptBlocked) return;
    const id=selected.id;
    const expected=session;
    void run("submit",async()=>{
      await verifySession(expected);
      let operation=pendingSubmit;
      if(!operation){
        if(!versions)return;
        if(!await autosave.flush()){
          setFieldErrors(autosave.getState().errors);setFieldErrorAttempt(n=>n+1);return;
        }
        const saved=autosave.getSaved();
        if(!saved || saved.id!==id || saved.status!=='DRAFT')return;
        operation={key:crypto.randomUUID(),body:{...versions,version:saved.version,confirmed:true}};
        saveAttempt(expected.user.id,id,operation);
        setPendingSubmit(operation);
      }
      try{
        const result=await api.submit(id,operation.body,operation.key);
        await verifySession(expected);
        if(result.id!==id || result.company_id!==expected.company!.id || !['UNDER_REVIEW','NEEDS_INFO'].includes(result.status) || !result.submission || !Array.isArray(result.history)){
          throw new ApiError(502,"INVALID_SUBMIT_RESPONSE","Сервер не подтвердил отправку. Проверьте её повтором.");
        }
        clearAttempt(expected.user.id,id);setPendingSubmit(null);
        upsert(result);adopt(result,expected);
      }catch(issue){
        const problem=asError(issue);
        // Only definite rejections resolve the unknown outcome. Transport/5xx keep the exact receipt.
        if(problem.status>=400 && problem.status<500 && problem.code!=='UNAUTHENTICATED'){
          clearAttempt(expected.user.id,id);setPendingSubmit(null);
          if(problem.status===409)setPurposeReset(n=>n+1);
        }
        throw issue;
      }
    });
  };

  const problem = error ?? autosave.error;
  const errorBox = problem && !deleteTarget && (
    <div className="notice error-notice" role="alert">
      <span className="notice-symbol" aria-hidden="true">
        !
      </span>
      <div>
        <p>{problem.code === "VERSION_CONFLICT" ? (selected ? "Заявка изменена в другом окне. Загрузите сохранённую версию." : "Заявка изменена в другом окне. Обновите список перед удалением.") : problem.message}</p>
        {autosave.error && ![401, 409].includes(autosave.error.status) && <button className="text-button" disabled={!!busy} onClick={() => void autosave.retry()}>Повторить сохранение</button>}
        {problem.status === 409 && selected && (
          <button
            className="text-button"
            disabled={!!busy}
            onClick={reloadSelected}
          >
            Загрузить сохранённую версию
          </button>
        )}
        {!selected && session && [404, 409, 410].includes(problem.status) && <button className="text-button" disabled={!!busy} onClick={refreshList}>Обновить список</button>}
        {problem.status === 401 && session && (
          <button
            className="text-button"
            disabled={!!busy}
            onClick={()=>reauthenticate()}
          >
            Войти снова
          </button>
        )}
        {createKey.current && !selected && (
          <button className="text-button" disabled={!!busy} onClick={()=>create()}>
            Повторить создание
          </button>
        )}
        {!session && (
          <button
            className="text-button"
            disabled={!!busy}
            onClick={() => setAttempt((value) => value + 1)}
          >
            Повторить подключение
          </button>
        )}
      </div>
    </div>
  );

  if (booting)
    return (
      <div className="boot-screen">
        <div className="brand-mark">А</div>
        <p role="status">Открываем ваш кабинет…</p>
      </div>
    );
  if (!session)
    return (
      <div className="login-page">
        <div className="login-story">
          <div className="brand">
            <span className="brand-mark">А</span>
            <span>
              АЛЬФА<span className="brand-sub">БИЗНЕС</span>
            </span>
          </div>
          <div className="login-headline">
            <span className="eyebrow">КРЕДИТНЫЙ КАБИНЕТ</span>
            <h1>
              У больших планов
              <br />
              есть следующий шаг<span className="red-text">.</span>
            </h1>
            <p>
              Выберите финансирование для вашего бизнеса.

            </p>
          </div>
          <div className="login-footer">
            <Icon name="shield" />
            <span>Демонстрационный проект · Синтетические данные</span>
          </div>
          <div className="login-art" aria-hidden="true">
            <span>А</span>
          </div>
        </div>
        <main className="login-panel">
          <div className="login-card">
            <span className="pill">ПРОТОТИП</span>
            <h2>
              Ваш бизнес —<br />в вашем кабинете
            </h2>
            <p>Выберите тестовый профиль, чтобы начать.</p>
            {errorBox}
            <label className="field">
              <span>Демонстрационный профиль</span>
              <select
                value={account}
                disabled={!!busy}
                onChange={(event) => setAccount(event.target.value)}
              >
                {demoAccounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
            </label>
            <button
              className="button primary full-width"
              disabled={!!busy}
              onClick={() => void login()}
            >
              {busy === "login" ? "Входим…" : "Войти в кабинет"}
              <Icon name="arrow" size={18} />
            </button>
            <p className="login-disclaimer">
              Вход предназначен для проверки прототипа.
              <br />
              Настоящие банковские данные не используются.
            </p>
          </div>
        </main>
      </div>
    );

  return (
    <div className="cabinet">
      {deleteTarget && <DeleteDraftDialog application={deleteTarget} busy={busy === "delete"} error={error?.message ?? null}
        onCancel={() => { if (!lock.current) setDeleteTarget(null); }} onConfirm={confirmRemoveDraft} />}
      <header className="cabinet-header">
        <button type="button" className="brand brand-home" onClick={showList} disabled={!!busy} aria-label="На главную"><span className="brand-mark" aria-hidden="true">А</span><span>{session.company ? "Кредитный кабинет" : "Кабинет сотрудника"}</span></button>
        <nav aria-label="Основная навигация"><button className="header-link" onClick={showList} disabled={!!busy} aria-current={!selected&&!profilePage ? "page" : undefined}>{session.company ? "Мои заявки" : "Поступившие заявки"}</button></nav>
        {session.company&&<ClientNotifications key={session.user.id} api={api} session={session as import('./types').ClientSession} busy={!!busy} onOpen={openNotification} onSessionChanged={clearProfile}/>}
        <div className="account">{session.company?<button type="button" className="header-link company-profile-link" onClick={showCompanyProfile} disabled={!!busy} aria-label={`Профиль компании: ${session.company.name}`} aria-current={profilePage?'page':undefined}>{session.company.name}</button>:<button type="button" className="header-link" onClick={showCompanyProfile} disabled={!!busy} aria-label={`Профиль сотрудника: ${session.user.name}`} aria-current={profilePage?"page":undefined}>{session.user.name}</button>}<button className="icon-button" aria-label="Сменить профиль" title="Сменить профиль" disabled={!!busy} onClick={logout}><Icon name="logout" size={18} /></button></div>
      </header>
      {!selected && !profilePage && session.company && <section className="cabinet-hero" aria-labelledby="welcome-title">
        <div><h1 id="welcome-title">Новая возможность<br />для вашего бизнеса</h1><p>Выберите финансирование и следите за заявками<br className="desktop-break" /> в одном кабинете</p>
          <button className="button primary new-application" onClick={()=>create()} disabled={!!busy}>{busy === "create" ? "Создаём…" : "Новая заявка"}</button>
        </div><img className="hero-art" src="/images/credit/hero.png" alt="" width="460" height="460" fetchPriority="high" />
      </section>}
      <main className={`main-content ${selected ? "application-content" : "home-content"}`}>
        {(selected||profilePage) && <div className="draft-page-header"><button className="back-button" aria-label="Все заявки" onClick={showList} disabled={!!busy}>← Все заявки</button>{selected&&<span className="draft-subtitle"><StatusBadge status={selected.status}/> № {applicationNumber(selected)}</span>}</div>}
        {errorBox}
        {notice && <div className="notice success-notice" role="status"><Icon name="check" size={18} /><p>{notice}</p></div>}
        {selected && session.company && selected.status==='DRAFT' && (pendingSubmit || receiptBlocked) && <div className="notice" role="status"><div><p>Исход предыдущей отправки нужно проверить. Параметры этой попытки сохранены; повтор не создаст вторую заявку.</p>
          {pendingSubmit && <button className="button secondary" type="button" disabled={!!busy} onClick={()=>submitApplication()}>Проверить отправку</button>}
          {receiptBlocked && <button className="button secondary" disabled={!!busy} onClick={reloadSelected}>Обновить карточку</button>}
        </div></div>}
        {profilePage?(session.company?<CompanyProfilePage api={api} session={session as import('./types').ClientSession} onSessionChanged={clearProfile}/>:<StaffProfilePage api={api} session={session as import('./types').StaffSession} onSessionChanged={clearProfile}/>):selected ? session.company && selected.status==='DRAFT' ? <DraftForm api={api} key={selected.id} resetVersion={purposeReset} application={selected} companyName={session.company.name} session={session as import("./types").ClientSession}
          errorAttempt={fieldErrorAttempt} fields={fields} errors={{ ...autosave.errors, ...fieldErrors }} busy={!!busy || !!pendingSubmit || receiptBlocked}
          saveStatus={autosave.status} onChange={change} onNavigate={() => void autosave.flush()} onReauthenticate={reauthenticate}
          onSubmitApplication={submitApplication} onSessionChanged={clearProfile}/>
          : <div className={`submitted-layout ${selected.status==='DECLINED'?'without-journey':''}`}><div className="application-stack">{session.company&&<FundingPanel key={selected.id} api={api} application={selected} session={session as import('./types').ClientSession} onUpdated={value=>{upsert(value);setSelected(value);}} onSessionChanged={clearProfile}/>}<SubmittedApplication application={selected} staff={!session.company}/>{!session.company&&<ReviewPanel api={api} blocked={infoDirty} application={selected} onUpdated={value=>{upsert(value);setSelected(value);}}/>}<InfoRequests key={session.user.id+selected.id} api={api} session={session} application={selected} onUpdated={value=>{upsert(value);setSelected(value);}} onSessionChanged={clearProfile} register={registerInfo}/></div>{selected.status!=='DECLINED'&&<aside className="draft-aside"><ApplicationJourney status={selected.status}/></aside>}</div>
          : session.company ? <ApplicationsList items={items} busy={!!busy} onOpen={open} onDelete={removeDraft} onCreate={()=>create()} onChooseProduct={create} />
          : <StaffApplications items={items} busy={!!busy} onOpen={open} onRefresh={refreshList}/>}
        <footer className="page-footer"><span>Альфа Бизнес · Кредитный кабинет</span><a href="/credit-terms.html" target="_blank" rel="noopener noreferrer">Полные условия финансирования ↗</a><span>Демонстрационный режим · Синтетические данные</span></footer>
      </main>
    </div>
  );
}
