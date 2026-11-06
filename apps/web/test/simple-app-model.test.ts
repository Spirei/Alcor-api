import assert from "node:assert/strict";
import test from "node:test";
import {
  decode,
  encode,
  object,
  patchRow,
  typedPatch,
  totals,
  amountIn,
  day,
  add,
  ratio,
  deriveRatio,
  decimal,
  annual,
  revisionToken,
  performance,
  validateRow,
  SourceNumber,
  appendInvestmentObservation,
} from "../src/simple-app-model.ts";
test("lossless typed edit preserves unknown nested numeric tokens and source collection elements", () => {
  const raw =
    '{"cash":[null,null,"unknown",[1e-1000],{"id":"a","name":"A","amount":12.34000000000000000001,"cur":"USD","extra":{"huge":123456789012345678901234,"tiny":1e-1000,"negative":-0}}],"opaque":1E+999,"fixed":[],"receivable":[],"debt":[],"invest":[]}';
  const ledger = object(decode(raw));
  assert.equal(encode(ledger), raw);
  const source = (ledger.cash as any[])[4];
  const changed = patchRow(ledger, "cash", { ...source, name: "Edited" });
  assert.equal(encode(changed), raw.replace('"A"', '"Edited"'));
  const protectedList = typedPatch(ledger, {
    ...ledger,
    cash: [{ ...source, name: "Edited" }],
  });
  assert.equal(encode(protectedList), encode(changed));
  assert.equal(
    totals(ledger, "USD").cash,
    null,
    "unrecognized original row makes the total unknown, not zero",
  );
  assert.throws(() => patchRow({ ...ledger, cash: "opaque" }, "cash", source));
  assert.throws(() => decode('{"x":1,"x":2}'));
  assert.throws(() => decode("[NaN]"));
  assert.equal(
    encode(decode('{"__proto__":{"safe":1}}')),
    '{"__proto__":{"safe":1}}',
  );
});
test("exact arithmetic and declared FX never manufacture missing balances or negative exchange rates", () => {
  assert.equal(
    add("123456789012345678901234", "0.00000000000000000001"),
    "123456789012345678901234.00000000000000000001",
  );
  assert.equal(decimal(new SourceNumber("1e-20")), "0.00000000000000000001");
  const row = { cur: "HKD", amount: "20" };
  assert.equal(amountIn(row, { fx: { HKD: "-2", USD: "1" } }, "USD"), null);
  assert.equal(amountIn(row, { fx: { HKD: "0", USD: "1" } }, "USD"), null);
  assert.equal(amountIn(row, { fx: {} }, "HKD"), "20");
  assert.equal(amountIn(row, { fx: {} }, "USD"), null);
  const ledger = {
    cash: [{ cur: "USD", amount: "10" }],
    fixed: [{ cur: "USD", amount: "20" }],
    receivable: [],
    debt: [],
    invest: [],
    excludeFixed: true,
  };
  assert.equal(totals(ledger, "USD").assets, "10");
  assert.equal(totals(ledger, "").net, null);
  assert.equal(annual({ amount: "1.25", freq: "quarter" }), "5");
  assert.equal(annual({ amount: "1", freq: "" }), null);
});
test("invalid observation dates reject safely and valid leap days remain real", () => {
  for (const value of ["0000-00-00", "2026-02-29", "2026-99-99", "2026/1/1"])
    assert.equal(day(value), false);
  assert.equal(day("2024-02-29"), true);
});

test("depth budget rejects without rewriting source and unsafe CAS is never rounded", () => {
  const raw = "[".repeat(129) + "1e-1000" + "]".repeat(129);
  assert.throws(() => decode(raw), /128/);
  assert.equal(
    revisionToken(new SourceNumber("9007199254740991")),
    "9007199254740991",
  );
  for (const raw of ["9007199254740992", "1e2", "-1", "1.1", "01"])
    assert.equal(revisionToken(new SourceNumber(raw)), null);
  const original = object(
    decode(
      '{"cash":[null,null,"unknown","unknown",{"id":"a","amount":1}],"extra":1e-1000}',
    ),
  );
  const changed = typedPatch(original, {
    ...original,
    cash: [{ id: "a", amount: "2" }],
  });
  assert.equal(
    encode(changed),
    '{"cash":[null,null,"unknown","unknown",{"id":"a","amount":"2"}],"extra":1e-1000}',
  );
});
test("declared complete observed return works without manufacturing absent flows", () => {
  const history = [
    { d: "2025-01-01", v: "100", inn: "0", out: "0" },
    { d: "2026-01-01", v: "110", inn: "0", out: "0" },
  ];
  const result = performance(history, true);
  assert.equal(result.state, "owner_declared_complete");
  assert.equal(result.annual, "10.000000");
  assert.equal(result.period, "10.000000");
  assert.equal(performance(history, false).state, "unknown");
  assert.equal(
    performance([{ ...history[0], inn: null }, history[1]], true).state,
    "unknown",
  );
  assert.equal(
    performance([history[0], { ...history[1], d: "2025-01-01" }], true).state,
    "unknown",
  );
});

test("cross currency division preserves nonzero small amounts or stays unknown, never rounded zero", () => {
  assert.equal(ratio("0.00000000000000000001", "1"), "0.00000000000000000001");
  assert.equal(ratio("1", "3"), "0.333333333333333333");
  assert.equal(
    amountIn(
      { amount: "1e-20", cur: "USD" },
      { fx: { USD: "1", CNY: "1" } },
      "CNY",
    ),
    "0.00000000000000000001",
  );
  assert.equal(
    amountIn(
      { amount: "1", cur: "USD" },
      { fx: { USD: "1", CNY: "3" } },
      "CNY",
    ),
    "0.333333333333333333",
  );
});

