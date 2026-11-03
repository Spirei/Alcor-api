import assert from "node:assert/strict";
import test from "node:test";
import {
  cardDecimal,
  walletEntryAmount,
  readWalletOperation,
  releaseWalletOperation,
  retainWalletOperation,
} from "../src/card-wallet-state.ts";
function store() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
}
test("decimal labels preserve eighteen places and distinguish unknown from real zero without floating point", () => {
  assert.equal(cardDecimal(null), "未核对");
  assert.equal(cardDecimal("0.000000000000000000"), "0");
  assert.equal(cardDecimal("-0E-18"), "0");
  assert.equal(
    cardDecimal("100000000000.123456789123456789"),
    "100000000000.123456789123456789",
  );
  assert.equal(cardDecimal("1E-18"), "0.000000000000000001");
  assert.equal(cardDecimal("12.3E+3"), "12300");
  assert.equal(cardDecimal("NaN"), "无法读取");
});
test("unknown financial operations retain only UUID/kind, never preview tokens, amounts or card secrets", () => {
  const memory = store(),
    operation = {
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "financial" as const,
    };
  retainWalletOperation(memory, "owner/instance/session", {
    ...operation,
    preview: "SYNTHETIC-PROOF",
    amount: "123.45",
    number: "4111111111111111",
  } as typeof operation);
  assert.deepEqual(JSON.parse([...memory.data.values()][0]), operation);
  assert.deepEqual(
    readWalletOperation(memory, "owner/instance/session"),
    operation,
  );
  assert.throws(() =>
    releaseWalletOperation(
      memory,
      "owner/instance/session",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ),
  );
  assert.throws(() =>
    retainWalletOperation(memory, "owner/instance/session", {
      ...operation,
      kind: "details",
    }),
  );
  releaseWalletOperation(memory, "owner/instance/session", operation.requestId);
  assert.equal(readWalletOperation(memory, "owner/instance/session"), null);
});
test("wallet recovery never transfers a pending operation to a different owner or accepts injected payload", () => {
  const memory = store();
  retainWalletOperation(memory, "old-owner/session", {
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    kind: "details",
  });
  assert.equal(readWalletOperation(memory, "new-owner/session"), null);
  assert.equal(memory.length, 0);
  memory.setItem(
    "alcor.card-wallet-request:new-owner/session",
    JSON.stringify({
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "financial",
      data: { amount: "123" },
    }),
  );
  assert.throws(() => readWalletOperation(memory, "new-owner/session"));
});

test("preview labels an absolute adjustment target separately from the before/after cash difference", () => {
  assert.equal(
    walletEntryAmount("adjust", "120", "USD"),
    "余额调整目标 120 USD",
  );
  assert.equal(cardDecimal("30"), "30");
  assert.equal(walletEntryAmount("adjust", "-5", "USD"), "余额调整目标 -5 USD");
  assert.equal(walletEntryAmount("deposit", "0", "USD"), "存入 0 USD");
  assert.equal(walletEntryAmount("withdraw", "10", "USD"), "取出 10 USD");
  assert.equal(
    walletEntryAmount("adjust", null, null),
    "余额调整目标 未核对 币种未核对",
  );
});
