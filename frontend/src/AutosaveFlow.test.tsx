import {flushStep,openParameters} from "./test/save-helpers";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { createApi } from "./api";
import { application, contractServer } from "./test/api-fixtures";

beforeEach(() => window.history.replaceState(null, "", "/#draft/00000000-0000-4000-8000-000000000001"));
async function setup() {
  const item = application({ purpose: "Цель", product_code:"working_capital" });
  const server = contractServer({ loggedIn: true, applications: [item] });
  const user = userEvent.setup();
  render(<App api={createApi(server.fetcher)} />);
  await screen.findByRole("button", { name: "Перейти к шагу «Параметры»" });
  await openParameters(user);
  return { item, server, user };
}

it("automatically saves after a pause without a save button or input normalization", async () => {
  const h = await setup();
  const input = screen.getByLabelText("Сумма финансирования");
  fireEvent.change(input, { target: { value: "1 500,25" } });
  expect(screen.queryByRole("button", { name: "Сохранить черновик" })).not.toBeInTheDocument();
  await waitFor(() => expect(h.server.store.get(h.item.id)?.amount_rub).toBe("1500.25"), { timeout: 3000 });
  expect(input).toHaveValue("1 500,25");
  expect(screen.getByRole("status", { name: "Состояние сохранения" })).toHaveTextContent("Изменения сохранены");
});

it("keeps navigation and input active during a delayed save and drains newer edits", async () => {
  const h = await setup();
  let release!: () => void;
  h.server.holdSaves(new Promise<void>(resolve => { release = resolve; }));
  fireEvent.change(screen.getByLabelText("На что нужны средства"), { target: { value: "Первый ввод" } });
  await h.user.click(screen.getByRole("button", { name: "Перейти к шагу «Продукт»" }));
  await waitFor(() => expect(h.server.fetcher.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
  expect(screen.getByRole("button", { name: "Продолжить" })).not.toBeDisabled();
  await h.user.click(screen.getByRole("button", { name: "Перейти к шагу «Параметры»" }));
  fireEvent.change(screen.getByLabelText("На что нужны средства"), { target: { value: "Новый ввод" } });
  expect(screen.getByLabelText("На что нужны средства")).not.toBeDisabled();
  await act(async () => release());
  await waitFor(() => expect(h.server.store.get(h.item.id)?.purpose).toBe("Новый ввод"));
  expect(screen.getByLabelText("На что нужны средства")).toHaveValue("Новый ввод");
});

it("saves valid fields without moving away from an invalid intermediate field", async () => {
  const h = await setup();
  fireEvent.change(screen.getByLabelText("На что нужны средства"), { target: { value: "Новая цель" } });
  fireEvent.change(screen.getByLabelText("Сумма финансирования"), { target: { value: "," } });
  await h.user.click(screen.getByRole("button", { name: "Перейти к шагу «Продукт»" }));
  await waitFor(() => expect(h.server.store.get(h.item.id)?.purpose).toBe("Новая цель"));
  expect(screen.getByRole("heading", { name: "Выберите продукт" })).toBeInTheDocument();
  expect(h.server.store.get(h.item.id)?.amount_rub).toBeNull();
  expect(screen.getByRole("button", { name: "Перейти к шагу «Проверка»" })).toBeDisabled();
  await h.user.click(screen.getByRole("button",{name:"Перейти к шагу «Параметры»"}));
  await flushStep(h.user);
  expect(await screen.findByLabelText("Сумма финансирования")).toHaveValue(",");
  expect(screen.getByLabelText("Сумма финансирования")).toHaveAttribute("aria-invalid", "true");
});

it("final action waits for saving before returning to the application list", async () => {
  const h = await setup();
  let release!: () => void;
  h.server.holdSaves(new Promise<void>(resolve => { release = resolve; }));
  fireEvent.change(screen.getByLabelText("На что нужны средства"), { target: { value: "Сохранить перед выходом" } });
  expect(screen.getByRole("button", { name: "Перейти к шагу «Проверка»" })).toBeDisabled();
  await h.user.click(screen.getByRole("button",{name:"Все заявки"}));
  expect(screen.queryByRole("heading", { name: "Мои заявки" })).not.toBeInTheDocument();
  await act(async () => release());
  expect(await screen.findByRole("heading", { name: "Мои заявки" })).toBeInTheDocument();
  expect(screen.getByText("Сохранить перед выходом")).toBeInTheDocument();
});

it("failed leave stays in the form on cancellation and can retry", async () => {
  const h = await setup();
  h.server.failNextSave(503);
  fireEvent.change(screen.getByLabelText("На что нужны средства"), { target: { value: "Не потерять" } });
  vi.spyOn(window, "confirm").mockReturnValueOnce(false);
  await h.user.click(screen.getByRole("button", { name: "Все заявки" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByLabelText("На что нужны средства")).toHaveValue("Не потерять");
  await h.user.click(screen.getByRole("button", { name: "Повторить сохранение" }));
  await waitFor(() => expect(h.server.store.get(h.item.id)?.purpose).toBe("Не потерять"));
});

it("clears validation markers for parameters removed by a product change", async () => {
  const h = await setup();
  await h.user.click(screen.getByRole("button", { name: "Перейти к шагу «Продукт»" }));
  await h.user.click(screen.getByRole("radio", { name: /Овердрафт/ }));
  await h.user.click(screen.getByRole("button", { name: "Перейти к шагу «Параметры»" }));
  fireEvent.change(screen.getByLabelText("Пользование, дней"), { target: { value: "x" } });
  expect(screen.getByRole("button", { name: "Перейти к шагу «Проверка»" })).toBeDisabled();
  await flushStep(h.user);
  expect(await screen.findByLabelText("Пользование, дней")).toHaveAttribute("aria-invalid", "true");
  await h.user.click(screen.getByRole("button", { name: "Перейти к шагу «Продукт»" }));
  await h.user.click(screen.getByRole("radio", { name: /Оборотный/ }));
  await flushStep(h.user);
  await waitFor(() => expect(h.server.store.get(h.item.id)?.product_code).toBe("working_capital"));
  expect(screen.getByRole("button", { name: "Перейти к шагу «Параметры»" })).not.toHaveClass("has-error");
});
