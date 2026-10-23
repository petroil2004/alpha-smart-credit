import { ApiError } from './api';
import type { SubmitInput } from './types';
export interface SubmissionAttempt { key: string; body: SubmitInput; }
const storageKey = (user: string, id: string) => `credit-submit:${encodeURIComponent(user)}:${encodeURIComponent(id)}`;
const unavailable = () => new ApiError(0, 'RETRY_STORAGE_UNAVAILABLE', 'Не удалось сохранить данные повтора отправки. Разрешите хранилище браузера и повторите.');
export function readAttempt(user: string, id: string): SubmissionAttempt | null {
  let raw: string | null;
  try { raw = sessionStorage.getItem(storageKey(user,id)); } catch { throw unavailable(); }
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw);
    const body = value?.body;
    if (typeof value?.key !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value.key) ||
      !body || !Number.isSafeInteger(body.version) || body.version < 1 || typeof body.profile_version !== 'string' || !body.profile_version ||
      typeof body.catalog_version !== 'string' || !body.catalog_version || body.confirmed !== true || Object.keys(body).length !== 4) throw Error();
    return value;
  } catch { throw new ApiError(0, 'INVALID_RETRY_RECEIPT', 'Не удалось прочитать данные повтора. Обновите карточку, чтобы проверить отправку.'); }
}
export function saveAttempt(user: string, id: string, attempt: SubmissionAttempt) {
  try { sessionStorage.setItem(storageKey(user,id),JSON.stringify(attempt)); } catch { throw unavailable(); }
}
export function clearAttempt(user: string, id: string) {
  try { sessionStorage.removeItem(storageKey(user,id)); } catch { /* A confirmed server response remains authoritative. */ }
}
