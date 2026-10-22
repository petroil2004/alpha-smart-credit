import { useEffect, useRef, useState } from "react";
import type {
  Api,
  Application,
  DraftFields,
  FieldErrors,
  Session,
} from "./types";
import { ApiError, createApi } from "./api";
import {
  DraftValidationError,
  emptyDraft,
  fromApplication,
  toDraftPayload,
} from "./draft";
import DraftForm from "./components/DraftForm";
import ApplicationsList from "./components/ApplicationsList";
import { Icon } from "./components/Icon";

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
  const [booting, setBooting] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState("");
  const lock = useRef(false);
  const [items, setItems] = useState<Application[]>([]);
  const [selected, setSelected] = useState<Application | null>(null);
  const [fields, setFields] = useState<DraftFields>(emptyDraft);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [fieldErrorAttempt, setFieldErrorAttempt] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState("");
  const [account, setAccount] = useState("demo-client-1");
  const createKey = useRef<string | null>(null);
  const dirty =
    selected !== null &&
    JSON.stringify(fields) !== JSON.stringify(fromApplication(selected));

  const clearProfile = () => {
    setSession(null);
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
    expected = session?.company.id,
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
  const verifySession = async () => {
    const current = await api.me();
    requireCompany(current.company.id);
  };
  const adopt = (application: Application, companyId = session?.company.id) => {
    requireCompany(application.company_id, companyId);
    setSelected(application);
    setFields(fromApplication(application));
    setFieldErrors({});
    setUrl(application.id);
  };
  const upsert = (application: Application) => {
    requireCompany(application.company_id);
    setItems((current) =>
      [
        application,
        ...current.filter((item) => item.id !== application.id),
      ].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    );
  };

  useEffect(() => {
    let active = true;
    setBooting(true);
    setError(null);
    (async () => {
      try {
        const current = await api.me();
        const list = await api.list();
        if (!active) return;
        list.items.forEach((item) =>
          requireCompany(item.company_id, current.company.id),
        );
        setSession(current);
        setItems(list.items);
        setAccount(current.user.id);
        const id = selectedFromUrl();
        if (id) {
          try {
            const application = await api.get(id);
            if (active) adopt(application, current.company.id);
          } catch (issue) {
            if (active) {
              setUrl();
              setError(asError(issue));
            }
          }
        }
      } catch (issue) {
        if (active) {
          setSession(null);
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
      const list = await api.list();
      list.items.forEach((item) =>
        requireCompany(item.company_id, current.company.id),
      );
      setSession(current);
      setItems(list.items);
      setSelected(null);
      setFields(emptyDraft());
      setFieldErrors({});
      createKey.current = null;
      const id = selectedFromUrl();
      if (id) {
        try {
          adopt(await api.get(id), current.company.id);
        } catch (issue) {
          setUrl();
          setError(asError(issue));
        }
      }
    });
  const logout = () => {
    if (allowDiscard())
      void run("logout", async () => {
        await api.logout();
        clearProfile();
      });
  };
  const showList = () => {
    if (busy || !allowDiscard()) return;
    setSelected(null);
    setFields(emptyDraft());
    setFieldErrors({});
    setError(null);
    setNotice("");
    setUrl();
  };
  const open = (id: string) => {
    if (busy || !allowDiscard()) return;
    void run("open", async () => {
      await verifySession();
      adopt(await api.get(id));
    });
  };
  const create = () => {
    if (busy || !allowDiscard()) return;
    void run("create", async () => {
      await verifySession();
      createKey.current ??= crypto.randomUUID();
      const application = await api.create(createKey.current);
      createKey.current = null;
      upsert(application);
      adopt(application);
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
        if (value !== "overdraft") {
          next.usage_days = "";
          next.expected_inflow_date = "";
          next.expected_inflow_amount_rub = "";
        }
      }
      return next;
    });
    setNotice("");
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
  };
  const save = () => {
    if (selected)
      void run("save", async () => {
        setFieldErrors({});
        const payload = toDraftPayload(fields);
        await verifySession();
        const application = await api.update(selected.id, {
          ...payload,
          version: selected.version,
        });
        upsert(application);
        adopt(application);
        setNotice("Черновик сохранён");
      });
  };
  const reloadSelected = () => {
    if (selected && allowDiscard())
      void run("reload", async () => {
        await verifySession();
        const application = await api.get(selected.id);
        upsert(application);
        adopt(application);
      });
  };
  const reauthenticate = (after?:()=>void) => {
    if (session)
      void run("reauth", async () => {
        const current = await api.login(session.user.id);
        requireCompany(current.company.id);
        setSession(current);
        setNotice("Вход подтверждён. Можно сохранить черновик.");
        after?.();
      });
  };

  const errorBox = error && (
    <div className="notice error-notice" role="alert">
      <span className="notice-symbol" aria-hidden="true">
        !
      </span>
      <div>
        <p>{error.message}</p>
        {error.status === 409 && selected && (
          <button
            className="text-button"
            disabled={!!busy}
            onClick={reloadSelected}
          >
            Загрузить сохранённую версию
          </button>
        )}
        {error.status === 401 && session && (
          <button
            className="text-button"
            disabled={!!busy}
            onClick={()=>reauthenticate()}
          >
            Войти снова
          </button>
        )}
        {createKey.current && !selected && (
          <button className="text-button" disabled={!!busy} onClick={create}>
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
              Начните с потребности вашего бизнеса.
              <br />
              Сохраните заявку и возвращайтесь, когда удобно.
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
                <option value="demo-client-1">ООО «Демо Торг»</option>
                <option value="demo-client-2">ООО «Демо Мастерская»</option>
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
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">А</span>
          <span>
            АЛЬФА<span className="brand-sub">БИЗНЕС</span>
          </span>
        </div>
        <div className="workspace-label">КРЕДИТНЫЙ КАБИНЕТ</div>
        <nav aria-label="Основная навигация">
          <button
            className="nav-item active"
            onClick={showList}
            disabled={!!busy}
          >
            <Icon name="grid" />
            Мои заявки<span className="nav-count">{items.length}</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Icon name="shield" />
            <p>
              Все шаги —<br />в одном кабинете
            </p>
          </div>
          <span className="demo-label">
            <span />
            Демонстрационная версия
          </span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Бизнесу <span>/</span> Финансирование
          </div>
          <div className="account">
            <div className="account-icon">
              <Icon name="building" size={18} />
            </div>
            <span>{session.company.name}</span>
            <button
              className="icon-button"
              aria-label="Сменить профиль"
              title="Сменить профиль"
              disabled={!!busy}
              onClick={logout}
            >
              <Icon name="logout" size={18} />
            </button>
          </div>
        </header>
        <main className="main-content">
          <div className="page-header">
            <div>
              {selected ? (
                <>
                  <button
                    className="back-button"
                    aria-label="Все заявки"
                    onClick={showList}
                    disabled={!!busy}
                  >
                    ← Все заявки
                  </button>
                  <h1>
                    Новая возможность
                    <br />
                    для вашего бизнеса<span className="red-text">.</span>
                  </h1>
                  <div className="draft-subtitle">
                    <span className="draft-badge">Черновик</span>
                    <span>№ {selected.id.slice(-6)}</span>
                    <span className="separator-dot">·</span>
                    <span>Заполните в своём темпе</span>
                  </div>
                </>
              ) : (
                <>
                  <span className="eyebrow">ФИНАНСИРОВАНИЕ БИЗНЕСА</span>
                  <h1>Мои заявки</h1>
                  <p>Ваши планы, предложения и следующие шаги — здесь.</p>
                </>
              )}
            </div>
            {!selected && (
              <button
                className="button primary new-application"
                onClick={create}
                disabled={!!busy}
              >
                <Icon name="plus" size={18} />
                {busy === "create" ? "Создаём…" : "Новая заявка"}
              </button>
            )}
          </div>
          {errorBox}
          {notice && (
            <div className="notice success-notice" role="status">
              <Icon name="check" size={18} />
              <p>{notice}</p>
            </div>
          )}
          {selected ? (
            <DraftForm
              api={api}
              key={selected.id}
              application={selected}
              companyName={session.company.name}
              errorAttempt={fieldErrorAttempt}
              fields={fields}
              errors={fieldErrors}
              busy={!!busy}
              saving={busy === "save"}
              dirty={dirty}
              onChange={change}
              onSave={save}
              onReauthenticate={reauthenticate}
            />
          ) : (
            <ApplicationsList
              items={items}
              busy={!!busy}
              onOpen={open}
              onCreate={create}
            />
          )}
          <footer className="page-footer">
            <span>Альфа Бизнес · Кредитный кабинет</span>
            <span>Хакатонный прототип. Операции моделируются.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
