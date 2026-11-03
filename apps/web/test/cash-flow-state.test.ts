import test from "node:test";
import assert from "node:assert/strict";
import { cashCommand, entriesPath } from "../src/cash-flow-state.ts";
const account = {
  id: "ba-synthetic",
  account_kind: "real",
  holding_source: "manual",
  currency: "USD",
  currencies: ["USD", "HKD"],
};
const draft = {
  action: "",
  openingBasis: "",
  amount: "",
  currency: "",
  occurredAt: "",
  note: "",
};
test("cash mutation requires explicit action, currency, original amount, time and opening source without filling unknown zero", () => {
  assert.throws(() => cashCommand(account, draft, "request"));
  const base = {
    ...draft,
    action: "opening",
    amount: "0",
    currency: "HKD",
    occurredAt: "2026-01-01T10:00:00+08:00",
  };
  assert.throws(() => cashCommand(account, base, "request"), /来源/);
  const opening = cashCommand(
    account,
    { ...base, openingBasis: "new_external_opening" },
    "request",
  );
  assert.equal(opening.amount, "0");
  assert.equal(opening.occurredAt, "2026-01-01T02:00:00.000Z");
  assert.equal(opening.currency, "HKD");
  const debit = cashCommand(
    account,
    { ...base, action: "external_withdrawal", amount: "0.000000000000000001" },
    "request",
  );
  assert.equal(debit.amount, "0.000000000000000001");
  assert.equal(debit.openingBasis, null);
  assert.throws(
    () =>
      cashCommand(
        account,
        { ...base, action: "external_deposit", amount: "" },
        "r",
      ),
    /金额/,
  );
  assert.throws(
    () => cashCommand(account, { ...base, currency: "EUR" }, "r"),
    /币种/,
  );
  assert.throws(
    () => cashCommand({ ...account, holding_source: "official" }, base, "r"),
    /手工/,
  );
  assert.throws(
    () => cashCommand({ ...account, account_kind: "unknown" }, base, "r"),
    /手工/,
  );
});
test("cash history pagination preserves owner-account scope and real captured revision", () => {
  assert.equal(
    entriesPath("account/a&b", "HKD", 25, 7),
    "/cash/accounts/account%2Fa%26b/entries?limit=25&offset=25&revision=7&currency=HKD",
  );
  assert.throws(() => entriesPath("a", "", 0, NaN));
  assert.throws(() => entriesPath("a", "", -1, 0));
});

test("completed cash history uses the server-linked original receipt and rejects injected kinds or IDs", async () => {
  const { cashReceiptPath } = await import("../src/cash-flow-state.ts");
  const requestId = "12345678-1234-4234-8234-123456789abc";
  assert.equal(
    cashReceiptPath({ kind: "cash", requestId }),
    "/cash/operations/" + requestId,
  );
  assert.equal(
    cashReceiptPath({ kind: "trade", requestId }),
    "/trading/operations/" + requestId,
  );
  assert.equal(
    cashReceiptPath({ kind: "financial_import", requestId }),
    "/financial-import/operations/" + requestId,
  );
  assert.throws(() =>
    cashReceiptPath({ kind: "constructor" as "cash", requestId }),
  );
  assert.throws(() =>
    cashReceiptPath({ kind: "cash", requestId: "../../foreign" }),
  );
});
