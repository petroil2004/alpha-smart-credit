import {createInfoApi} from './info-api';
import type { Api, Application, AnnuityResult, FieldErrors, ProductCatalog, Session, CompanyProfile } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: FieldErrors = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function createApi(
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Api {
  async function request<T>(
    path: string,
    options: RequestInit = {},
    timeoutMs = 15_000,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(`/api/v1${path}`, {
        ...options,
        credentials: "same-origin",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", ...options.headers },
      });
      if (response.status === 204) return undefined as T;
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!response.ok) {
        const error =
          body && typeof body === "object" && "error" in body
            ? (body as { error: Record<string, unknown> }).error
            : null;
        const fields: FieldErrors = {};
        if (error?.fields && typeof error.fields === "object") {
          for (const [key, value] of Object.entries(error.fields)) {
            if (typeof value === "string")
              fields[key as keyof FieldErrors] = value;
          }
        }
        throw new ApiError(
          response.status,
          typeof error?.code === "string" ? error.code : "SERVER_ERROR",
          response.status >= 500
            ? "Сервис временно недоступен. Попробуйте ещё раз."
            : typeof error?.message === "string"
              ? error.message
              : "Не удалось выполнить действие. Попробуйте ещё раз.",
          fields,
        );
      }
      if (body === null)
        throw new ApiError(
          response.status,
          "INVALID_RESPONSE",
          "Не удалось прочитать ответ сервиса. Попробуйте ещё раз.",
        );
      return body as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        0,
        "NETWORK_ERROR",
        "Не удалось связаться с сервисом. Проверьте соединение и попробуйте ещё раз.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    disburse:(id,body,key)=>request<Application>(`/applications/${encodeURIComponent(id)}/disbursement`,{method:'POST',body:JSON.stringify(body),headers:{'Idempotency-Key':key}}),
    notifications:{
      list:()=>request<import('./types').NotificationList>('/notifications'),
      read:id=>request<void>(`/notifications/${id}/read`,{method:'POST'}),
    },
    assistant:{
      status:()=>request<import('./types').AssistantStatus>('/assistant/status',{},5_000),
      chat:body=>request<import('./types').AssistantReply>('/assistant/chat',{method:'POST',body:JSON.stringify(body)},95_000),
    },
    info: createInfoApi(fetcher),
    companyProfile: () => request<CompanyProfile>("/company-profile"),
    submit: (id, input, key) => request<Application>(`/applications/${encodeURIComponent(id)}/submit`, {method: "POST", body: JSON.stringify(input), headers: {"Idempotency-Key": key}}),
    staffList: () => request<{items: Application[]}>("/staff/applications"),
    staffGet: (id) => request<Application>(`/staff/applications/${encodeURIComponent(id)}`),
    assessment: (id) => request<import("./types").Assessment>(`/staff/applications/${encodeURIComponent(id)}/assessment`, {method:"POST"}),
    decide: (id, body, key) => request<Application>(`/staff/applications/${encodeURIComponent(id)}/decision`, {method:"POST",body:JSON.stringify(body),headers:{"Idempotency-Key":key}}),
    products: () => request<ProductCatalog>("/products"),
    calculateAnnuity: (input) => request<AnnuityResult>("/calculations/annuity", {method: "POST", body: JSON.stringify(input)}),
    me: () => request<Session>("/me"),
    login: (accountId) =>
      request<Session>("/auth/demo-login", {
        method: "POST",
        body: JSON.stringify({ account_id: accountId }),
      }),
    logout: () => request<void>("/auth/logout", { method: "POST" }),
    list: () => request<{ items: Application[] }>("/applications"),
    create: (key) =>
      request<Application>("/applications", {
        method: "POST",
        body: "{}",
        headers: { "Idempotency-Key": key },
      }),
    get: (id) =>
      request<Application>(`/applications/${encodeURIComponent(id)}`),
    remove: (id, version) => request<void>(`/applications/${encodeURIComponent(id)}?version=${version}`, {method: "DELETE"}),
    update: (id, body) =>
      request<Application>(`/applications/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
  };
}
