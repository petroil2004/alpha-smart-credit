import { describe, expect, it } from "vitest";
import {
  emptyDraft,
  toDraftPayload,
  normalizeMoney,
  DraftValidationError,
} from "./draft";

describe("money input", () => {
  it("preserves kopecks while accepting spaces and a comma", () => {
    expect(normalizeMoney("1 500,25")).toBe("1500.25");
    expect(normalizeMoney("9007199254740993,01")).toBe("9007199254740993.01");
    expect(normalizeMoney("00012.5")).toBe("12.50");
  });
  it("keeps unknown distinct from a positive amount", () => {
    expect(normalizeMoney("")).toBeNull();
    for (const value of [
      "0",
      "-1",
      "1.234",
      "1,2,3",
      "1e3",
      "Infinity",
      "12abc",
    ]) {
      expect(() => normalizeMoney(value)).toThrow();
    }
  });
});

describe("draft payload", () => {
  it("permits an incomplete draft and trims purpose", () => {
    expect(
      toDraftPayload({ ...emptyDraft(), purpose: "  Закупка материалов  " }),
    ).toEqual({
      purpose: "Закупка материалов",
      product_code: null,
      amount_rub: null,
      term_months: null,
      usage_days: null,
      expected_inflow_date: null,
      expected_inflow_amount_rub: null,
    });
  });
  it("clears overdraft-only values for an ordinary credit", () => {
    expect(
      toDraftPayload({
        ...emptyDraft(),
        product_code: "equipment",
        term_months: "24",
        usage_days: "14",
        expected_inflow_date: "2026-11-01",
        expected_inflow_amount_rub: "500000",
      }),
    ).toMatchObject({
      term_months: 24,
      usage_days: null,
      expected_inflow_date: null,
      expected_inflow_amount_rub: null,
    });
  });
  it("clears ordinary term for overdraft without rejecting a past draft date", () => {
    expect(
      toDraftPayload({
        ...emptyDraft(),
        product_code: "overdraft",
        term_months: "24",
        usage_days: "14",
        expected_inflow_date: "2020-02-29",
        expected_inflow_amount_rub: "12,10",
      }),
    ).toMatchObject({
      term_months: null,
      usage_days: 14,
      expected_inflow_date: "2020-02-29",
      expected_inflow_amount_rub: "12.10",
    });
  });
  it("rejects fractional periods, impossible dates and invalid money with field errors", () => {
    try {
      toDraftPayload({
        ...emptyDraft(),
        product_code: "overdraft",
        usage_days: "1.5",
        expected_inflow_date: "2026-02-30",
        amount_rub: "-10",
      });
      throw new Error("expected validation error");
    } catch (error) {
      expect(error).toBeInstanceOf(DraftValidationError);
      expect((error as DraftValidationError).fields).toEqual({
        amount_rub: expect.any(String),
        usage_days: expect.any(String),
        expected_inflow_date: expect.any(String),
      });
    }
  });
  it("rejects purpose beyond 500 characters and zero months", () => {
    expect(() =>
      toDraftPayload({
        ...emptyDraft(),
        product_code: "working_capital",
        purpose: "а".repeat(501),
        term_months: "0",
      }),
    ).toThrow(DraftValidationError);
  });
});
