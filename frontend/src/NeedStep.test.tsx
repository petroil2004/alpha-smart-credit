import { flushStep } from "./test/save-helpers";
import { render, screen, waitFor, within } from "@testing-library/react";
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
  await screen.findByRole("heading", { name: "Для чего нужны деньги?" });
  return { user, server, api, item, ...view };
}

it.each([
  "Закупить товар или материалы",
  "Купить оборудование",
  "Дождаться оплаты от покупателя",
  "Подготовиться к сезону",
])("saves preset %s on navigation and restores selection", async (purpose) => {
  const h = await open();
  expect(screen.queryByLabelText("На что нужны средства")).not.toBeInTheDocument();
  await h.user.click(screen.getByRole("radio", { name: purpose }));
  expect(h.server.store.get(h.item.id)?.purpose).toBeNull();
  expect(h.server.fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
  await h.user.click(screen.getByRole("button", { name: "Перейти к шагу «Проверка»" }));
  expect(within(screen.getByRole("region", { name: "Сводка заявки" })).getByText(purpose)).toBeInTheDocument();
  await flushStep(h.user);
  await screen.findByText("Изменения сохранены");
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
  await flushStep(h.user);
  await screen.findByText("Изменения сохранены");
  h.unmount();
  render(<App api={h.api} />);
  expect(await screen.findByLabelText("На что нужны средства")).toHaveValue("Купить холодильную витрину для магазина");
  expect(screen.getByRole("radio", { name: "Другое" })).toBeChecked();
});

it("opens Other without filling a fake purpose and permits incomplete save", async () => {
  const h = await open();
  await h.user.click(screen.getByRole("radio", { name: "Другое" }));
  expect(screen.getByLabelText("На что нужны средства")).toHaveValue("");
  await flushStep(h.user);
  await screen.findByText("Изменения сохранены");
  expect(h.server.store.get(h.item.id)?.purpose).toBeNull();
});

it.each(["Купить оборудование", null])("discards local purpose selection and buffer when reloading server purpose %s", async (purpose) => {
  const h = await open("Локальное описание, от которого откажусь");
  await h.user.click(screen.getByRole("radio", { name: "Подготовиться к сезону" }));
  await h.user.click(screen.getByRole("radio", { name: "Другое" }));
  await h.user.type(screen.getByLabelText("На что нужны средства"), " — новые правки");
  h.server.store.set(h.item.id, application({ purpose, version: 2 }));
  await flushStep(h.user);
  await screen.findByRole("alert");
  vi.spyOn(window, "confirm").mockReturnValueOnce(true);
  await h.user.click(screen.getByRole("button", { name: "Загрузить сохранённую версию" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  if (purpose) expect(screen.getByRole("radio", { name: purpose })).toBeChecked();
  expect(screen.getByRole("radio", { name: "Другое" })).not.toBeChecked();
  expect(screen.queryByLabelText("На что нужны средства")).not.toBeInTheDocument();
  await h.user.click(screen.getByRole("radio", { name: "Другое" }));
  expect(screen.getByLabelText("На что нужны средства")).toHaveValue("");
});

it("keeps custom buffer and wizard step after autosave of a preset", async () => {
  const h = await open("Моё описание");
  await h.user.click(screen.getByRole("radio", { name: "Купить оборудование" }));
  await h.user.click(screen.getByRole("button", { name: "Продолжить" }));
  await flushStep(h.user);
  await screen.findByText("Изменения сохранены");
  expect(screen.getByRole("heading", { name: "Выберите продукт" })).toBeInTheDocument();
  await h.user.click(screen.getByRole("button", { name: "Перейти к шагу «Потребность»" }));
  await h.user.click(screen.getByRole("radio", { name: "Другое" }));
  expect(screen.getByLabelText("На что нужны средства")).toHaveValue("Моё описание");
});

it("opens and collapses a clearly disconnected assistant without sending anything", async () => {
  const h = await open();
  await h.user.click(screen.getByRole("radio", { name: "Купить оборудование" }));
  expect(screen.queryByRole("button", { name: "Помочь с выбором" })).not.toBeInTheDocument();
  await h.user.click(screen.getByRole("button", { name: "Продолжить" }));
  await screen.findByText("Изменения сохранены");
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
  expect(screen.getByRole("heading", { name: "Выберите продукт" })).toBeInTheDocument();
  expect(h.server.fetcher.mock.calls.length).toBe(before);
});


it("keeps assistant expansion on returning to product, hidden on all other steps", async () => {
  const h = await open();
  await h.user.click(screen.getByRole("button", { name: "Продолжить" }));
  await h.user.click(screen.getByRole("button", { name: "Помочь с выбором" }));
  for (const step of ["Потребность", "Параметры", "Проверка"]) {
    await h.user.click(screen.getByRole("button", { name: `Перейти к шагу «${step}»` }));
    expect(screen.queryByRole("region", { name: "Помощник по финансированию" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Помочь с выбором" })).not.toBeInTheDocument();
    await h.user.click(screen.getByRole("button", { name: "Перейти к шагу «Продукт»" }));
    expect(screen.getByRole("region", { name: "Помощник по финансированию" })).toBeInTheDocument();
  }
});
