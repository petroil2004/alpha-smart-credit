import { act, render, screen, waitFor } from "@testing-library/react";
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
  vi.spyOn(window,"confirm").mockReturnValueOnce(false);
  await h.user.click(screen.getByRole("button", {name:/Удалить черновик/}));
  expect(screen.getByText("Купить витрину")).toBeInTheDocument();
  expect(screen.queryByRole("heading", {name:"Для чего нужны деньги?"})).not.toBeInTheDocument();
  expect(h.server.store.has(h.item.id)).toBe(true);
});

it("removes a confirmed draft only after the server replies and updates the list", async () => {
  const h = await setup();
  let release!:()=>void;
  h.server.holdDeletes(new Promise<void>(resolve => {release=resolve;}));
  vi.spyOn(window,"confirm").mockReturnValueOnce(true);
  await h.user.click(screen.getByRole("button", {name:/Удалить черновик/}));
  expect(screen.getByText("Купить витрину")).toBeInTheDocument();
  expect(screen.getByRole("button", {name:/Удалить черновик/})).toBeDisabled();
  await act(async()=>release());
  expect(await screen.findByText("Пока ни одной заявки")).toBeInTheDocument();
  expect(h.server.store.has(h.item.id)).toBe(false);
  expect(screen.queryByRole("heading", {name:"Для чего нужны деньги?"})).not.toBeInTheDocument();
});

it("keeps the card after a deletion error and allows retry", async () => {
  const h = await setup();
  h.server.failNextDelete(503);
  vi.spyOn(window,"confirm").mockReturnValue(true);
  await h.user.click(screen.getByRole("button", {name:/Удалить черновик/}));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByText("Купить витрину")).toBeInTheDocument();
  await h.user.click(screen.getByRole("button", {name:/Удалить черновик/}));
  expect(await screen.findByText("Пока ни одной заявки")).toBeInTheDocument();
});

it("does not send deletion after a different company signs in", async () => {
  const h = await setup();
  await createApi(h.server.fetcher).login("demo-client-2");
  vi.spyOn(window,"confirm").mockReturnValueOnce(true);
  await h.user.click(screen.getByRole("button", {name:/Удалить черновик/}));
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
  vi.spyOn(window,"confirm").mockReturnValue(true);
  await h.user.click(screen.getByRole("button", {name:/Удалить черновик/}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Обновите список");
  expect(h.server.store.has(h.item.id)).toBe(true);
  await h.user.click(screen.getByRole("button", {name:"Обновить список"}));
  await screen.findByText("Изменено в другом окне");
  await h.user.click(screen.getByRole("button", {name:/Удалить черновик/}));
  await waitFor(()=>expect(screen.getByText("Пока ни одной заявки")).toBeInTheDocument());
});

it("exposes the visible purpose and amount as the card's accessible description", async () => {
  await setup();
  expect(screen.getByRole("button", {name:/Открыть заявку/})).toHaveAccessibleDescription(/Купить витрину.*Сумма не указана/);
});
