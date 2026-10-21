import type { Api, Application, FieldErrors, Session } from './types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields: FieldErrors = {}) {
    super(message);
    this.name = 'ApiError';
  }
}

export function createApi(fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): Api {
  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetcher(`/api/v1${path}`, {
        ...options, credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...options.headers },
      });
      if (response.status === 204) return undefined as T;
      let body: unknown;
      try { body = await response.json(); } catch { body = null; }
      if (!response.ok) {
        const error = body && typeof body === 'object' && 'error' in body
          ? (body as { error: Record<string, unknown> }).error : null;
        const fields: FieldErrors = {};
        if (error?.fields && typeof error.fields === 'object') {
          for (const [key, value] of Object.entries(error.fields)) {
            if (typeof value === 'string') fields[key as keyof FieldErrors] = value;
          }
        }
        throw new ApiError(response.status, typeof error?.code === 'string' ? error.code : 'SERVER_ERROR',
          response.status >= 500 ? 'Сервис временно недоступен. Попробуйте ещё раз.'
            : typeof error?.message === 'string' ? error.message : 'Не удалось выполнить действие. Попробуйте ещё раз.', fields);
      }
      if (body === null) throw new ApiError(response.status, 'INVALID_RESPONSE', 'Не удалось прочитать ответ сервиса. Попробуйте ещё раз.');
      return body as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, 'NETWORK_ERROR', 'Не удалось связаться с сервисом. Проверьте соединение и попробуйте ещё раз.');
    } finally { clearTimeout(timeout); }
  }
  return {
    me: () => request<Session>('/me'),
    login: (accountId) => request<Session>('/auth/demo-login', { method: 'POST', body: JSON.stringify({ account_id: accountId }) }),
    logout: () => request<void>('/auth/logout', { method: 'POST' }),
    list: () => request<{ items: Application[] }>('/applications'),
    create: (key) => request<Application>('/applications', { method: 'POST', body: '{}', headers: { 'Idempotency-Key': key } }),
    get: (id) => request<Application>(`/applications/${encodeURIComponent(id)}`),
    update: (id, body) => request<Application>(`/applications/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  };
}
