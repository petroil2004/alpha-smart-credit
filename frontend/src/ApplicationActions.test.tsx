import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import ApplicationsList from "./components/ApplicationsList";
import { createApi } from "./api";
import { application, contractServer } from "./test/api-fixtures";
import type { Application } from "./types";

beforeEach(() => window.history.replaceState(null, "", "/"));
async function setup() {
  const item = application({purpose: "Купить витрину"});
  const server = contractServer({loggedIn:true, applications:[item]});
  const user = userEvent.setup();
  render(<App api={createApi(server.fetcher)} />);
  await screen.findByRole("heading", {name:"Мои заявки"});
  return {item, server, user};
}

it("opens the application by its visible card text", async () => {
  const h = await setup();
  await h.user.click(screen.getByText("Купить витрину"));
  expect(await screen.findByRole("heading", {name:"Для чего нужны деньги?"})).toBeInTheDocument();
});

it("opens the whole-card control with a keyboard", async () => {
  const h = await setup();
  screen.getByRole("button", {name:/Открыть заявку/}).focus();
  await h.user.keyboard("{Enter}");
  expect(await screen.findByRole("heading", {name:"Для чего нужны деньги?"})).toBeInTheDocument();
});

it("cancels deletion without opening or removing the card", async () => {
  const h = await setup();
  await h.user.click(screen.getByRole("button", {name:/Удалить черновик/}));
  await h.user.click(within(screen.getByRole("dialog")).getByRole("button", {name:"Отмена"}));
  expect(screen.getByText("Купить витрину")).toBeInTheDocument();
  expect(screen.queryByRole("heading", {name:"Для чего нужны деньги?"})).not.toBeInTheDocument();
  expect(h.server.store.has(h.item.id)).toBe(true);
});

it("removes a confirmed draft only after the server replies and updates the list", async () => {
  const h = await setup();
  let release!:()=>void;
  h.server.holdDeletes(new Promise<void>(resolve => {release=resolve;}));
  await h.user.click(screen.getByRole("button", {name:/Удалить черновик/}));
  const confirm = within(screen.getByRole("dialog")).getByRole("button", {name:"Удалить"});
  await h.user.click(confirm);
  expect(h.server.store.has(h.item.id)).toBe(true);
  expect(confirm).toBeDisabled();
  await h.user.click(confirm);
  await act(async()=>release());
  expect(await screen.findByText("Пока ни одной заявки")).toBeInTheDocument();
  expect(h.server.store.has(h.item.id)).toBe(false);
  expect(screen.queryByRole("heading", {name:"Для чего нужны деньги?"})).not.toBeInTheDocument();
});

it("keeps the card after a deletion error and allows retry", async () => {
  const h = await setup();
  h.server.failNextDelete(503);
  await h.user.click(screen.getByRole("button", {name:/Удалить черновик/}));
  await h.user.click(within(screen.getByRole("dialog")).getByRole("button", {name:"Удалить"}));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(h.server.store.has(h.item.id)).toBe(true);
  await h.user.click(within(screen.getByRole("dialog")).getByRole("button", {name:"Удалить"}));
  expect(await screen.findByText("Пока ни одной заявки")).toBeInTheDocument();
});

it("does not send deletion after a different company signs in", async () => {
  const h = await setup();
  await createApi(h.server.fetcher).login("demo-client-2");
  await h.user.click(screen.getByRole("button", {name:/Удалить черновик/}));
  await h.user.click(within(screen.getByRole("dialog")).getByRole("button", {name:"Удалить"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Профиль изменился");
  expect(h.server.store.has(h.item.id)).toBe(true);
  expect(screen.queryByText("Купить витрину")).not.toBeInTheDocument();
});

it("shows deletion only for drafts, not future submitted applications", () => {
  const sent = {...application(), status:"SUBMITTED"} as unknown as Application;
  render(<ApplicationsList items={[sent]} busy={false} onOpen={()=>{}} onCreate={()=>{}} onDelete={()=>{}} />);
  expect(screen.queryByRole("button", {name:/Удалить черновик/})).not.toBeInTheDocument();
});

it("refreshes a stale version before allowing a new deletion attempt", async () => {
  const h = await setup();
  h.server.store.set(h.item.id, {...h.item, version:2, purpose:"Изменено в другом окне"});
  await h.user.click(screen.getByRole("button", {name:/Удалить черновик/}));
  await h.user.click(within(screen.getByRole("dialog")).getByRole("button", {name:"Удалить"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Обновите список");
  expect(h.server.store.has(h.item.id)).toBe(true);
  await h.user.click(within(screen.getByRole("dialog")).getByRole("button", {name:"Отмена"}));
  await h.user.click(screen.getByRole("button", {name:"Обновить список"}));
  await screen.findByText("Изменено в другом окне");
  await h.user.click(screen.getByRole("button", {name:/Удалить черновик/}));
  await h.user.click(within(screen.getByRole("dialog")).getByRole("button", {name:"Удалить"}));
  await waitFor(()=>expect(screen.getByText("Пока ни одной заявки")).toBeInTheDocument());
});

it("exposes the visible purpose and amount as the card's accessible description", async () => {
  await setup();
  expect(screen.getByRole("button", {name:/Открыть заявку/})).toHaveAccessibleDescription(/Купить витрину.*Сумма не указана/);
});


it("opens an in-page confirmation repeatedly without browser prompts and restores focus", async () => {
  const h = await setup();
  const browserConfirm = vi.spyOn(window,"confirm").mockReturnValue(false);
  const trigger = screen.getByRole("button", {name:/Удалить черновик/});
  for(let attempt=0; attempt<3; attempt++) {
    await h.user.click(trigger);
    const dialog = screen.getByRole("dialog", {name:"Удалить черновик?"});
    expect(dialog).toHaveTextContent("000001");
    const cancel = within(dialog).getByRole("button", {name:"Отмена"});
    expect(cancel).toHaveFocus();
    await h.user.click(cancel);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  }
  expect(browserConfirm).not.toHaveBeenCalled();
  expect(h.server.store.has(h.item.id)).toBe(true);
});

it("cancels via the dialog cancel event but ignores it during deletion", async () => {
  const h = await setup();
  await h.user.click(screen.getByRole("button", {name:/Удалить черновик/}));
  fireEvent(screen.getByRole("dialog"),new Event("cancel",{cancelable:true}));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  let release!:()=>void;
  h.server.holdDeletes(new Promise<void>(resolve=>{release=resolve;}));
  await h.user.click(screen.getByRole("button", {name:/Удалить черновик/}));
  await h.user.click(within(screen.getByRole("dialog")).getByRole("button", {name:"Удалить"}));
  fireEvent(screen.getByRole("dialog"),new Event("cancel",{cancelable:true}));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await act(async()=>release());
  await screen.findByText("Пока ни одной заявки");
});
