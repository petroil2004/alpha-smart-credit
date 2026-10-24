import { vi } from "vitest";
import type { Application, Session, ClientSession, SubmitInput } from "../types";
import {demoAccounts} from "../demo-accounts";
import { annuityResult, catalog } from "./calculator-fixtures";

export const session: ClientSession = {
  user: { id: "demo-client-1", name: "Демо-клиент 1", role: "CLIENT" },
  company: { id: "demo-company-1", name: "ООО «Демо Торг»" },
};

export function application(overrides: Partial<Application> = {}): Application {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    company_id: "demo-company-1",
    status: "DRAFT",
    purpose: null,
    product_code: null,
    amount_rub: null,
    term_months: null,
    usage_days: null,
    expected_inflow_date: null,
    expected_inflow_amount_rub: null,
    version: 1,
    created_at: "2026-10-21T17:00:00Z",
    updated_at: "2026-10-21T17:00:00Z",
    ...overrides,
  };
}

export function contractServer(
  options: { loggedIn?: boolean; applications?: Application[] } = {},
) {
  let current: Session | null = options.loggedIn
    ? structuredClone(session)
    : null;
  const store = new Map(
    (options.applications ?? []).map((item) => [
      item.id,
      structuredClone(item),
    ]),
  );
  const keys = new Map<string, string>();
  let nextSaveError: number | null = null;
  let nextDeleteError: number | null = null;
  let deleteGate: Promise<void> | null = null;
  let nextCreateError = false;
  let nextSubmitError = false;
  const submissions = new Map<string, {body: SubmitInput; item: Application}>();
  let createGate: Promise<void> | null = null;
  let saveGate: Promise<void> | null = null;
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status });
  const error = (status: number, code: string, message: string) =>
    json({ error: { code, message } }, status);
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname.replace("/api/v1", "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path === "/auth/demo-login" && method === "POST") {
      if (!demoAccounts.some(a=>a.id===body.account_id))
        return error(422, "VALIDATION_ERROR", "Неизвестный профиль");
      if (body.account_id === "demo-staff-1") {
        current = {user:{id:'demo-staff-1',name:'Демо-сотрудник',role:'STAFF'},company:null};
        return json(current);
      }
      const number=String(body.account_id).split('-').at(-1)!;
      current={user:{id:body.account_id,name:'Демо-клиент '+number,role:'CLIENT'},company:{id:'demo-company-'+number,name:demoAccounts.find(a=>a.id===body.account_id)!.name}};
      return json(current);
    }
    if (path === "/auth/logout" && method === "POST") {
      current = null;
      return new Response(null, { status: 204 });
    }
    if (!current) return error(401, "UNAUTHENTICATED", "Войдите в кабинет");
    if (path === "/me" && method === "GET") return json(current);
    if (path.startsWith('/staff/applications')) {
      if (current.user.role !== 'STAFF') return error(403,'FORBIDDEN','Только сотрудник');
      if (path === '/staff/applications') return json({items:[...store.values()].filter(item=>item.status === 'UNDER_REVIEW')});
      const item=store.get(decodeURIComponent(path.split('/')[3]));
      return item?.status === 'UNDER_REVIEW' ? json(item) : error(404,'NOT_FOUND','Заявка не найдена');
    }
    if (!current.company) return error(403,'FORBIDDEN','Только клиент');
    if (path === '/company-profile') return json({company_id:current.company.id,company_name:current.company.name,profile_version:'profile-v1',source:'BANK_DATA'});
    if (path === "/products" && method === "GET") return json(catalog);
    if (path === "/calculations/annuity" && method === "POST")
      return json(annuityResult({ product_code: body.product_code, amount_rub: body.amount_rub, term_months: body.term_months }));
    if (path === "/applications" && method === "GET")
      return json({
        items: [...store.values()].filter(
          (item) => item.company_id === current!.company!.id,
        ),
      });
    if (path === "/applications" && method === "POST") {
      if (createGate) await createGate;
      const key = new Headers(init?.headers).get("Idempotency-Key");
      if (!key || Object.keys(body).length)
        return error(422, "VALIDATION_ERROR", "Некорректное создание");
      const scoped = `${current.user.id}:${key}`;
      if (keys.has(scoped)) {
        const existing = store.get(keys.get(scoped)!);
        return existing ? json(existing) : error(410, "APPLICATION_DELETED", "Черновик удалён");
      }
      const item = application({
        id: `00000000-0000-4000-8000-${String(store.size + 1).padStart(12, "0")}`,
        company_id: current.company.id,
      });
      store.set(item.id, item);
      keys.set(scoped, item.id);
      if (nextCreateError) {
        nextCreateError = false;
        return error(503, "SERVER_ERROR", "Временная ошибка после создания");
      }
      return json(item, 201);
    }
    const id = decodeURIComponent(path.split("/")[2] ?? "");
    const item = store.get(id);
    if (!item || item.company_id !== current.company.id)
      return error(404, "NOT_FOUND", "Заявка не найдена");
    if (path.endsWith('/submit') && method === 'POST') {
      const key=new Headers(init?.headers).get('Idempotency-Key')!;
      const existing=submissions.get(key);
      if(existing) return JSON.stringify(existing.body)===JSON.stringify(body) ? json(store.get(existing.item.id) ?? existing.item) : error(409,'IDEMPOTENCY_CONFLICT','Ключ уже использован');
      if(item.status!=='DRAFT') return error(409,'APPLICATION_NOT_DRAFT','Уже отправлено');
      if(body.version!==item.version) return error(409,'VERSION_CONFLICT','Версия изменилась');
      if(!item.purpose?.trim()) return json({error:{code:'VALIDATION_ERROR',message:'Проверьте поля',fields:{purpose:'Укажите, на что нужны средства'}}},422);
      const now='2026-10-24T10:00:00Z';
      const sent:Application={...item,status:'UNDER_REVIEW',version:item.version+1,company_name:current.company.name,submitted_at:now,
        submission:{submitted_at:now,submitted_by:current.user.id,snapshot:{application:item,company:{company_id:current.company.id,company_name:current.company.name,profile_version:'profile-v1',source:'BANK_DATA'},calculation:annuityResult({product_code:'working_capital',amount_rub:item.amount_rub!,term_months:item.term_months!}),financial_period:{start_date:'2026-04-01',end_date:'2026-09-30'},confirmed_at:now,confirmed_by:current.user.id}},history:[]};
      store.set(id,sent);submissions.set(key,{body,item:sent});
      if(nextSubmitError){nextSubmitError=false;throw new TypeError('Lost reply');}
      return json(sent);
    }
    if (method === "GET") return json(item);
    if (method === "DELETE") {
      if (deleteGate) await deleteGate;
      if (nextDeleteError) {
        const status = nextDeleteError;
        nextDeleteError = null;
        return error(status, "SERVER_ERROR", "Не удалось удалить черновик");
      }
      if (item.status !== "DRAFT") return error(409, "APPLICATION_NOT_DRAFT", "Удалять можно только черновик");
      if (Number(url.searchParams.get("version")) !== item.version) return error(409, "VERSION_CONFLICT", "Обновите список");
      store.delete(id);
      return new Response(null, {status:204});
    }
    if (method === "PATCH") {
      if (saveGate) await saveGate;
      if (nextSaveError) {
        const status = nextSaveError;
        nextSaveError = null;
        return error(
          status,
          status === 409
            ? "VERSION_CONFLICT"
            : status === 401
              ? "UNAUTHENTICATED"
              : "SERVER_ERROR",
          status === 409
            ? "Заявка уже изменена в другом окне"
            : "Не удалось сохранить",
        );
      }
      if (item.status !== "DRAFT") return error(409,"APPLICATION_NOT_DRAFT","Только черновик");
      if (body.version !== item.version)
        return error(409, "VERSION_CONFLICT", "Заявка уже изменена");
      const updated = {
        ...item,
        ...body,
        version: item.version + 1,
        updated_at: "2026-10-21T17:01:00Z",
      };
      store.set(id, updated);
      return json(updated);
    }
    return error(404, "NOT_FOUND", "Неизвестный маршрут");
  });
  return {
    fetcher,
    store,
    setSession: (value: Session | null) => {current=value;},
    failNextSubmitAfterCommit: () => { nextSubmitError=true; },
    failNextSave: (status: number) => {
      nextSaveError = status;
    },
    failNextCreateAfterCommit: () => {
      nextCreateError = true;
    },
    holdCreates: (gate: Promise<void>) => {
      createGate = gate;
    },
    holdSaves: (gate: Promise<void>) => { saveGate = gate; },
    holdDeletes: (gate: Promise<void>) => { deleteGate = gate; },
    failNextDelete: (status: number) => { nextDeleteError = status; },
  };
}
