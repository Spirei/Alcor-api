import assert from "node:assert/strict";
import test from "node:test";
import {
  baselineSource,
  estimateBaselineCommand,
  emptyBaselineDraft,
  originalBlocker,
} from "../src/fee-baseline-state.ts";
import { emptyActualFeeDraft } from "../src/actual-fee-state.ts";
const manifest = {
  source: { owner: "original-owner", timezone: "America/New_York" },
  orderFacts: {
    "original-order": { registeredFee: "0E-18", actualFeeKnown: false },
  },
};
const source = baselineSource("manifest", "a".repeat(64), manifest, {
  tables: {
    trade_orders: {
      present: true,
      rows: [
        {
          id: { text: "original-order" },
          code: { text: "TEST" },
          status: { text: "filled" },
          traded_at: { text: "2026-09-01T12:00:00Z" },
          qty: { text: "10" },
        },
      ],
    },
  },
});
const target = {
  orderId: "canonical-trade",
  recordId: "canonical-record",
  code: "TEST",
  qty: "10",
  recordRevision: 7,
  status: "filled",
  actualFeeKnown: false,
};
const head = {
  brokerAccountId: "canonical-account",
  revision: 7,
  requestId: "original-estimate-uuid",
};
test("baseline requires explicit original and canonical target plus real PG head revision, preserving source timezone and unknowns", () => {
  const draft = {
    ...emptyBaselineDraft(),
    originalId: "original-order",
    targetId: target.orderId,
    instrumentKind: "us_domestic_equity",
    registeredConfirmed: true,
    estimatedOnly: true,
  };
  const value = estimateBaselineCommand(
    source,
    head,
    [target],
    draft,
    "platform-owner",
    "canonical-account",
    "2026-10-20.1",
    { from: "2025-05-14", through: "2026-10-20", confirmed: true },
    "request",
  );
  assert.equal(value.expectedRevision, 7);
  assert.equal(value.manifestId, "manifest");
  assert.equal(value.targetUserId, "platform-owner");
  assert.equal(value.selections[0].originalOrderId, "original-order");
  assert.equal(value.selections[0].tradeId, "canonical-trade");
  assert.equal(source.sourceOwner, "original-owner");
  assert.equal(source.timezone, "America/New_York");
  assert.equal(source.orders[0].occurredAt, "2026-09-01T12:00:00Z");
  assert.equal(originalBlocker(source.orders[0]), null);
  assert.equal("actualFee" in value, false);
  assert.throws(
    () =>
      estimateBaselineCommand(
        source,
        head,
        [target],
        { ...draft, targetId: "" },
        "platform-owner",
        "canonical-account",
        "2026-10-20.1",
        { from: "2025-05-14", through: "2026-10-20", confirmed: true },
        "request",
      ),
    /请选择/,
  );
  assert.equal(emptyActualFeeDraft().amount, "");
});
test("missing tables/registered fees and known actual zero are never converted to empty complete or estimated candidates", () => {
  const missing = baselineSource("m", "h", manifest, { tables: {} });
  assert.equal(missing.ordersKnown, false);
  assert.ok(originalBlocker({ ...source.orders[0], registeredFee: null }));
  assert.ok(originalBlocker({ ...source.orders[0], actualFeeKnown: true }));
  assert.ok(originalBlocker({ ...source.orders[0], status: "cancelled" }));
});
