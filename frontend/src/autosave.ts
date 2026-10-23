import { ApiError } from "./api";
import { fromApplication, prepareDraftPayload } from "./draft";
import type { Api, Application, DraftFields, DraftPayload, FieldErrors } from "./types";

const productFields = ["product_code", "term_months", "usage_days", "expected_inflow_date", "expected_inflow_amount_rub"] as const;

export function prepareSave(fields: DraftFields, saved: Application) {
  const { payload, errors } = prepareDraftPayload(fields);
  const patch: Partial<DraftPayload> = {};
  const productChanged = payload.product_code !== saved.product_code;
  const groupInvalid = productChanged && productFields.some(key => errors[key]);
  for (const key of Object.keys(payload) as (keyof DraftPayload)[]) {
    if (errors[key] || (groupInvalid && productFields.some(field => field === key))) continue;
    if (payload[key] !== saved[key]) Object.assign(patch, { [key]: payload[key] });
  }
  if (productChanged && !groupInvalid) {
    for (const key of productFields) Object.assign(patch, { [key]: payload[key] });
  }
  return { patch, errors };
}

export interface SaveState {
  status: "saved" | "pending" | "saving" | "invalid" | "error";
  errors: FieldErrors;
  error: ApiError | null;
}

export class DraftAutosave {
  state: SaveState = { status: "saved", errors: {}, error: null };
  private fields: DraftFields;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<boolean> | null = null;
  private active = true;

  constructor(
    private api: Api,
    private saved: Application,
    private onSaved: (application: Application) => void,
    private onState: (state: SaveState) => void,
    private onScopeChanged: () => void = () => {},
  ) {
    this.fields = fromApplication(saved);
  }

  private publish(state: SaveState) {
    if (!this.active) return;
    this.state = state;
    this.onState(state);
  }

  update(fields: DraftFields) {
    if (!this.active) return;
    const changed = JSON.stringify(fields) !== JSON.stringify(this.fields);
    this.fields = { ...fields };
    if (!changed) return;
    clearTimeout(this.timer);
    if (this.state.error?.status === 401 || this.state.error?.status === 409) return;
    const p = prepareSave(this.fields, this.saved);
    const dirty = Object.keys(p.patch).length > 0 || Object.keys(p.errors).length > 0;
    this.publish({ status: this.running ? "saving" : dirty ? "pending" : "saved", errors: {}, error: null });
    if (dirty) this.timer = setTimeout(() => { void this.flush(); }, 1500);
  }

  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (!this.active || this.state.error) return Promise.resolve(false);
    if (this.running) return this.running;
    this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }

  retry(): Promise<boolean> {
    if (!this.active) return Promise.resolve(false);
    this.publish({ status: "pending", errors: {}, error: null });
    return this.flush();
  }

  private async drain(): Promise<boolean> {
    while (this.active) {
      const p = prepareSave(this.fields, this.saved);
      if (!Object.keys(p.patch).length) {
        const invalid = Object.keys(p.errors).length > 0;
        this.publish({ status: invalid ? "invalid" : "saved", errors: p.errors, error: null });
        return !invalid;
      }
      this.publish({ status: "saving", errors: p.errors, error: null });
      try {
        const current = await this.api.me();
        if (!this.active) return false;
        if (current.company.id !== this.saved.company_id) {
          throw new ApiError(401, "SESSION_CHANGED", "Профиль изменился. Войдите в кабинет заново.");
        }
        const result = await this.api.update(this.saved.id, { ...p.patch, version: this.saved.version });
        if (!this.active) return false;
        if (result.company_id !== this.saved.company_id || result.id !== this.saved.id) {
          throw new ApiError(401, "SESSION_CHANGED", "Профиль изменился. Войдите в кабинет заново.");
        }
        if (!Number.isSafeInteger(result.version) || result.version <= this.saved.version ||
            Object.entries(p.patch).some(([key, value]) => result[key as keyof DraftPayload] !== value)) {
          throw new ApiError(502, "INVALID_SAVE_RESPONSE", "Сервер не подтвердил сохранение изменений. Повторите попытку.");
        }
        this.saved = result;
        this.onSaved(result);
      } catch (issue) {
        if (!this.active) return false;
        const error = issue instanceof ApiError ? issue : new ApiError(0, "NETWORK_ERROR", "Не удалось сохранить изменения. Проверьте подключение.");
        this.publish({ status: "error", error, errors: error.fields });
        if (error.code === "SESSION_CHANGED") this.onScopeChanged();
        return false;
      }
    }
    return false;
  }

  dispose() {
    this.active = false;
    clearTimeout(this.timer);
  }
}
