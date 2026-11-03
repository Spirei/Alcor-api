import test from "node:test";
import assert from "node:assert/strict";
import {
  rateLabel,
  dayLabel,
  mayPoll,
  restoreRequest,
  clearReferenceRequests,
  receiptKey,
} from "../src/reference-state.ts";
function storage() {
  const data = {};
  return new Proxy(data, {
    get: (obj, key) =>
      key === "getItem"
        ? (k) => obj[k] ?? null
        : key === "setItem"
          ? (k, v) => {
              obj[k] = v;
            }
          : key === "removeItem"
            ? (k) => {
                delete obj[k];
              }
            : obj[key],
  });
}
test("missing FX never becomes one or zero", () => {
  assert.equal(
    rateLabel({ USD: "1", JPY: "0.000000000000000001" }, "HKD"),
    "—",
  );
  assert.equal(
    rateLabel({ JPY: "0.000000000000000001" }, "JPY"),
    "0.000000000000000001",
  );
});
test("unknown schedule remains unknown even on weekends", () => {
  assert.equal(dayLabel("unknown"), "未确认");
  assert.equal(dayLabel("new-unrecognized-state"), "未确认");
  assert.equal(dayLabel("weekend"), "周末休市");
});
test("hidden/inactive pages and terminal receipts do not poll", () => {
  assert.equal(mayPoll(true, true, "id", null), true);
  assert.equal(mayPoll(false, true, "id", null), false);
  assert.equal(mayPoll(true, false, "id", { state: "running" }), false);
  for (const state of ["completed", "failed", "interrupted"])
    assert.equal(mayPoll(true, true, "id", { state }), false);
});
test("restore only original UUID and clear on identity boundary", () => {
  const s = storage();
  const id = "00000000-0000-4000-8000-000000000001";
  s.setItem(receiptKey("first"), id);
  assert.equal(restoreRequest(s, "first"), id);
  assert.equal(restoreRequest(s, "second"), null);
  assert.equal(s.getItem(receiptKey("first")), null);
  s.setItem(receiptKey("second"), "invalid");
  assert.throws(() => restoreRequest(s, "second"));
  clearReferenceRequests(s);
  assert.equal(s.getItem(receiptKey("second")), null);
});

test("only a definite rejection releases the matching request locator", async () => {
  const { releaseRejectedRequest } = await import("../src/reference-state.ts");
  const s = storage(),
    scope = "owner/session",
    id = "00000000-0000-4000-8000-000000000001";
  s.setItem(receiptKey(scope), id);
  for (const status of [undefined, 0, 408, 409, 499, 500, 503, 504])
    assert.equal(releaseRejectedRequest(s, scope, id, status), false);
  assert.equal(releaseRejectedRequest(s, scope, "different", 429), false);
  assert.equal(s.getItem(receiptKey(scope)), id);
  assert.equal(releaseRejectedRequest(s, scope, id, 429), true);
  assert.equal(s.getItem(receiptKey(scope)), null);
});
test("unrecognized receipt state never becomes a final completion", async () => {
  const { validReceipt, terminal } = await import("../src/reference-state.ts");
  assert.equal(terminal("unexpected"), false);
  assert.equal(
    validReceipt({
      id: "00000000-0000-4000-8000-000000000001",
      state: "unexpected",
      error_code: null,
    }),
    false,
  );
  assert.equal(
    validReceipt({
      id: "00000000-0000-4000-8000-000000000001",
      state: "completed",
      error_code: null,
    }),
    true,
  );
});

test("delayed original receipt cannot complete or discard a replacement request", async () => {
  const { readOriginalReceipt } = await import("../src/reference-state.ts");
  let current = "A";
  let resolve;
  const transport = new Promise((done) => {
    resolve = done;
  });
  const commits = [],
    failures = [];
  const inFlight = readOriginalReceipt(
    () => transport,
    () => current === "A",
    (value) => commits.push(value),
    (error) => failures.push(error),
  );
  // Finish A and start B while a manual recheck of A is still in flight.
  current = "B";
  resolve({
    id: "00000000-0000-4000-8000-000000000001",
    state: "completed",
    error_code: null,
  });
  await inFlight;
  assert.deepEqual(commits, []);
  assert.deepEqual(failures, []);
  assert.equal(current, "B");
  await readOriginalReceipt(
    async () => ({
      id: "00000000-0000-4000-8000-000000000002",
      state: "running",
      error_code: null,
    }),
    () => current === "B",
    (value) => commits.push(value),
    (error) => failures.push(error),
  );
  assert.equal(commits[0].state, "running");
});

test("late old-request failure or invalid payload cannot clear a new identity", async () => {
  const { readOriginalReceipt } = await import("../src/reference-state.ts");
  for (const reject of [false, true]) {
    let active = true,
      release;
    const response = new Promise((resolve, fail) => {
      release = reject ? fail : resolve;
    });
    const results = [];
    const reading = readOriginalReceipt(
      () => response,
      () => active,
      () => results.push("commit"),
      () => results.push("clear-session"),
    );
    active = false;
    release(
      reject ? new Error("expired previous session") : { state: "unexpected" },
    );
    await reading;
    assert.deepEqual(results, []);
  }
});
