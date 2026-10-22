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
    await screen.findByRole("button", { name: "Открыть черновик 000001" }),
  );
  return { user, server };
}

async function goTo(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(
    screen.getByRole("button", { name: `Перейти к шагу «${title}»` }),
  );
}

describe("draft wizard", () => {
  it("moves forward and back without losing input or saving implicitly", async () => {
    const { user, server } = await openDraft();
    expect(
      screen.getByRole("heading", { name: "Расскажите о потребности" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    await user.type(
      screen.getByLabelText("На что нужны средства"),
      "Товар к сезону",
    );
    await user.type(
      screen.getByLabelText("Сумма финансирования"),
      "500 000,25",
    );
    await user.click(screen.getByRole("button", { name: "Продолжить" }));
    await user.click(screen.getByRole("radio", { name: /Оборотный кредит/ }));
    await user.click(screen.getByRole("button", { name: "Продолжить" }));
    await user.type(screen.getByLabelText("Срок, месяцев"), "12");
    await user.click(
      screen.getByRole("button", { name: "Назад" }),
    );
    expect(
      screen.getByRole("radio", { name: /Оборотный кредит/ }),
    ).toBeChecked();
    await goTo(user, "Потребность");
    expect(screen.getByLabelText("На что нужны средства")).toHaveValue(
      "Товар к сезону",
    );
    expect(screen.getByLabelText("Сумма финансирования")).toHaveValue(
      "500 000,25",
    );
    await goTo(user, "Параметры");
    expect(screen.getByLabelText("Срок, месяцев")).toHaveValue("12");
    expect(
      server.fetcher.mock.calls.some(
        ([, options]) => options?.method === "PATCH",
      ),
    ).toBe(false);
  });

  it("reviews and saves an incomplete draft without claiming it was submitted", async () => {
    const { user, server } = await openDraft();
    await goTo(user, "Проверка");
    const summary = within(
      screen.getByRole("region", { name: "Сводка черновика" }),
    );
    expect(summary.getAllByText("Не указано").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /Отправить заявку/ }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Сохранить черновик" }),
    );
    expect(await screen.findByText("Черновик сохранён")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Проверьте черновик" }),
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
      screen.getByRole("region", { name: "Сводка черновика" }),
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
    await user.click(
      screen.getByRole("button", { name: "Сохранить черновик" }),
    );
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
    await goTo(user, "Проверка");
    await user.click(
      screen.getByRole("button", { name: "Сохранить черновик" }),
    );
    expect(
      await screen.findByLabelText("Сумма ожидаемого поступления"),
    ).toHaveValue("700000.00");
    expect(
      screen.getByText("Проверьте ожидаемое поступление"),
    ).toBeInTheDocument();
    await goTo(user, "Потребность");
    expect(screen.getByLabelText("На что нужны средства")).toHaveValue(
      "Сохранённая цель",
    );
    await goTo(user, "Проверка");
    await user.click(
      screen.getByRole("button", { name: "Сохранить черновик" }),
    );
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

  it("advances on Enter without implicitly saving", async () => {
    const { user, server } = await openDraft();
    const amount = screen.getByLabelText("Сумма финансирования");
    await user.type(amount, "500000");
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("heading", { name: "Выберите продукт" }),
    ).toBeInTheDocument();
    expect(
      server.fetcher.mock.calls.some(
        ([, options]) => options?.method === "PATCH",
      ),
    ).toBe(false);
  });

  it("saves from the middle step and reopens all fields after reload", async () => {
    const server = contractServer({ loggedIn: true });
    const user = userEvent.setup();
    const api = createApi(server.fetcher);
    const first = render(<App api={api} />);
    await user.click(
      await screen.findByRole("button", { name: "Новая заявка" }),
    );
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
    await user.click(
      screen.getByRole("button", { name: "Сохранить черновик" }),
    );
    await screen.findByText("Черновик сохранён");
    expect(screen.getByLabelText("Пользование, дней")).toHaveValue("14");
    first.unmount();
    render(<App api={api} />);
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
      screen.getByRole("heading", { name: "Расскажите о потребности" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("На что нужны средства")).toHaveValue("");
  });

  it("keeps the review and input on a failed save and allows retry", async () => {
    const { user, server } = await openDraft();
    await user.type(
      screen.getByLabelText("На что нужны средства"),
      "Не терять сводку",
    );
    await goTo(user, "Проверка");
    server.failNextSave(503);
    await user.click(
      screen.getByRole("button", { name: "Сохранить черновик" }),
    );
    await screen.findByRole("alert");
    expect(
      within(
        screen.getByRole("region", { name: "Сводка черновика" }),
      ).getByText("Не терять сводку"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Черновик сохранён")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Сохранить черновик" }),
    );
    expect(await screen.findByText("Черновик сохранён")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Проверьте черновик" }),
    ).toBeInTheDocument();
  });

  it("disables navigation and duplicate saves while saving", async () => {
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
    await goTo(user, "Проверка");
    await user.click(
      screen.getByRole("button", { name: "Сохранить черновик" }),
    );
    expect(
      await screen.findByRole("button", { name: "Сохраняем…" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Перейти к шагу «Потребность»" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Изменить параметры" }),
    ).toBeDisabled();
    await act(async () => {
      release();
    });
    expect(await screen.findByText("Черновик сохранён")).toBeInTheDocument();
  });
});
