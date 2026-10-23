import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DraftAutosave, prepareSave } from "./autosave";
import { createApi } from "./api";
import { ApiError } from "./api";
import { fromApplication } from "./draft";
import { application, contractServer } from "./test/api-fixtures";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

function setup() {
  const item = application();
  const server = contractServer({ loggedIn: true, applications: [item] });
  const saved = vi.fn();
  const controller = new DraftAutosave(createApi(server.fetcher), item, saved, vi.fn());
  return { controller, server, saved, fields: fromApplication(item), item };
}

it("excludes an invalid value while saving independent valid fields", () => {
  const item = application({ amount_rub: "500000.00" });
  const p = prepareSave({ ...fromApplication(item), purpose: "Товар", amount_rub: "," }, item);
  expect(p.patch).toEqual({ purpose: "Товар" });
  expect(p.errors.amount_rub).toBeTruthy();
});

it("keeps a changed product and dependent parameters atomic", () => {
  const item = application({ product_code: "working_capital", term_months: 12 });
  const fields = { ...fromApplication(item), product_code: "overdraft" as const, term_months: "", usage_days: "x", purpose: "Оплата" };
  expect(prepareSave(fields, item).patch).toEqual({ purpose: "Оплата" });
  expect(prepareSave({ ...fields, usage_days: "14" }, item).patch).toEqual({ purpose: "Оплата", product_code: "overdraft", term_months: null, usage_days: 14, expected_inflow_date: null, expected_inflow_amount_rub: null });
});

it("does not write a version for formatting-only or unchanged values", () => {
  const item = application({ purpose: "Товар", amount_rub: "1500.25" });
  expect(prepareSave({ ...fromApplication(item), purpose: " Товар ", amount_rub: "1 500,25" }, item).patch).toEqual({});
});

it("debounces changed input for 1500ms and skips unchanged snapshots", async () => {
  const h = setup();
  h.controller.update({ ...h.fields, purpose: "Товар" });
  await tick(1499);
  expect(h.server.store.get(h.item.id)?.purpose).toBeNull();
  await tick(1);
  expect(h.server.store.get(h.item.id)?.purpose).toBe("Товар");
  h.controller.update({ ...h.fields, purpose: "Товар " });
  await tick(5000);
  expect(h.server.store.get(h.item.id)?.version).toBe(2);
  h.controller.dispose();
});

it("serializes pending edits and uses returned versions without replacing raw input", async () => {
  const h = setup();
  let release!: () => void;
  h.server.holdSaves(new Promise<void>(resolve => { release = resolve; }));
  h.controller.update({ ...h.fields, purpose: "Первый" });
  await tick(1500);
  h.controller.update({ ...h.fields, purpose: "Последний" });
  await tick(1500);
  expect(h.server.fetcher.mock.calls.filter(([, o]) => o?.method === "PATCH")).toHaveLength(1);
  release();
  await h.controller.flush();
  expect(h.server.store.get(h.item.id)).toMatchObject({ purpose: "Последний", version: 3 });
  const bodies = h.server.fetcher.mock.calls.filter(([, o]) => o?.method === "PATCH").map(([, o]) => JSON.parse(String(o?.body)));
  expect(bodies.map(b => b.version)).toEqual([1, 2]);
  h.controller.dispose();
});

it.each([401, 409, 503])("stops retry loops on %i and retains edited values", async status => {
  const h = setup();
  h.server.failNextSave(status);
  h.controller.update({ ...h.fields, purpose: "Не потерять" });
  await tick(1500);
  expect(h.controller.state.error?.status).toBe(status);
  await tick(10000);
  expect(h.server.fetcher.mock.calls.filter(([, o]) => o?.method === "PATCH")).toHaveLength(1);
  if (status === 503) {
    expect(await h.controller.retry()).toBe(true);
    expect(h.server.store.get(h.item.id)?.purpose).toBe("Не потерять");
  } else {
    h.controller.update({ ...h.fields, purpose: "Новый ввод" });
    await tick(2000);
    expect(h.server.fetcher.mock.calls.filter(([, o]) => o?.method === "PATCH")).toHaveLength(1);
  }
  h.controller.dispose();
});

it("flushes valid fields but reports invalid remainder as unsaved", async () => {
  const h = setup();
  h.controller.update({ ...h.fields, purpose: "Материалы", amount_rub: "-" });
  expect(await h.controller.flush()).toBe(false);
  expect(h.server.store.get(h.item.id)).toMatchObject({ purpose: "Материалы", amount_rub: null });
  expect(h.controller.state.status).toBe("invalid");
  h.controller.dispose();
});

it("does not save for a different company or invoke callbacks after disposal", async () => {
  const h = setup();
  await createApi(h.server.fetcher).login("demo-client-2");
  h.controller.update({ ...h.fields, purpose: "Чужой профиль" });
  expect(await h.controller.flush()).toBe(false);
  expect(h.server.fetcher.mock.calls.filter(([, o]) => o?.method === "PATCH")).toHaveLength(0);
  h.controller.dispose();
  h.controller.update({ ...h.fields, purpose: "После закрытия" });
  await tick(5000);
  expect(h.saved).not.toHaveBeenCalled();
});

it.each([1, 2])("rejects an unconfirmed successful response with version %i", async version => {
  const h = setup();
  const api = { ...createApi(h.server.fetcher), update: vi.fn()
    .mockResolvedValueOnce(application({ version }))
    .mockRejectedValue(new ApiError(503, "SERVER_ERROR", "Stop invalid retries")) };
  const controller = new DraftAutosave(api, h.item, h.saved, vi.fn());
  controller.update({ ...h.fields, purpose: "Новая цель" });
  expect(await controller.flush()).toBe(false);
  expect(controller.state.error?.status).toBe(502);
  expect(api.update).toHaveBeenCalledTimes(1);
  expect(h.saved).not.toHaveBeenCalled();
  controller.dispose();
  h.controller.dispose();
});

it.each([
  { amount_rub: undefined },
  { status: undefined },
  { usage_days: "14" },
  { product_code: "unknown" },
  { created_at: null },
])("rejects an incomplete or malformed full snapshot: %j", async invalid => {
  const h = setup();
  const api = { ...createApi(h.server.fetcher), update: vi.fn()
    .mockResolvedValueOnce({ ...application({ purpose: "Новая цель", version: 2 }), ...invalid })
    .mockRejectedValue(new ApiError(503, "STOP", "Bound invalid response loop")) };
  const controller = new DraftAutosave(api, h.item, h.saved, vi.fn());
  controller.update({ ...h.fields, purpose: "Новая цель" });
  expect(await controller.flush()).toBe(false);
  expect(controller.state.error?.status).toBe(502);
  expect(api.update).toHaveBeenCalledTimes(1);
  expect(h.saved).not.toHaveBeenCalled();
  controller.dispose();
  h.controller.dispose();
});
