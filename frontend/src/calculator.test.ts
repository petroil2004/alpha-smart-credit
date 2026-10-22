import { describe, expect, it } from "vitest";
import { calculationKey, isCurrentAnnuityResult, isProductCatalog, prepareCalculation, sliderAmountValue } from "./calculator";
import { fromApplication } from "./draft";
import { application } from "./test/api-fixtures";
import { annuityResult, catalog } from "./test/calculator-fixtures";

const fields = fromApplication(application({product_code: "working_capital", amount_rub: "3000000.00", term_months: 36}));

describe("calculation input boundary", () => {
  it("treats malformed successful catalog responses as unavailable", () => {
    expect(isProductCatalog(catalog)).toBe(true);
    for (const value of [null, {}, {...catalog,items:[]}, {...catalog,items:[catalog.items[0],catalog.items[0],catalog.items[2]]}, {...catalog,items:catalog.items.map(p=>({...p,amount_step_rub:"0.00"}))}]) {
      expect(isProductCatalog(value)).toBe(false);
    }
  });
  it("normalizes exact input without requiring purpose or other fields", () => {
    expect(prepareCalculation({...fields, amount_rub: "3 000 000,01"}, catalog)).toEqual({request: {product_code: "working_capital", amount_rub: "3000000.01", term_months: 36}, errors: {}});
  });
  it.each(["", "1234.50", "9007199254740993.01", "-1", "NaN"])("does not calculate unsuitable amount %s", amount => {
    expect(prepareCalculation({...fields, amount_rub: amount}, catalog).request).toBeNull();
    expect(sliderAmountValue(amount, catalog.items[0])).toBeGreaterThanOrEqual(300000);
    expect(sliderAmountValue(amount, catalog.items[0])).toBeLessThanOrEqual(6000000);
  });
  it.each(["", "11", "37", "1.5", "Infinity"])("does not calculate unsuitable duration %s", term => {
    expect(prepareCalculation({...fields, term_months: term}, catalog).request).toBeNull();
  });
  it("ties responses to exact inputs and catalog and rejects incomplete results", () => {
    const request = prepareCalculation(fields, catalog).request!;
    expect(isCurrentAnnuityResult(request, catalog, annuityResult())).toBe(true);
    for (const override of [{amount_rub:"3000000.01"}, {term_months:24}, {annual_rate_percent:"1.00"}, {monthly_payment_rub:undefined}, {monthly_payment_rub:"NaN"}, {catalog_version:"old"}]) {
      expect(isCurrentAnnuityResult(request, catalog, annuityResult(override))).toBe(false);
    }
    expect(calculationKey("a", request, "v")).not.toBe(calculationKey("b", request, "v"));
  });
});
