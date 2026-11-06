import test from "node:test";
import assert from "node:assert/strict";
import {
  ApiError,
  requestResponse,
  responseJson,
} from "../src/api-response.ts";

test("failed read produces a bounded message without exposing transport details", async () => {
  const load = (async () => {
    throw new TypeError("Failed to fetch private upstream");
  }) as typeof fetch;
  await assert.rejects(
    requestResponse("/api/example", {}, true, load),
    (error) =>
      error instanceof ApiError &&
      error.status === 0 &&
      error.code === "network_error" &&
      error.message === "网络连接失败，请稍后重试",
  );
});
test("write connection loss stays uncertain and is submitted only once", async () => {
  let count = 0;
  const load = (async () => {
    count++;
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  await assert.rejects(
    requestResponse("/api/example", { method: "POST" }, false, load),
    (error) => error instanceof ApiError && /核对原操作/.test(error.message),
  );
  assert.equal(count, 1);
});
test("intentional cancellation is not converted to a connection alert", async () => {
  const controller = new AbortController();
  controller.abort();
  const aborted = new DOMException("cancelled", "AbortError");
  const load = (async () => {
    throw aborted;
  }) as typeof fetch;
  await assert.rejects(
    requestResponse("/api/example", { signal: controller.signal }, true, load),
    (error) => error === aborted,
  );
});
test("HTML or malformed success responses never appear as raw page errors", async () => {
  for (const read of [true, false]) {
    const response = new Response("<html>private proxy response</html>", {
      status: 200,
    });
    await assert.rejects(
      responseJson(response, read),
      (error) =>
        error instanceof ApiError &&
        error.status === 200 &&
        error.code === "invalid_response" &&
        !error.message.includes("private proxy") &&
        (read || error.message.includes("核对原操作")),
    );
  }
});
test("valid payloads retain null and exact string amounts", async () => {
  assert.deepEqual(
    await responseJson(
      Response.json({ amount: "12345678901234567890.123", quote: null }),
      true,
    ),
    { amount: "12345678901234567890.123", quote: null },
  );
});

test("direct transports infer read and write failures from the request method", async () => {
  const prior = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
  try {
    await assert.rejects(
      requestResponse("/api/original"),
      (error) => error instanceof ApiError && /稍后重试/.test(error.message),
    );
    await assert.rejects(
      requestResponse("/api/original", { method: "post" }),
      (error) => error instanceof ApiError && /核对原操作/.test(error.message),
    );
  } finally {
    globalThis.fetch = prior;
  }
});
