import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createApi } from "./api";
import { application, contractServer } from "./test/api-fixtures";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

async function openExisting(
  server = contractServer({ loggedIn: true, applications: [application()] }),
) {
  const user = userEvent.setup();
  const view = render(<App api={createApi(server.fetcher)} />);
  await user.click(
    await screen.findByRole("button", { name: /Открыть черновик/ }),
  );
  await screen.findByRole("textbox", { name: "На что нужны средства" });
  return { user, server, ...view };
}

describe("client draft journey", () => {
  it("clears a stale profile before creating after another tab signs in", async () => {
    const server = contractServer({ loggedIn: true });
    const api = createApi(server.fetcher);
    const user = userEvent.setup();
    const first = render(<App api={api} />);
    const second = render(<App api={api} />);
    const oldTab = within(first.container);
    const newTab = within(second.container);
    await oldTab.findByRole("button", { name: "Новая заявка" });
    await user.click(
      await newTab.findByRole("button", { name: "Сменить профиль" }),
    );
    await user.selectOptions(
      newTab.getByLabelText("Демонстрационный профиль"),
      "demo-client-2",
    );
    await user.click(newTab.getByRole("button", { name: "Войти в кабинет" }));
    await newTab.findByText("ООО «Демо Мастерская»");
    await user.click(oldTab.getByRole("button", { name: "Новая заявка" }));
    expect(await oldTab.findByRole("alert")).toHaveTextContent(
      "Профиль изменился",
    );
    expect(
      oldTab.getByRole("button", { name: "Войти в кабинет" }),
    ).toBeInTheDocument();
    expect(
      oldTab.queryByRole("navigation", { name: "Основная навигация" }),
    ).not.toBeInTheDocument();
    expect(
      oldTab.queryByRole("textbox", { name: "На что нужны средства" }),
    ).not.toBeInTheDocument();
    expect(server.store.size).toBe(0);
  });

  it("rejects a different company's response if the session changes during creation", async () => {
    const server = contractServer({ loggedIn: true });
    const api = createApi(server.fetcher);
    let finish!: () => void;
    server.holdCreates(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<App api={api} />);
    await user.click(
      await screen.findByRole("button", { name: "Новая заявка" }),
    );
    await waitFor(() =>
      expect(
        server.fetcher.mock.calls.some(
          ([, options]) => options?.method === "POST",
        ),
      ).toBe(true),
    );
    await act(async () => {
      await api.login("demo-client-2");
      finish();
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Профиль изменился",
    );
    expect(
      screen.getByRole("button", { name: "Войти в кабинет" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Основная навигация" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "На что нужны средства" }),
    ).not.toBeInTheDocument();
  });

  it("signs into a demo profile and shows the empty cabinet", async () => {
    const server = contractServer();
    const user = userEvent.setup();
    render(<App api={createApi(server.fetcher)} />);
    await user.click(
      await screen.findByRole("button", { name: "Войти в кабинет" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Мои заявки" }),
    ).toBeInTheDocument();
    expect(screen.getByText("ООО «Демо Торг»")).toBeInTheDocument();
    expect(screen.getByText("Пока ни одной заявки")).toBeInTheDocument();
  });

  it("creates, edits, saves and reopens the server draft on a new page mount", async () => {
    const server = contractServer({ loggedIn: true });
    const api = createApi(server.fetcher);
    const user = userEvent.setup();
    const first = render(<App api={api} />);
    await user.click(
      await screen.findByRole("button", { name: "Новая заявка" }),
    );
    await user.type(
      await screen.findByRole("textbox", { name: "На что нужны средства" }),
      "Закупка материалов",
    );
    await user.click(screen.getByRole("radio", { name: /Оборотный кредит/ }));
    await user.type(
      screen.getByRole("textbox", { name: "Сумма финансирования" }),
      "1 500,25",
    );
    await user.type(screen.getByLabelText("Срок, месяцев"), "12");
    await user.click(
      screen.getByRole("button", { name: "Сохранить черновик" }),
    );
    expect(await screen.findByText("Черновик сохранён")).toBeInTheDocument();
    first.unmount();
    render(<App api={api} />);
    expect(
      await screen.findByRole("textbox", { name: "На что нужны средства" }),
    ).toHaveValue("Закупка материалов");
    expect(
      screen.getByRole("textbox", { name: "Сумма финансирования" }),
    ).toHaveValue("1500.25");
    expect(screen.getByLabelText("Срок, месяцев")).toHaveValue("12");
  });

  it("preserves unsaved input on a server failure", async () => {
    const { user, server } = await openExisting();
    await user.type(
      screen.getByRole("textbox", { name: "На что нужны средства" }),
      "Не терять этот текст",
    );
    server.failNextSave(503);
    await user.click(
      screen.getByRole("button", { name: "Сохранить черновик" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "временно недоступен",
    );
    expect(
      screen.getByRole("textbox", { name: "На что нужны средства" }),
    ).toHaveValue("Не терять этот текст");
    expect(screen.queryByText("Черновик сохранён")).not.toBeInTheDocument();
    expect(
      screen.getByText("Есть несохранённые изменения"),
    ).toBeInTheDocument();
  });

  it("does not overwrite a conflicting draft and reloads only after explicit confirmation", async () => {
    const { user, server } = await openExisting();
    await user.type(
      screen.getByRole("textbox", { name: "На что нужны средства" }),
      "Мой текст",
    );
    server.store.set(
      application().id,
      application({ purpose: "Сохранено в другом окне", version: 2 }),
    );
    await user.click(
      screen.getByRole("button", { name: "Сохранить черновик" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("изменена");
    expect(
      screen.getByRole("textbox", { name: "На что нужны средства" }),
    ).toHaveValue("Мой текст");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(
      screen.getByRole("button", { name: "Загрузить сохранённую версию" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "На что нужны средства" }),
      ).toHaveValue("Сохранено в другом окне"),
    );
  });

  it("clears previous company data and unsaved form when changing profile", async () => {
    const { user } = await openExisting();
    await user.type(
      screen.getByRole("textbox", { name: "На что нужны средства" }),
      "Сведения первой компании",
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Сменить профиль" }));
    await user.selectOptions(
      await screen.findByLabelText("Демонстрационный профиль"),
      "demo-client-2",
    );
    await user.click(screen.getByRole("button", { name: "Войти в кабинет" }));
    expect(
      await screen.findByText("ООО «Демо Мастерская»"),
    ).toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("Сведения первой компании"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Открыть черновик/ }),
    ).not.toBeInTheDocument();
  });

  it("clears incompatible fields when switching product mechanics", async () => {
    const { user } = await openExisting();
    await user.click(screen.getByRole("radio", { name: /Оборотный кредит/ }));
    await user.type(screen.getByLabelText("Срок, месяцев"), "24");
    await user.click(screen.getByRole("radio", { name: /Овердрафт/ }));
    expect(screen.queryByLabelText("Срок, месяцев")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Пользование, дней"), "14");
    await user.type(
      screen.getByLabelText("Сумма ожидаемого поступления"),
      "500000",
    );
    fireEvent.change(screen.getByLabelText("Дата ожидаемого поступления"), {
      target: { value: "2026-11-01" },
    });
    await user.click(
      screen.getByRole("radio", { name: /Кредит на оборудование/ }),
    );
    expect(screen.getByLabelText("Срок, месяцев")).toHaveValue("");
    await user.click(screen.getByRole("radio", { name: /Овердрафт/ }));
    expect(screen.getByLabelText("Пользование, дней")).toHaveValue("");
    expect(screen.getByLabelText("Сумма ожидаемого поступления")).toHaveValue(
      "",
    );
  });

  it("reuses the creation key after the first response failed", async () => {
    const server = contractServer({ loggedIn: true });
    const user = userEvent.setup();
    server.failNextCreateAfterCommit();
    render(<App api={createApi(server.fetcher)} />);
    await user.click(
      await screen.findByRole("button", { name: "Новая заявка" }),
    );
    await screen.findByRole("alert");
    await user.click(
      screen.getByRole("button", { name: "Повторить создание" }),
    );
    await screen.findByRole("textbox", { name: "На что нужны средства" });
    const creates = server.fetcher.mock.calls.filter(
      ([url, options]) =>
        url === "/api/v1/applications" && options?.method === "POST",
    );
    expect(creates).toHaveLength(2);
    expect(new Headers(creates[0][1]?.headers).get("Idempotency-Key")).toBe(
      new Headers(creates[1][1]?.headers).get("Idempotency-Key"),
    );
    expect(server.store.size).toBe(1);
  });

  it("does not create a second request on a double click while creation is pending", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const server = contractServer({ loggedIn: true });
    server.holdCreates(gate);
    const user = userEvent.setup();
    render(<App api={createApi(server.fetcher)} />);
    await user.dblClick(
      await screen.findByRole("button", { name: "Новая заявка" }),
    );
    expect(
      server.fetcher.mock.calls.filter(
        ([, options]) => options?.method === "POST",
      ),
    ).toHaveLength(1);
    await act(async () => {
      finish();
    });
    expect(
      await screen.findByRole("textbox", { name: "На что нужны средства" }),
    ).toBeInTheDocument();
  });

  it("opens the selected draft directly from the URL", async () => {
    const item = application({ purpose: "Открытие по ссылке" });
    window.history.replaceState(null, "", `/#draft/${item.id}`);
    const server = contractServer({ loggedIn: true, applications: [item] });
    render(<App api={createApi(server.fetcher)} />);
    expect(
      await screen.findByRole("textbox", { name: "На что нужны средства" }),
    ).toHaveValue("Открытие по ссылке");
  });

  it("allows reauthentication without losing the edited draft", async () => {
    const { user, server } = await openExisting();
    await user.type(
      screen.getByRole("textbox", { name: "На что нужны средства" }),
      "Ввод до истечения сессии",
    );
    server.failNextSave(401);
    await user.click(
      screen.getByRole("button", { name: "Сохранить черновик" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Войти снова" }),
    );
    expect(
      screen.getByRole("textbox", { name: "На что нужны средства" }),
    ).toHaveValue("Ввод до истечения сессии");
    await user.click(
      screen.getByRole("button", { name: "Сохранить черновик" }),
    );
    expect(await screen.findByText("Черновик сохранён")).toBeInTheDocument();
  });

  it("keeps unsaved input when leaving the form is declined", async () => {
    const { user } = await openExisting();
    await user.type(
      screen.getByRole("textbox", { name: "На что нужны средства" }),
      "Остаться на форме",
    );
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.click(screen.getByRole("button", { name: "Все заявки" }));
    expect(
      screen.getByRole("textbox", { name: "На что нужны средства" }),
    ).toHaveValue("Остаться на форме");
  });

  it("shows validation errors before sending an invalid draft", async () => {
    const { user, server } = await openExisting();
    await user.type(
      screen.getByRole("textbox", { name: "Сумма финансирования" }),
      "-12",
    );
    await user.click(
      screen.getByRole("button", { name: "Сохранить черновик" }),
    );
    expect(
      await screen.findByText(/Укажите положительную сумму/),
    ).toBeInTheDocument();
    expect(
      server.fetcher.mock.calls.some(
        ([, options]) => options?.method === "PATCH",
      ),
    ).toBe(false);
  });
});
