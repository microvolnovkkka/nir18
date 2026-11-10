import assert from "node:assert/strict";
import { createServer } from "vite";
const server = await createServer({
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: "custom",
});
const originalFetch = globalThis.fetch;
try {
  const { dateError, dateRangeError, catalogFilters } =
    await server.ssrLoadModule("/src/DateFilters.tsx");
  for (const partial of [
    "0001-11-01",
    "0020-11-01",
    "0202-11-01",
    "2026-11",
    "2026-02-30",
    "2025-02-29",
    "2026-09-30",
    "5812-03-12",
    "2026-11-11",
  ]) {
    assert(dateError(partial, "2026-11-10"), `Недопустимая дата: ${partial}`);
  }
  for (const valid of ["", "2026-10-01", "2026-11-10"])
    assert.equal(dateError(valid, "2026-11-10"), "");
  assert.equal(dateError("2028-02-29", "2028-03-01"), "");
  assert.deepEqual(
    catalogFilters(new URLSearchParams("q=abc&date_from=5812-03-12&page=8")),
    { q: "abc" },
  );
  assert(dateRangeError({ date_from: "2026-11-08", date_to: "2026-11-01" }));
  for (const range of [
    { date_from: "2026-11-01", date_to: "2026-11-01" },
    { date_from: "", date_to: "2026-11-01" },
    { date_from: "2026-11-01", date_to: "" },
  ])
    assert.equal(dateRangeError(range), "");
  const { api, APIError } = await server.ssrLoadModule("/src/api.ts");
  for (const [status, code] of [
    [400, "bad_request"],
    [422, "validation_failed"],
    [429, "rate_limited"],
    [503, "unavailable"],
    [400, "future_error_code"],
  ]) {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: { code, message: `Запрос не выполнен: ${code}` },
        }),
        { status },
      );
    await assert.rejects(
      api("/api/publications"),
      (error) =>
        error instanceof APIError &&
        error.status === status &&
        !error.message.includes(code) &&
        !error.message.includes(String(status)),
    );
  }
  console.log(
    "Фильтры: неполный год, календарные даты, диапазон и понятные ошибки API — OK",
  );
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}
