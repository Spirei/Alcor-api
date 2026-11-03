import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFire,
  emptyFireChanges,
  fireAsset,
  fireCurrencyLocked,
  fireNumber,
  fireReceipt,
  fireYear,
  clearFireRequests,
  readFireRequest,
  releaseFireRequest,
  retainFireRequest,
} from "../src/fire-state.ts";
const id = "448fca63-e431-4968-86c0-d701c60046bf",
  next = "558fca63-e431-4968-86c0-d701c60046bf";
function store() {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
}
test("blank planning fields remain unknown while explicitly entered zero remains real zero", () => {
  const c = emptyFireChanges();
  assert.deepEqual(buildFire({}, c, 2026), { tableRows: [] });
  c.fields = {
    baseCurrency: "CNY",
    annualExpense: "0",
    currentInput: "0",
    annualReturn: "",
  };
  const out = buildFire({}, c, 2026);
  assert.equal(out.annualExpense, 0);
  assert.equal(out.currentInput, "0");
  assert.ok(!Object.hasOwn(out, "annualReturn"));
  assert.ok(!Object.hasOwn(out, "assetHistory"));
  assert.throws(() => fireNumber(""));
  assert.throws(() => fireNumber("NaN"));
});
test("past annual original fields and currency cannot be edited deleted relabelled or defaulted from a draft", () => {
  const old = {
    baseCurrency: "CNY",
    fireTargetUsd: 17,
    displayCurrency: "EUR",
    other: { source: "retained" },
    tableRows: [
      { year: 2025, current: "12", target: "33", unrecognized: "raw" },
      { year: 2026, current: "20" },
    ],
  };
  const c = emptyFireChanges();
  c.fields.baseCurrency = "USD";
  c.rows = { "2025": { current: "999" }, "2026": { current: "25" } };
  c.removed = [2025];
  const out = buildFire(old, c, 2026);
  assert.equal(out.baseCurrency, "CNY");
  assert.deepEqual((out.tableRows as unknown[])[0], old.tableRows[0]);
  assert.equal((out.tableRows as Record<string, unknown>[])[1].current, "25");
  assert.equal(out.fireTargetUsd, 17);
  assert.equal(out.displayCurrency, "EUR");
  assert.deepEqual(out.other, old.other);
  assert.ok(fireCurrencyLocked(old, 2026));
  const missing = buildFire(
    { tableRows: [{ year: 2025, current: "12" }] },
    Object.assign(emptyFireChanges(), { fields: { baseCurrency: "USD" } }),
    2026,
  );
  assert.ok(!Object.hasOwn(missing, "baseCurrency"));
});
test("current and future annual values are hand entered, never generated profit or synthetic observation", () => {
  const c = emptyFireChanges();
  c.added = [2026, 2027];
  c.rows = { "2026": { original: "0", current: "12", target: "20" } };
  const out = buildFire({ baseCurrency: "USD", unrecognized: 4 }, c, 2026),
    rows = out.tableRows as Record<string, unknown>[];
  assert.equal(rows[0].profit, "");
  assert.equal(rows[0].rate, "");
  assert.equal(rows[0].progress, "");
  assert.equal(rows[1].current, "");
  assert.ok(!Object.hasOwn(out, "assetHistory"));
  c.added = [2025];
  assert.throws(() => buildFire({ baseCurrency: "USD" }, c, 2026), /结束/);
});
test("observations require independently entered currency values; USD identity is exact and unknown FX is never filled", () => {
  assert.deepEqual(fireAsset("12.50", "", "USD"), {
    amountBase: 12.5,
    amountUsd: 12.5,
    currency: "USD",
  });
  assert.deepEqual(fireAsset("100", "14", "CNY"), {
    amountBase: 100,
    amountUsd: 14,
    currency: "CNY",
  });
  for (const values of [
    ["0", "1", "USD"],
    ["100", "", "CNY"],
    ["10", "1", "UNKNOWN"],
    ["999999999999999.99", "1", "USD"],
  ])
    assert.throws(() => fireAsset(...(values as [string, string, string])));
  assert.equal(fireNumber("1000000000000000"), 1e15);
  assert.equal(fireNumber("0.0000001"), 1e-7);
});
test("same-user operation journal contains only UUID and late completion cannot erase a newer scope", () => {
  const s = store();
  s.setItem("appearance", "dark");
  retainFireRequest(s, "old", id);
  assert.equal(s.getItem("alcor.fire-request:old"), id);
  assert.throws(() => retainFireRequest(s, "old", next));
  assert.equal(readFireRequest(s, "new"), null);
  retainFireRequest(s, "new", next);
  releaseFireRequest(s, "old", id);
  assert.equal(readFireRequest(s, "new"), next);
  clearFireRequests(s);
  assert.equal(s.length, 1);
});
test("malformed locator and unresolved or different operation response cannot become a completed receipt", () => {
  const s = store();
  s.setItem("alcor.fire-request:scope", "../../private");
  assert.throws(() => readFireRequest(s, "scope"));
  const good = {
    ok: true,
    requestId: id,
    state: "completed",
    revision: 1,
    assetHistory: [],
  };
  assert.deepEqual(fireReceipt(good, id), good);
  for (const bad of [
    { ...good, requestId: next },
    { ...good, state: "pending" },
    { ...good, revision: 0 },
    { ...good, assetHistory: null },
  ])
    assert.throws(() => fireReceipt(bad, id));
});
test("natural year boundary matches Asia Shanghai independently of browser timezone", () => {
  assert.equal(fireYear(new Date("2026-12-31T15:59:59Z")), 2026);
  assert.equal(fireYear(new Date("2026-12-31T16:00:00Z")), 2027);
});
