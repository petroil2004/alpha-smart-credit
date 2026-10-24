import { flushStep } from "./test/save-helpers";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { createApi } from "./api";
import { application, contractServer } from "./test/api-fixtures";

beforeEach(() => window.history.replaceState(null, "", "/"));
async function open(purpose: string | null = null) {
  const item = application({ purpose });
  window.history.replaceState(null, "", `/#draft/${item.id}`);
  const server = contractServer({ loggedIn: true, applications: [item] });
  const api = createApi(server.fetcher);
  const user = userEvent.setup();
  const view = render(<App api={api} />);
  await screen.findByRole("heading", { name: "Выберите продукт" });
  return { user, server, api, item, ...view };
}
async function parameters(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Перейти к шагу «Параметры»" }));
}

it("saves a custom purpose across steps and a page reload", async () => {
  const h = await open("Купить холодильную витрину");
  await parameters(h.user);
  await h.user.type(screen.getByLabelText("На что нужны средства"), " для магазина");
  await h.user.click(screen.getByRole("button", { name: "Продолжить" }));
  await flushStep(h.user);
  await screen.findByText("Изменения сохранены");
  h.unmount();
  render(<App api={h.api} />);
  await h.user.click(await screen.findByRole("button", { name: "Перейти к шагу «Параметры»" }));
  expect(screen.getByLabelText("На что нужны средства")).toHaveValue("Купить холодильную витрину для магазина");
});

it("does not fill a fake purpose when saving an incomplete draft", async () => {
  const h = await open();
  await parameters(h.user);
  expect(screen.getByLabelText("На что нужны средства")).toHaveValue("");
  await flushStep(h.user);
  await screen.findByText("Изменения сохранены");
  expect(h.server.store.get(h.item.id)?.purpose).toBeNull();
});

it.each(["Купить оборудование", null])("replaces local purpose on explicit server reload with %s", async purpose => {
  const h = await open("Локальное описание");
  await parameters(h.user);
  fireEvent.change(screen.getByLabelText("На что нужны средства"), { target: { value: "Новые правки" } });
  h.server.store.set(h.item.id, application({ purpose, version: 2 }));
  await flushStep(h.user);
  await screen.findByRole("alert");
  vi.spyOn(window, "confirm").mockReturnValueOnce(true);
  await h.user.click(screen.getByRole("button", { name: "Загрузить сохранённую версию" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(screen.getByLabelText("На что нужны средства")).toHaveValue(purpose ?? "");
});

it("checks availability and keeps a disconnected assistant optional", async () => {
  const h = await open();
  const toggle = screen.getByRole("button", { name: "Помочь с выбором" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  await h.user.click(toggle);
  const preview = within(screen.getByRole("region", { name: "Помощник по финансированию" }));
  expect(await preview.findByText(/Помощник временно недоступен/)).toBeInTheDocument();
  expect(preview.getByRole("textbox", { name: "Сообщение помощнику" })).toBeDisabled();
  expect(preview.getByRole("button", { name: "Отправить сообщение" })).toBeDisabled();
  await h.user.click(screen.getByRole("button", { name: "Свернуть помощника" }));
  expect(screen.queryByRole("region", { name: "Помощник по финансированию" })).not.toBeInTheDocument();
  expect(h.server.fetcher.mock.calls.filter(([url])=>String(url).endsWith('/assistant/status'))).toHaveLength(1);
  expect(h.server.fetcher.mock.calls.some(([url])=>String(url).endsWith('/assistant/chat'))).toBe(false);
});

it("keeps assistant expansion when returning to product and hides it elsewhere", async () => {
  const h = await open();
  await h.user.click(screen.getByRole("button", { name: "Помочь с выбором" }));
  for (const step of ["Параметры", "Проверка"]) {
    await h.user.click(screen.getByRole("button", { name: `Перейти к шагу «${step}»` }));
    expect(screen.queryByRole("button", { name: "Помочь с выбором" })).not.toBeInTheDocument();
    await h.user.click(screen.getByRole("button", { name: "Перейти к шагу «Продукт»" }));
    expect(screen.getByRole("region", { name: "Помощник по финансированию" })).toBeInTheDocument();
  }
});
