import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyBrokerDraft,
  brokerDraftFrom,
  brokerCommand,
  currencyRemovalBlocked,
  brokerCurrencyStatus,
  brokerAccountLabels,
  type BrokerAccount,
} from "../src/broker-account-state.ts";
const row: BrokerAccount = {
  id: "ba-synthetic",
  name: "Own account",
  provider_id: "ibkr",
  account_kind: "real",
  currency: "USD",
  currencies: ["USD", "HKD"],
  holding_source: "manual",
  revision: 7,
  currency_usage: {
    complete: true,
    used_currencies: ["HKD"],
    reference_count: 1,
  },
};
test("creating an account requires explicit kind/currency and never creates a cash opening", () => {
  const empty = emptyBrokerDraft();
  assert.equal(empty.account_kind, "");
  assert.equal(empty.currency, "");
  assert.deepEqual(empty.currencies, []);
  assert.throws(() => brokerCommand(empty, "uuid", null));
  const body = brokerCommand(
    {
      ...empty,
      name: " Own account ",
      account_kind: "simulated",
      currency: "HKD",
      currencies: ["HKD", "USD"],
      provider_id: "ibkr",
    },
    "uuid",
    null,
  );
  assert.deepEqual(body, {
    request_id: "uuid",
    name: "Own account",
    account_kind: "simulated",
    provider_id: "ibkr",
    currency: "HKD",
    currencies: ["HKD", "USD"],
  });
  for (const key of ["opening", "amount", "balance", "revision"])
    assert.equal(key in body, false);
  assert.equal(
    brokerCommand(
      {
        ...empty,
        name: "Manual",
        account_kind: "real",
        currency: "USD",
        currencies: ["USD"],
      },
      "u",
      null,
    ).provider_id,
    null,
  );
});
test("editing uses the freshly read revision while preserving immutable kind/provider and unknown currency references", () => {
  const draft = brokerDraftFrom(row);
  draft.name = "Renamed";
  draft.currency = "HKD";
  const body = brokerCommand(draft, "uuid", row);
  assert.equal(body.revision, 7);
  assert.equal("provider_id" in body, false);
  assert.equal("account_kind" in body, false);
  assert.equal("owner_id" in body, false);
  assert.equal(currencyRemovalBlocked(row, "HKD"), true);
  assert.equal(currencyRemovalBlocked(row, "USD"), false);
  assert.equal(
    currencyRemovalBlocked(
      { ...row, currency_usage: { ...row.currency_usage, complete: false } },
      "USD",
    ),
    true,
  );
  assert.deepEqual(row.currencies, ["USD", "HKD"]);
  assert.throws(() => brokerDraftFrom({ ...row, revision: NaN }));
  assert.throws(() => brokerDraftFrom({ ...row, holding_source: "official" }));
  assert.throws(
    () => brokerCommand({ ...draft, currency: "EUR" }, "u", row),
    /币种/,
  );
});
test("existing opening with unresolved source or actual fees is unknown, distinct from missing opening and true zero", () => {
  assert.equal(
    brokerCurrencyStatus({ complete: false, balance: null, opening: null }),
    "期初未登记",
  );
  assert.equal(
    brokerCurrencyStatus({
      complete: false,
      balance: null,
      opening: { opening_at: "synthetic" },
    }),
    "待核实",
  );
  assert.equal(
    brokerCurrencyStatus({
      complete: true,
      balance: "0",
      opening: { opening_at: "synthetic" },
    }),
    "已核实",
  );
});

test("account selectors distinguish duplicate labels without exposing opaque identifiers", () => {
  const rows = [
    {
      id: "private-opaque-a",
      name: "同名账户",
      account_kind: "real",
      currency: "USD",
      currencies: ["USD"],
    },
    {
      id: "private-opaque-b",
      name: "同名账户",
      account_kind: "real",
      currency: "USD",
      currencies: ["USD"],
    },
    {
      id: "private-opaque-c",
      name: "同名账户",
      account_kind: "simulated",
      currency: "USD",
      currencies: ["USD"],
    },
  ];
  const labels = brokerAccountLabels(rows);
  assert.equal(labels.get(rows[0].id), "同名账户 · 真实 · USD · 账户 1");
  assert.equal(labels.get(rows[1].id), "同名账户 · 真实 · USD · 账户 2");
  assert.equal(labels.get(rows[2].id), "同名账户 · 模拟 · USD");
  for (const label of labels.values())
    assert.ok(!label.includes("private-opaque"));
  assert.equal(rows[1].id, "private-opaque-b");
});
