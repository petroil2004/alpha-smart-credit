import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createApi } from "./api";
import { application, contractServer } from "./test/api-fixtures";
import { annuityResult } from "./test/calculator-fixtures";

async function open(amount: string | null="3000000.00", custom?: ReturnType<typeof createApi>) {
  const server=contractServer({loggedIn:true,applications:[application({product_code:"working_capital",amount_rub:amount,term_months:36})]});
  const api=custom??createApi(server.fetcher);
  const user=userEvent.setup();render(<App api={api}/>);
  await screen.findByRole("heading",{name:"Расскажите о потребности"});
  await user.click(screen.getByRole("button",{name:"Перейти к шагу «Параметры»"}));
  return {user,server};
}
describe("loan calculator in draft wizard",()=>{
  beforeEach(()=>{window.history.replaceState(null,"","/#draft/00000000-0000-4000-8000-000000000001");});
  it("shares slider and manual input between steps without losing kopecks",async()=>{
    const {user}=await open();
    const amountSlider=await screen.findByRole("slider",{name:"Сумма финансирования, ползунок"});
    const termSlider=screen.getByRole("slider",{name:"Срок, месяцев, ползунок"});
    expect(await screen.findByText("119 279,48 ₽")).toBeInTheDocument();
    fireEvent.change(amountSlider,{target:{value:"2000000"}});fireEvent.change(termSlider,{target:{value:"24"}});
    expect(screen.getByLabelText("Сумма финансирования")).toHaveValue("2000000.00");
    expect(screen.getByLabelText("Срок, месяцев")).toHaveValue("24");
    fireEvent.change(screen.getByLabelText("Сумма финансирования"),{target:{value:"2 000 000,01"}});
    await user.click(screen.getByRole("button",{name:"Перейти к шагу «Потребность»"}));
    expect(screen.getByLabelText("Сумма финансирования")).toHaveValue("2 000 000,01");
  });
  it("shows the same result in review and only explicitly saves",async()=>{
    const {user,server}=await open();await screen.findByText("119 279,48 ₽");
    expect(server.fetcher.mock.calls.some(([,o])=>o?.method==="PATCH")).toBe(false);
    await user.click(screen.getByRole("button",{name:"Перейти к шагу «Проверка»"}));
    expect(within(screen.getByRole("region",{name:"Предварительный расчёт платежа"})).getByText("119 279,48 ₽")).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Сохранить черновик"}));
    await screen.findByText("Черновик сохранён");
    expect(server.store.values().next().value?.amount_rub).toBe("3000000.00");
  });
  it.each([null,"1234.50","9007199254740993.01"])("preserves blank/legacy values %s and allows save",async amount=>{
    const {user,server}=await open(amount);await screen.findByRole("slider",{name:"Сумма финансирования, ползунок"});
    expect(screen.getByLabelText("Сумма финансирования")).toHaveValue(amount??"");
    expect(server.fetcher.mock.calls.some(([url])=>String(url).includes("calculations"))).toBe(false);
    await user.click(screen.getByRole("button",{name:"Сохранить черновик"}));await screen.findByText("Черновик сохранён");
    expect(server.store.values().next().value?.amount_rub).toBe(amount);
  });
  it("keeps manual editing and save when the catalog is unavailable",async()=>{
    const server=contractServer({loggedIn:true,applications:[application({product_code:"working_capital",amount_rub:"3000000.00",term_months:36})]});
    const api=createApi(vi.fn<typeof fetch>(async(input,init)=>String(input).endsWith("/products")?new Response("offline",{status:503}):server.fetcher(input,init)));
    const {user}=await open("3000000.00",api);
    expect(await screen.findByRole("button",{name:"Повторить загрузку условий"})).toBeInTheDocument();
    expect(screen.getByLabelText("Сумма финансирования")).toHaveValue("3000000.00");
    await user.click(screen.getByRole("button",{name:"Сохранить черновик"}));await screen.findByText("Черновик сохранён");
  });
  it("lets save during a pending calculation and disables sliders while saving",async()=>{
    const server=contractServer({loggedIn:true,applications:[application({product_code:"working_capital",amount_rub:"3000000.00",term_months:36})]});
    let finish!:()=>void;server.holdSaves(new Promise<void>(resolve=>{finish=resolve;}));
    const api={...createApi(server.fetcher),calculateAnnuity:vi.fn(()=>new Promise<ReturnType<typeof annuityResult>>(()=>{}))};
    const {user}=await open("3000000.00",api);
    const slider=await screen.findByRole("slider",{name:"Сумма финансирования, ползунок"});
    await waitFor(()=>expect(api.calculateAnnuity).toHaveBeenCalled());
    fireEvent.change(slider,{target:{value:"2000000"}});
    await user.click(screen.getByRole("button",{name:"Сохранить черновик"}));
    expect(slider).toBeDisabled();await act(async()=>finish());
    await screen.findByText("Черновик сохранён");expect(slider).not.toBeDisabled();
  });
});
