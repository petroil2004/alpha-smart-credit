import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";
import App from "./App";
import { createApi } from "./api";
import { application, contractServer } from "./test/api-fixtures";

beforeEach(() => window.history.replaceState(null, "", "/"));
async function open(overrides: Parameters<typeof application>[0] = {}) {
  const item = application(overrides);
  const server = contractServer({ loggedIn: true, applications: [item] });
  const user = userEvent.setup();
  render(<App api={createApi(server.fetcher)} />);
  await user.click(await screen.findByRole("button", { name: /Открыть заявку/ }));
  return { user, server, item };
}

it("starts with products and has exactly three navigation steps", async () => {
  await open();
  expect(screen.getByRole("heading", { name: "Выберите продукт" })).toBeInTheDocument();
  const navigation = within(screen.getByRole("navigation", { name: "Шаги оформления" }));
  expect(navigation.getAllByRole("button")).toHaveLength(3);
  expect(navigation.queryByRole("button", { name: /Потребность/ })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("На что нужны средства")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Помочь с выбором" })).toBeInTheDocument();
});

it("puts a free purpose description after calculations without preset choices", async () => {
  const { user } = await open({ product_code: "working_capital", amount_rub: "1000000.00", term_months: 24 });
  await user.click(screen.getByRole("button", { name: "Продолжить" }));
  expect(screen.getByRole("heading", { name: "Настройте условия" })).toBeInTheDocument();
  const purpose = screen.getByLabelText("На что нужны средства");
  const calculation = screen.getByRole("region", { name: "Предварительный расчёт платежа" });
  expect(calculation.compareDocumentPosition(purpose) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  expect(purpose).toHaveAttribute("maxlength", "500");
  expect(screen.queryByRole("button", { name: "Помочь с выбором" })).not.toBeInTheDocument();
});

it.each(["Закупить товар или материалы", "Новая партия обуви к зиме"])("preserves old purpose %s as ordinary text", async (purpose) => {
  const { user, server, item } = await open({ purpose });
  await user.click(screen.getByRole("button", { name: "Продолжить" }));
  expect(screen.getByLabelText("На что нужны средства")).toHaveValue(purpose);
  fireEvent.change(screen.getByLabelText("На что нужны средства"), { target: { value: purpose + ", для магазина" } });
  await user.click(screen.getByRole("button", { name: "Продолжить" }));
  await screen.findByText("Изменения сохранены");
  expect(server.store.get(item.id)?.purpose).toBe(purpose + ", для магазина");
  await user.click(screen.getByRole("button", { name: "Изменить потребность" }));
  expect(screen.getByRole("heading", { name: "Настройте условия" })).toBeInTheDocument();
  expect(screen.getByLabelText("На что нужны средства")).toHaveValue(purpose + ", для магазина");
});

it("sends a hidden invalid amount back to parameters and focuses it", async () => {
  const { user } = await open();
  await user.click(screen.getByRole("button", { name: "Продолжить" }));
  fireEvent.change(screen.getByLabelText("Сумма финансирования"), { target: { value: "-1" } });
  await user.click(screen.getByRole("button", { name: "Продолжить" }));
  await user.click(screen.getByRole("button", { name: "Сохранить и выйти" }));
  const input = await screen.findByLabelText("Сумма финансирования");
  expect(input).toHaveValue("-1");
  expect(input).toHaveFocus();
  expect(screen.getByRole("button", { name: "Перейти к шагу «Параметры»" })).toHaveAttribute("aria-current", "step");
});

it("edits the shared amount and inflows for overdraft without an annuity payment", async () => {
  const { user, server, item } = await open({ product_code: "overdraft" });
  await user.click(screen.getByRole("button", { name: "Продолжить" }));
  fireEvent.change(screen.getByLabelText("Сумма финансирования"), { target: { value: "100000,25" } });
  fireEvent.change(screen.getByLabelText("Пользование, дней"), { target: { value: "14" } });
  fireEvent.change(screen.getByLabelText("Сумма ожидаемого поступления"), { target: { value: "150000" } });
  await user.click(screen.getByRole("button", { name: "Продолжить" }));
  await screen.findByText("Изменения сохранены");
  expect(server.store.get(item.id)).toMatchObject({ amount_rub: "100000.25", usage_days: 14, expected_inflow_amount_rub: "150000.00" });
  expect(screen.queryByText("Ежемесячный платёж")).not.toBeInTheDocument();
});
