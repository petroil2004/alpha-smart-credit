import { flushStep } from "./test/save-helpers";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { createApi } from "./api";
import { application, contractServer } from "./test/api-fixtures";

beforeEach(() => window.history.replaceState(null, "", "/"));

async function openDraft(
  server = contractServer({ loggedIn: true, applications: [application()] }),
  fetcher: typeof fetch = server.fetcher,
) {
  const user = userEvent.setup();
  render(<App api={createApi(fetcher)} />);
  await user.click(
    await screen.findByRole("button", { name: "Открыть заявку 000001" }),
  );
  await user.click(await screen.findByRole("button", { name: "Перейти к шагу «Параметры»" }));
  return { user, server };
}

async function goTo(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(
    screen.getByRole("button", { name: `Перейти к шагу «${title}»` }),
  );
}

describe("draft wizard", () => {
  it("moves forward and back without losing raw input while autosaving", async () => {
    const { user, server } = await openDraft();
    expect(
      screen.getByRole("heading", { name: "Настройте условия" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Оборотный кредит/ })).not.toBeInTheDocument();
    await user.type(
      screen.getByLabelText("На что нужны средства"),
      "Товар к сезону",
    );
    await user.type(
      screen.getByLabelText("Сумма финансирования"),
      "500 000,25",
    );
    await goTo(user, "Продукт");
    await user.click(screen.getByRole("radio", { name: /Оборотный кредит/ }));
    await user.click(screen.getByRole("button", { name: "Продолжить" }));
    await user.type(screen.getByLabelText("Срок, месяцев"), "12");
    await user.click(
      screen.getByRole("button", { name: "Назад" }),
    );
    expect(
      screen.getByRole("radio", { name: /Оборотный кредит/ }),
    ).toBeChecked();
    await goTo(user, "Параметры");
    expect(screen.getByLabelText("На что нужны средства")).toHaveValue(
      "Товар к сезону",
    );
    expect(screen.getByLabelText("Сумма финансирования")).toHaveValue(
      "500 000,25",
    );
    await goTo(user, "Параметры");
    expect(screen.getByLabelText("Срок, месяцев")).toHaveValue("12");
    expect(server.store.get(application().id)).toMatchObject({ purpose: "Товар к сезону", amount_rub: "500000.25", term_months: 12 });
  });

  it("reviews and saves an incomplete draft without claiming it was submitted", async () => {
    const { user, server } = await openDraft();
    await goTo(user, "Проверка");
    const summary = within(
      screen.getByRole("region", { name: "Сводка заявки" }),
    );
    expect(summary.getAllByText("Не указано").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /Отправить заявку/ }),
    ).not.toBeInTheDocument();
    await flushStep(user);
    expect(await screen.findByText("Изменения сохранены")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Проверьте заявку" }),
    ).toBeInTheDocument();
    expect(server.store.get(application().id)?.product_code).toBeNull();
  });

  it("shows exact money and allows editing from review", async () => {
    const server = contractServer({
      loggedIn: true,
      applications: [
        application({
          purpose: "Станок",
          product_code: "equipment",
          amount_rub: "9007199254740993.01",
          term_months: 24,
        }),
      ],
    });
    const { user } = await openDraft(server);
    await goTo(user, "Проверка");
    const summary = within(
      screen.getByRole("region", { name: "Сводка заявки" }),
    );
    expect(summary.getByText("9 007 199 254 740 993,01 ₽")).toBeInTheDocument();
    expect(summary.getByText("Станок")).toBeInTheDocument();
    await user.click(
      summary.getByRole("button", { name: "Изменить параметры" }),
    );
    expect(screen.getByLabelText("Срок, месяцев")).toHaveValue("24");
  });

  it("opens the owner step for a hidden client-side field error", async () => {
    const { user, server } = await openDraft();
    await user.type(screen.getByLabelText("Сумма финансирования"), "-12");
    await goTo(user, "Проверка");
    await user.click(screen.getByRole("button", { name: "Сохранить и выйти" }));
    expect(await screen.findByLabelText("Сумма финансирования")).toHaveValue(
      "-12",
    );
    expect(screen.getByLabelText("Сумма финансирования")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(
      server.fetcher.mock.calls.some(
        ([, options]) => options?.method === "PATCH",
      ),
    ).toBe(false);
  });

  it("opens the owner step for a server field error and keeps other steps", async () => {
    const server = contractServer({
      loggedIn: true,
      applications: [
        application({
          purpose: "Сохранённая цель",
          product_code: "overdraft",
          usage_days: 14,
          expected_inflow_amount_rub: "700000.00",
        }),
      ],
    });
    const fetcher: typeof fetch = async (url, options) =>
      options?.method === "PATCH"
        ? new Response(
            JSON.stringify({
              error: {
                code: "VALIDATION_ERROR",
                message: "Проверьте поля",
                fields: {
                  expected_inflow_amount_rub: "Проверьте ожидаемое поступление",
                },
              },
            }),
            { status: 422 },
          )
        : server.fetcher(url, options);
    const { user } = await openDraft(server, fetcher);
    await goTo(user, "Параметры");
    fireEvent.change(screen.getByLabelText("Сумма ожидаемого поступления"), { target: { value: "700000.01" } });
    await goTo(user, "Проверка");
    await user.click(screen.getByRole("button", { name: "Сохранить и выйти" }));
    expect(
      await screen.findByLabelText("Сумма ожидаемого поступления"),
    ).toHaveValue("700000.01");
    expect(
      screen.getByText("Проверьте ожидаемое поступление"),
    ).toBeInTheDocument();
    await goTo(user, "Параметры");
    expect(screen.getByLabelText("На что нужны средства")).toHaveValue(
      "Сохранённая цель",
    );
    await goTo(user, "Проверка");
    await user.click(screen.getByRole("button", { name: "Сохранить и выйти" }));
    expect(
      await screen.findByLabelText("Сумма ожидаемого поступления"),
    ).toHaveAttribute("aria-invalid", "true");
  });

  it("does not invent duration fields before product selection", async () => {
    const { user } = await openDraft();
    await goTo(user, "Параметры");
    expect(screen.queryByLabelText("Срок, месяцев")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Пользование, дней"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Выбрать продукт" }));
    expect(
      screen.getByRole("radio", { name: /Овердрафт/ }),
    ).toBeInTheDocument();
  });

  it("advances on Enter and flushes pending changes", async () => {
    const { user, server } = await openDraft();
    const amount = screen.getByLabelText("Сумма финансирования");
    await user.type(amount, "500000");
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("heading", { name: "Проверьте заявку" }),
    ).toBeInTheDocument();
    expect(server.store.get(application().id)?.amount_rub).toBe("500000.00");
  });

  it("saves from the middle step and reopens all fields after reload", async () => {
    const server = contractServer({ loggedIn: true });
    const user = userEvent.setup();
    const api = createApi(server.fetcher);
    const first = render(<App api={api} />);
    await user.click(
      await screen.findByRole("button", { name: "Новая заявка" }),
    );
    await user.click(await screen.findByRole("button", { name: "Перейти к шагу «Параметры»" }));
    await user.type(
      screen.getByLabelText("На что нужны средства"),
      "До поступления оплаты",
    );
    await goTo(user, "Продукт");
    await user.click(screen.getByRole("radio", { name: /Овердрафт/ }));
    await goTo(user, "Параметры");
    await user.type(screen.getByLabelText("Пользование, дней"), "14");
    fireEvent.change(screen.getByLabelText("Дата ожидаемого поступления"), {
      target: { value: "2026-11-05" },
    });
    await user.type(
      screen.getByLabelText("Сумма ожидаемого поступления"),
      "700000",
    );
    await flushStep(user);
    await screen.findByText("Изменения сохранены");
    expect(screen.getByLabelText("Пользование, дней")).toHaveValue("14");
    first.unmount();
    render(<App api={api} />);
    await user.click(await screen.findByRole("button", { name: "Перейти к шагу «Параметры»" }));
    expect(await screen.findByLabelText("На что нужны средства")).toHaveValue(
      "До поступления оплаты",
    );
    await goTo(user, "Параметры");
    expect(screen.getByLabelText("Пользование, дней")).toHaveValue("14");
    expect(screen.getByLabelText("Дата ожидаемого поступления")).toHaveValue(
      "2026-11-05",
    );
    expect(screen.getByLabelText("Сумма ожидаемого поступления")).toHaveValue(
      "700000.00",
    );
  });

  it("starts another application at the first step without old form data", async () => {
    const { user } = await openDraft();
    await goTo(user, "Проверка");
    await user.click(
      screen.getByRole("button", { name: "Все заявки" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Новая заявка" }),
    );
    expect(
      screen.getByRole("heading", { name: "Выберите продукт" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("На что нужны средства")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Оборотный кредит/ })).not.toBeChecked();
  });

  it("keeps the review and input on a failed save and allows retry", async () => {
    const { user, server } = await openDraft();
    await user.type(
      screen.getByLabelText("На что нужны средства"),
      "Не терять сводку",
    );
    server.failNextSave(503);
    await goTo(user, "Проверка");
    await flushStep(user);
    await screen.findByRole("alert");
    expect(
      within(
        screen.getByRole("region", { name: "Сводка заявки" }),
      ).getByText("Не терять сводку"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Изменения сохранены")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Повторить сохранение" }));
    expect(await screen.findByText("Изменения сохранены")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Проверьте заявку" }),
    ).toBeInTheDocument();
  });

  it("disables navigation and duplicate final actions while finishing", async () => {
    const server = contractServer({
      loggedIn: true,
      applications: [application()],
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher: typeof fetch = async (url, options) => {
      if (options?.method === "PATCH") await gate;
      return server.fetcher(url, options);
    };
    const { user } = await openDraft(server, fetcher);
    await user.type(screen.getByLabelText("На что нужны средства"), "Для проверки выхода");
    await goTo(user, "Проверка");
    await user.click(screen.getByRole("button", { name: "Сохранить и выйти" }));
    expect(
      await screen.findByRole("button", { name: "Сохраняем…" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Перейти к шагу «Параметры»" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Изменить параметры" }),
    ).toBeDisabled();
    await act(async () => {
      release();
    });
    expect(await screen.findByRole("heading", { name: "Мои заявки" })).toBeInTheDocument();
  });
});
