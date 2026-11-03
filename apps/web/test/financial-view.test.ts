import test from "node:test";
import assert from "node:assert/strict";
import { financialSummary } from "../src/financial-view.ts";

test("cancel confirmation retains the server-captured account and exact order inputs", () => {
  const order = {
    id: "order-original",
    accountId: "account-original",
    accountKind: "simulated",
    recordId: "record-original",
    side: "sell",
    quantity: "0.000000000000000001",
    limitPrice: "9999999999.123456789",
    fees: "0",
    currency: "HKD",
    reservedCash: "0",
  };
  const summary = financialSummary({
    action: "cancel",
    order,
    preview: "secret",
  });
  assert.equal(summary.orderId, "order-original");
  assert.equal(summary.accountId, "account-original");
  assert.equal(summary.quantity, "0.000000000000000001");
  assert.equal(summary.limitPrice, "9999999999.123456789");
  assert.equal(summary.fees, "0");
  assert.equal(summary.preview, undefined);
});
test("missing cancellation identity fails closed instead of showing an empty confirmation", () => {
  assert.throws(() => financialSummary({ action: "cancel" }), /摘要缺失/);
  assert.throws(
    () => financialSummary({ action: "cancel", order: { id: "order" } }),
    /来源缺失/,
  );
});
