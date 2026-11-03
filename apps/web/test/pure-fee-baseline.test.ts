import assert from "node:assert/strict";
import test from "node:test";
import {
  baselineCommand,
  emptyBaselineDraft,
  type BaselineSource,
} from "../src/fee-baseline-state.ts";
import { emptyActualFeeDraft } from "../src/actual-fee-state.ts";
import {
  operationPath,
  restoreOperation,
  saveOperation,
} from "../src/operation-journal.ts";
const source: BaselineSource = {
  manifestId: "synthetic-manifest",
  manifestSha256: "a".repeat(64),
  sourceOwner: "old-owner",
  timezone: "America/New_York",
  ordersKnown: true,
  orders: [
    {
      id: "old-order",
      code: "TEST",
      market: "US",
      quantity: "10",
      registeredFee: "0E-18",
      status: "filled",
      occurredAt: "2026-10-31T12:00:00Z",
      actualFeeKnown: false,
    },
  ],
};
const head = {
  brokerAccountId: "ba-synthetic",
  revision: 9,
  requestId: "synthetic-previous",
};
const target = {
  orderId: "canonical-trade",
  recordId: "r",
  code: "TEST",
  qty: "10",
  recordRevision: 5,
  status: "filled",
  actualFeeKnown: false,
};
test("pure registered baseline requires real revision and explicit source/target but accepts no rate or estimate", () => {
  const draft = {
    ...emptyBaselineDraft(),
    originalId: "old-order",
    targetId: target.orderId,
    registeredConfirmed: true,
  };
  assert.equal(draft.instrumentKind, "unknown");
  assert.equal(draft.estimatedOnly, false);
  const data = baselineCommand(
    source,
    head,
    [target],
    draft,
    "internal-user",
    head.brokerAccountId,
    "synthetic-request",
  );
  assert.deepEqual(data, {
    requestId: "synthetic-request",
    manifestId: source.manifestId,
    targetUserId: "internal-user",
    brokerAccountId: head.brokerAccountId,
    expectedRevision: 9,
    selections: [
      {
        originalOrderId: "old-order",
        tradeId: "canonical-trade",
        wholeOrderConfirmed: true,
      },
    ],
    registeredBaselineConfirmed: true,
  });
  for (const key of [
    "plan",
    "ruleVersion",
    "actualFee",
    "estimatedOnlyConfirmed",
    "instrumentKind",
  ])
    assert.equal(key in data, false);
  assert.throws(
    () =>
      baselineCommand(
        source,
        { ...head, revision: NaN },
        [target],
        draft,
        "internal-user",
        head.brokerAccountId,
        "r",
      ),
    /版本/,
  );
  assert.throws(
    () =>
      baselineCommand(
        source,
        head,
        [target],
        { ...draft, registeredConfirmed: false },
        "internal-user",
        head.brokerAccountId,
        "r",
      ),
    /确认/,
  );
  assert.throws(
    () =>
      baselineCommand(
        source,
        head,
        [target],
        { ...draft, targetId: "" },
        "internal-user",
        head.brokerAccountId,
        "r",
      ),
    /选择/,
  );
  assert.throws(
    () =>
      baselineCommand(
        { ...source, ordersKnown: false },
        head,
        [target],
        draft,
        "internal-user",
        head.brokerAccountId,
        "r",
      ),
    /选择/,
  );
  assert.equal(emptyActualFeeDraft().amount, "");
  assert.equal(emptyActualFeeDraft().currency, "");
  assert.equal(emptyActualFeeDraft().actualConfirmed, false);
});
test("pending pure baseline stores only UUID locator and always recovers through its own route", () => {
  const id = "12345678-1234-4234-8234-123456789abc",
    values = new Map<string, string>();
  const storage = {
    get length() {
      return values.size;
    },
    key(i: number) {
      return [...values.keys()][i] ?? null;
    },
    getItem(k: string) {
      return values.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      values.set(k, v);
    },
    removeItem(k: string) {
      values.delete(k);
    },
  };
  saveOperation(storage, "scope", { id, kind: "fee_baseline" });
  assert.equal(
    operationPath(restoreOperation(storage, "scope")!.kind),
    "/fees/baselines",
  );
  assert.deepEqual(JSON.parse([...values.values()][0]), {
    id,
    kind: "fee_baseline",
  });
});
