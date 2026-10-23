import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useLoanCalculator } from "./hooks/useLoanCalculator";
import { fromApplication } from "./draft";
import { application, contractServer } from "./test/api-fixtures";
import { annuityResult, catalog } from "./test/calculator-fixtures";
import { createApi, ApiError } from "./api";
import App from "./App";
import type { AnnuityRequest } from "./types";

const example=application({product_code:"working_capital",amount_rub:"3000000.00",term_months:36});
const fields=fromApplication(example);
afterEach(()=>{cleanup();vi.useRealTimers();});

it("does not resurrect A after A -> B -> A while the fresh request is pending",async()=>{
  vi.useFakeTimers();
  const api={...createApi(contractServer({loggedIn:true}).fetcher),products:vi.fn().mockResolvedValue(catalog),calculateAnnuity:vi.fn().mockResolvedValueOnce(annuityResult()).mockImplementation(()=>new Promise(()=>{}))};
  const h=renderHook(({value})=>useLoanCalculator(api,value,"a"),{initialProps:{value:fields}});
  await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  await act(async()=>{await vi.advanceTimersByTimeAsync(300);});
  expect(h.result.current.status).toBe("ready");
  h.rerender({value:{...fields,amount_rub:"2000000.00"}});
  expect(h.result.current.result).toBeNull();
  h.rerender({value:fields});
  expect(h.result.current.result).toBeNull();
  await act(async()=>{await vi.advanceTimersByTimeAsync(300);});
  expect(h.result.current.status).toBe("loading");
});

it("reauthenticates straight from calculator 401 while preserving unsaved kopecks",async()=>{
  window.history.replaceState(null,"","/#draft/"+example.id);
  const transport=createApi(contractServer({loggedIn:true,applications:[example]}).fetcher);
  const api={...transport,login:vi.fn(transport.login),calculateAnnuity:vi.fn().mockRejectedValueOnce(new ApiError(401,"UNAUTHENTICATED","Сессия истекла. Войдите снова")).mockImplementation(async (input:AnnuityRequest)=>annuityResult(input))};
  render(<App api={api}/>);
  await screen.findByRole("heading",{name:"Для чего нужны деньги?"});
  fireEvent.click(screen.getByRole("button",{name:"Перейти к шагу «Параметры»"}));
  fireEvent.change(screen.getByLabelText("Сумма финансирования",{exact:true}),{target:{value:"3000000,01"}});
  await screen.findByText("Сессия истекла. Войдите снова");
  fireEvent.click(screen.getByRole("button",{name:"Войти снова"}));
  await waitFor(()=>expect(api.login).toHaveBeenCalledWith("demo-client-1"));
  await screen.findByText("119 279,48 ₽");
  expect(screen.getByLabelText("Сумма финансирования",{exact:true})).toHaveValue("3000000,01");
});

it("can reload catalog after server field validation without silently clamping the value",async()=>{
  window.history.replaceState(null,"","/#draft/"+example.id);
  const updated={...catalog,items:catalog.items.map(p=>p.code==="working_capital"?{...p,term_max_months:24}:p)};
  const api={...createApi(contractServer({loggedIn:true,applications:[example]}).fetcher),products:vi.fn().mockResolvedValueOnce(catalog).mockResolvedValue(updated),calculateAnnuity:vi.fn().mockRejectedValue(new ApiError(422,"VALIDATION_ERROR","Проверьте заполнение полей",{term_months:"Для расчёта укажите срок от 12 до 24 месяцев"}))};
  render(<App api={api}/>);
  await screen.findByRole("heading",{name:"Для чего нужны деньги?"});
  fireEvent.click(screen.getByRole("button",{name:"Перейти к шагу «Параметры»"}));
  await screen.findByText("Для расчёта укажите срок от 12 до 24 месяцев");
  fireEvent.click(screen.getByRole("button",{name:"Повторить загрузку условий"}));
  await waitFor(()=>expect(screen.getByRole("slider",{name:"Срок, месяцев, ползунок"})).toHaveAttribute("max","24"));
  expect(screen.getByLabelText("Срок, месяцев",{exact:true})).toHaveValue("36");
});
