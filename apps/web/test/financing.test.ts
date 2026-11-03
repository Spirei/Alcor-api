import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  emptyFinancingDraft,
  financingCommand,
  financingConfirmation,
  financingCurrencies,
  type FinancingHead,
} from "../src/financing-state.ts";
import { cashCommand } from "../src/cash-flow-state.ts";
import {
  operationPath,
  restoreOperation,
  saveOperation,
} from "../src/operation-journal.ts";
const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const head: FinancingHead = {
  targetUserId: "u-owner",
  accountKind: "real",
  revision: "a".repeat(64),
  policyKnown: false,
  sourcePolicyPending: true,
  policy: null,
  exceedsLimit: null,
  debt: {
    debtKnown: false,
    debt: null,
    currency: null,
    basisLabel: "同身份同币种净现金负值",
    blockers: ["whole_owner_financial_scope_unknown"],
    fx: { observationId: null },
  },
};
test("policy keeps all15 currencies, unknown separate from zero and exact amount drafts", () => {
  assert.equal(financingCurrencies.length, 15);
  assert.ok(financingCurrencies.includes("CHF"));
  assert.throws(() =>
    financingCommand(head, emptyFinancingDraft(), "u-owner", id),
  );
  const draft = {
    currency: "JPY",
    limit: "0",
    initialMargin: "",
    maintenanceMargin: "",
  };
  const value = financingCommand(head, draft, "u-owner", id);
  assert.equal(value.policy.limit, "0");
  assert.equal(value.policy.initialMargin, null);
  assert.equal(value.accountKind, "real");
  assert.equal(value.revision, head.revision);
  assert.throws(() => financingCommand(head, draft, "u-other", id));
});
test("signed reconciliation and actual financing require explicit owner confirmation rather than an inferred zero", () => {
  assert.throws(() => financingConfirmation(false, "Actual statement"));
  assert.throws(() => financingConfirmation(true, ""));
  const account = {
    id: "ba-owned",
    account_kind: "real",
    holding_source: "manual",
    currency: "USD",
  };
  const draft = {
    action: "reconcile_balance",
    openingBasis: "",
    amount: "-5.11",
    currency: "USD",
    occurredAt: "2026-09-01T12:00:00Z",
    note: "",
  };
  assert.throws(() => cashCommand(account, draft, id));
  const value = cashCommand(
    account,
    {
      ...draft,
      financingConfirmed: true,
      financingStatement: "I checked the actual signed account balance",
    },
    id,
  );
  assert.equal(value.amount, "-5.11");
  assert.equal(value.allowNegativeBalance, true);
  assert.equal(value.financingConfirmation?.kind, "owner_statement");
  assert.equal(value.financingConfirmation?.ledgerOnlyConfirmed, true);
});
test("financing journal retains only the original UUID and routes policy receipt lookup", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  };
  saveOperation(storage, "current-owner-session", {
    id,
    kind: "financing_policy",
  });
  assert.equal(restoreOperation(storage, "current-owner-session")?.id, id);
  assert.equal(operationPath("financing_policy"), "/financing/policy");
  assert.deepEqual(
    Object.keys(JSON.parse(Array.from(values.values())[0])).sort(),
    ["id", "kind"],
  );
});
test("ordinary cash view exposes a folded financing policy and UUID query without a default confirmation", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await mkdir(join(root, ".local"), { recursive: true });
  const dir = await mkdtemp(join(root, ".local", "financing-ui-"));
  try {
    const file = join(dir, "panel.cjs");
    await build({
      entryPoints: [
        fileURLToPath(new URL("../src/financing-policy.tsx", import.meta.url)),
      ],
      outfile: file,
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      external: ["react", "react/jsx-runtime"],
      define: { "import.meta.env": "{}" },
      logLevel: "silent",
    });
    const { FinancingPolicyPanel } = createRequire(import.meta.url)(file);
    const html = renderToStaticMarkup(
      React.createElement(FinancingPolicyPanel, {
        session: {
          user: { id: "u-owner", role: "user" },
          csrf: "synthetic",
          receipt_scope: "synthetic",
          instance_id: "synthetic",
        },
        accountKind: "real",
        generation: 0,
        blocked: false,
        onSubmit: async () => false,
      }),
    );
    assert.ok(
      html.includes("融资政策") &&
        html.includes("查询政策回执") &&
        html.includes("原请求UUID"),
    );
    assert.ok(!html.includes("确认政策") && !html.includes('value="1000"'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
