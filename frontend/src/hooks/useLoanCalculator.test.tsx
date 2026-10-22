import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApi, ApiError } from "../api";
import { fromApplication } from "../draft";
import { application, contractServer } from "../test/api-fixtures";
import { annuityResult, catalog } from "../test/calculator-fixtures";
import type { AnnuityResult, DraftFields } from "../types";
import { useLoanCalculator } from "./useLoanCalculator";

const fields = fromApplication(application({product_code:"working_capital",amount_rub:"3000000.00",term_months:36}));
const tick = (ms=0) => act(async()=>{await vi.advanceTimersByTimeAsync(ms);});
function setup(calculate = vi.fn().mockResolvedValue(annuityResult())) {
  const api = {...createApi(contractServer({loggedIn:true}).fetcher),products:vi.fn().mockResolvedValue(catalog),calculateAnnuity:calculate};
  const hook = renderHook(({value,id}:{value:DraftFields,id:string})=>useLoanCalculator(api,value,id),{initialProps:{value:fields,id:"a"}});
  return {...hook,api};
}
describe("calculation request lifecycle",()=>{
  beforeEach(()=>vi.useFakeTimers());
  afterEach(()=>{cleanup();vi.useRealTimers();});
  it("debounces for 300ms and immediately hides stale result",async()=>{
    const h=setup(); await tick(); await tick(299);
    expect(h.api.calculateAnnuity).not.toHaveBeenCalled();
    await tick(1); expect(h.result.current.result?.monthly_payment_rub).toBe("119279.48");
    h.rerender({value:{...fields,amount_rub:"2000000.00"},id:"a"});
    expect(h.result.current.result).toBeNull();
  });
  it.each([false,true])("ignores late success/error from an older request (%s)",async failOld=>{
    const pending: {resolve:(r:AnnuityResult)=>void,reject:(e:Error)=>void}[]=[];
    const calc=vi.fn(()=>new Promise<AnnuityResult>((resolve,reject)=>pending.push({resolve,reject})));
    const h=setup(calc); await tick(); await tick(300);
    h.rerender({value:{...fields,amount_rub:"2000000.00"},id:"a"});await tick(300);
    await act(async()=>pending[1].resolve(annuityResult({amount_rub:"2000000.00",monthly_payment_rub:"79519.65"})));
    await act(async()=>{if(failOld)pending[0].reject(new Error("old"));else pending[0].resolve(annuityResult());});
    expect(h.result.current.result?.monthly_payment_rub).toBe("79519.65");
    expect(h.result.current.status).toBe("ready");
  });
  it("invalidates on changing product or application",async()=>{
    const h=setup();await tick();await tick(300);
    h.rerender({value:fields,id:"b"});expect(h.result.current.result).toBeNull();
    h.rerender({value:{...fields,product_code:"overdraft"},id:"b"});
    expect(h.result.current.status).toBe("unsupported");expect(h.result.current.result).toBeNull();
  });
  it("retries catalog failures without changing inputs",async()=>{
    const h=setup();h.api.products.mockRejectedValueOnce(new Error("offline"));
    act(()=>h.result.current.retryCatalog());await tick();
    expect(h.result.current.catalogStatus).toBe("error");
    act(()=>h.result.current.retryCatalog());await tick();await tick(300);
    expect(h.result.current.result?.amount_rub).toBe(fields.amount_rub);
  });
  it.each([new ApiError(503,"SERVER_ERROR","Недоступен"),new ApiError(401,"UNAUTHENTICATED","Войдите снова")])("retains input and can retry after failure",async error=>{
    const h=setup(vi.fn().mockRejectedValueOnce(error).mockResolvedValue(annuityResult()));
    await tick();await tick(300);expect(h.result.current.status).toBe("error");expect(h.result.current.result).toBeNull();
    act(()=>h.result.current.retryCalculation());await tick(300);expect(h.result.current.status).toBe("ready");
  });
  it.each([{catalog_version:"old"},{amount_rub:"1.00"},{monthly_payment_rub:undefined}])("rejects inconsistent successful response %s",async override=>{
    const h=setup(vi.fn().mockResolvedValue(annuityResult(override)));await tick();await tick(300);
    expect(h.result.current.result).toBeNull();expect(h.result.current.status).toBe("error");
  });
});