test("known recurring FX is an explicitly rounded estimate with 18 significant digits and unchanged input", () => {
  const raw = '{"amount":1e-20,"cur":"CNY","extra":123456789012345678901234}',
    row = object(decode(raw)),
    ledger = object(decode('{"fx":{"CNY":1,"USD":7.13}}'));
  const divided = deriveRatio("1", "7.13");
  assert.equal(divided.basis, "rounded_18_significant_digits");
  assert.equal(divided.value, "0.140252454417952314");
  assert.equal(deriveRatio("1", "4").basis, "exact");
  assert.equal(
    amountIn(row, ledger, "USD"),
    "0.00000000000000000000140252454417952314",
  );
  assert.equal(encode(row), raw);
  assert.equal(encode(ledger), '{"fx":{"CNY":1,"USD":7.13}}');
  assert.equal(amountIn(row, { fx: {} }, "USD"), null);
});

test("out-of-budget exact division labels unavailable and positive historic debt is unknown without rewriting", () => {
  assert.deepEqual(deriveRatio("1", "0." + "0".repeat(199) + "1"), {
    value: null,
    basis: "unknown",
  });
  const raw =
    '{"cash":[{"cur":"USD","amount":"100"}],"fixed":[],"receivable":[],"debt":[{"cur":"USD","amount":"50"}],"invest":[]}';
  const ledger = object(decode(raw));
  assert.equal(totals(ledger, "USD").debt, null);
  assert.equal(totals(ledger, "USD").net, null);
  assert.equal(encode(ledger), raw);
});

test("future planning observations stay in source but cannot become observed return", () => {
  const raw =
    '[{"d":"2026-01-01","v":100,"inn":0,"out":0},{"d":"2027-01-01","v":120,"inn":0,"out":0}]';
  const history = decode(raw) as any[];
  assert.equal(performance(history, true, "2026-11-03").state, "unknown");
  assert.equal(encode(history), raw);
  assert.equal(
    performance(history, true, "2027-01-01").state,
    "owner_declared_complete",
  );
});

test("existing unknown amount currency and historic sign are not repaired to permit metadata edits", () => {
  const previous = object(
    decode(
      '{"id":"a","name":"old","amount":null,"cur":null,"bucket":null,"extra":1e-1000}',
    ),
  );
  const renamed = { ...previous, name: "new", note: "explicit note" };
  assert.equal(validateRow(renamed, true, previous), null);
  assert.equal(
    encode(patchRow({ invest: [previous] }, "invest", renamed)),
    '{"invest":[{"id":"a","name":"new","amount":null,"cur":null,"bucket":null,"extra":1e-1000,"note":"explicit note"}]}',
  );
  assert.notEqual(
    validateRow({ ...previous, amount: "" }, true, previous),
    null,
  );
  assert.notEqual(
    validateRow({ name: "new", amount: null, cur: null }, false),
    null,
  );
  const positive = { id: "debt", name: "old", amount: "50", cur: "USD" };
  assert.equal(
    validateRow({ ...positive, note: "retained sign" }, false, positive),
    null,
  );
});

test("owner confirmed flow choice preserves exact current amount, unknown flows and original observation order", () => {
  const row = {
    id: "a",
    amount: "9007199254740993.000000000000000001",
    cur: "USD",
    inAmt: null,
    outAmt: "2",
    hist: [{ d: "2026-01-01", v: "10", inn: null, out: null }, null],
    opaque: new SourceNumber("1e-1000"),
  };
  const before = encode(row),
    input = {
      date: "2026-11-06",
      amount: "9007199254740993.000000000000000002",
      flow: "some" as const,
      incoming: "",
      outgoing: "3",
    };
  const updated = appendInvestmentObservation(row, input, "2026-11-06");
  assert.equal(updated.amount, input.amount);
  assert.equal(updated.inAmt, null);
  assert.equal(updated.outAmt, "5");
  assert.equal(updated.cur, "USD");
  assert.equal(encode(row), before);
  assert.equal(encode((updated.hist as any[]).slice(0, 2)), encode(row.hist));
  assert.equal((updated.hist as any[])[2].inn, null);
  const noFlow = appendInvestmentObservation(
    row,
    { ...input, flow: "none", incoming: "", outgoing: "" },
    "2026-11-06",
  );
  assert.equal((noFlow.hist as any[])[2].inn, "0");
  assert.equal((noFlow.hist as any[])[2].out, "0");
  assert.equal(noFlow.inAmt, null);
  assert.equal(noFlow.outAmt, "2");
  assert.throws(
    () =>
      appendInvestmentObservation(
        row,
        { ...input, flow: "unknown" },
        "2026-11-06",
      ),
    /请选择/,
  );
  assert.throws(
    () =>
      appendInvestmentObservation(
        row,
        { ...input, date: "2026-11-07" },
        "2026-11-06",
      ),
    /日期/,
  );
  assert.throws(
    () =>
      appendInvestmentObservation(
        row,
        { ...input, incoming: "-1" },
        "2026-11-06",
      ),
    /非负/,
  );
  assert.throws(
    () =>
      appendInvestmentObservation(
        { ...row, hist: "opaque" },
        input,
        "2026-11-06",
      ),
    /原历史/,
  );
});
