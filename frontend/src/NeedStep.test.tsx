import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";
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
  await screen.findByRole("heading", { name: "Для чего нужны деньги?" });
  return { user, server, api, item, ...view };
}

it.each([
  "Закупить товар или материалы",
  "Купить оборудование",
  "Дождаться оплаты от покупателя",
  "Подготовиться к сезону",
])("saves preset %s only on explicit save and restores selection", async (purpose) => {
  const h = await open();
  expect(screen.queryByLabelText("На что нужны средства")).not.toBeInTheDocument();
  await h.user.click(screen.getByRole("radio", { name: purpose }));
  expect(h.server.store.get(h.item.id)?.purpose).toBeNull();
  expect(h.server.fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
  await h.user.click(screen.getByRole("button", { name: "Перейти к шагу «Проверка»" }));
  expect(within(screen.getByRole("region", { name: "Сводка черновика" })).getByText(purpose)).toBeInTheDocument();
  await h.user.click(screen.getByRole("button", { name: "Сохранить черновик" }));
  await screen.findByText("Черновик сохранён");
  expect(h.server.store.get(h.item.id)).toMatchObject({ purpose, product_code: null });
  h.unmount();
  render(<App api={h.api} />);
  expect(await screen.findByRole("radio", { name: purpose })).toBeChecked();
  expect(screen.queryByLabelText("На что нужны средства")).not.toBeInTheDocument();
});

it("retains custom description across preset choices, steps and saved reload", async () => {
  const h = await open("Купить холодильную витрину");
  expect(screen.getByRole("radio", { name: "Другое" })).toBeChecked();
  const input = screen.getByLabelText("На что нужны средства");
  await h.user.type(input, " для магазина");
  await h.user.click(screen.getByRole("radio", { name: "Купить оборудование" }));
  expect(screen.queryByLabelText("На что нужны средства")).not.toBeInTheDocument();
  await h.user.click(screen.getByRole("button", { name: "Продолжить" }));
  await h.user.click(screen.getByRole("button", { name: "Перейти к шагу «Потребность»" }));
  await h.user.click(screen.getByRole("radio", { name: "Другое" }));
  expect(screen.getByLabelText("На что нужны средства")).toHaveValue("Купить холодильную витрину для магазина");
  await h.user.click(screen.getByRole("button", { name: "Сохранить черновик" }));
  await screen.findByText("Черновик сохранён");
  h.unmount();
  render(<App api={h.api} />);
  expect(await screen.findByLabelText("На что нужны средства")).toHaveValue("Купить холодильную витрину для магазина");
  expect(screen.getByRole("radio", { name: "Другое" })).toBeChecked();
});

it("opens Other without filling a fake purpose and permits incomplete save", async () => {
  const h = await open();
  await h.user.click(screen.getByRole("radio", { name: "Другое" }));
  expect(screen.getByLabelText("На что нужны средства")).toHaveValue("");
  await h.user.click(screen.getByRole("button", { name: "Сохранить черновик" }));
  await screen.findByText("Черновик сохранён");
  expect(h.server.store.get(h.item.id)?.purpose).toBeNull();
});

it("opens and collapses a clearly disconnected assistant without sending anything", async () => {
  const h = await open();
  await h.user.click(screen.getByRole("radio", { name: "Купить оборудование" }));
  const before = h.server.fetcher.mock.calls.length;
  const toggle = screen.getByRole("button", { name: "Помочь с выбором" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  await h.user.click(toggle);
  const preview = within(screen.getByRole("region", { name: "Помощник по финансированию" }));
  expect(preview.getByText("Ассистент пока не подключён")).toBeInTheDocument();
  expect(preview.getByRole("textbox", { name: "Сообщение помощнику" })).toBeDisabled();
  expect(preview.getByRole("button", { name: "Отправить сообщение" })).toBeDisabled();
  await h.user.click(screen.getByRole("button", { name: "Свернуть помощника" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Помощник по финансированию" })).not.toBeInTheDocument());
  expect(screen.getByRole("radio", { name: "Купить оборудование" })).toBeChecked();
  expect(h.server.fetcher.mock.calls.length).toBe(before);
});
