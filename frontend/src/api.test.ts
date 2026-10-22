import { describe, expect, it, vi } from "vitest";
import { ApiError, createApi } from "./api";
import { application } from "./test/api-fixtures";

describe("HTTP boundary", () => {
  it("loads products and calculates without an application mutation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response("{}"));
    const api = createApi(fetcher);
    await api.products();
    const input = { product_code: "working_capital" as const, amount_rub: "3000000.01", term_months: 36 };
    await api.calculateAnnuity(input);
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/products");
    expect(fetcher.mock.calls[1][0]).toBe("/api/v1/calculations/annuity");
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: "POST", credentials: "same-origin", body: JSON.stringify(input) });
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });
  it("creates an empty draft with a stable idempotency key and cookies", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify(application()), { status: 201 }),
      );
    await createApi(fetcher).create("request-1");
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("/api/v1/applications");
    expect(options).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      body: "{}",
    });
    expect(new Headers(options?.headers).get("Idempotency-Key")).toBe(
      "request-1",
    );
  });
  it("sends the known version when updating and preserves conflict details", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "VERSION_CONFLICT",
            message: "Заявка уже изменена",
          },
        }),
        { status: 409 },
      ),
    );
    await expect(
      createApi(fetcher).update("draft-1", { version: 3, purpose: "Товар" }),
    ).rejects.toMatchObject({
      status: 409,
      code: "VERSION_CONFLICT",
      message: "Заявка уже изменена",
    });
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/applications/draft-1");
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      version: 3,
      purpose: "Товар",
    });
  });
  it("retains server field errors instead of reporting success", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: "Проверьте поля",
            fields: { amount_rub: "Некорректная сумма" },
          },
        }),
        { status: 422 },
      ),
    );
    await expect(
      createApi(fetcher).update("draft-1", { version: 1 }),
    ).rejects.toMatchObject({
      status: 422,
      fields: { amount_rub: "Некорректная сумма" },
    });
  });
  it("makes malformed errors and network failures understandable", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("<html>bad gateway</html>", { status: 502 }),
      )
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const api = createApi(fetcher);
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    await expect(api.me()).rejects.toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
    });
  });
  it("supports logout without attempting to parse an empty response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    await expect(createApi(fetcher).logout()).resolves.toBeUndefined();
  });
});
