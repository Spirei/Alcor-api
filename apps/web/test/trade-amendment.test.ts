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
  amendmentCommand,
  emptyAmendmentDraft,
  type AmendmentHead,
} from "../src/trade-amendment-state.ts";
import {
  operationPath,
  restoreOperation,
  saveOperation,
} from "../src/operation-journal.ts";
const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  rid = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const item = {
  tradeId: id,
  registrationRequestId: rid,
  currentAmendmentId: null,
  actualFeeKnown: true,
  canAmend: true,
  blocker: null,
  event: {
    id,
    side: "buy",
    quantity: "10",
    price: "10",
    fees: "1.03",
    occurred_at: "2026-09-01T12:00:00Z",
    currency: "USD",
  },
};
const head: AmendmentHead = {
  targetUserId: "u-owner",
  brokerAccountId: "ba-synthetic",
  brokerRevision: 2,
  recordId: "r-synthetic",
  recordRevision: 3,
  snapshotRevision: "a".repeat(64),
  scope: "native_manual_actual_single_amendment",
  items: [item],
};
test("amendment requires actual paid fee and owner declarations, keeps root identity and exact previous amendment", () => {
  const empty = emptyAmendmentDraft();
  assert.equal(empty.fees, "");
  assert.ok(!empty.actual && !empty.ledger);
  assert.throws(() => amendmentCommand(head, id, empty, "u-owner", rid));
  const draft = {
    quantity: "10",
    price: "20",
    fees: "0",
    occurredAt: item.event.occurred_at,
    statement: "Verified actual zero fee and manual ledger correction",
    actual: true,
    ledger: true,
  };
  const data = amendmentCommand(head, id, draft, "u-owner", rid);
  assert.equal(data.replacement.fees, "0");
  assert.equal(data.expectedAmendmentId, null);
  assert.equal(data.tradeId, id);
  assert.equal(data.evidence.authority, "owner_recorded");
  assert.throws(() => amendmentCommand(head, id, draft, "u-another", rid));
  assert.throws(() =>
    amendmentCommand(
      { ...head, items: [{ ...item, actualFeeKnown: false }] },
      id,
      draft,
      "u-owner",
      rid,
    ),
  );
});
test("trade amendment original UUID journal is lookup-only and stores no replacement or statement", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
    key: (i: number) => Array.from(values.keys())[i] ?? null,
    get length() {
      return values.size;
    },
  };
  saveOperation(storage, "owner:session", { id: rid, kind: "trade_amendment" });
  assert.equal(restoreOperation(storage, "owner:session")?.id, rid);
  assert.equal(operationPath("trade_amendment"), "/trading/corrections");
  assert.deepEqual(
    Object.keys(JSON.parse(Array.from(values.values())[0])).sort(),
    ["id", "kind"],
  );
});
test("ordinary transaction UI has a folded amendment and original receipt entry without an unproved confirmation", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await mkdir(join(root, ".local"), { recursive: true });
  const dir = await mkdtemp(join(root, ".local", "amendment-ui-"));
  try {
    const out = join(dir, "panel.cjs");
    await build({
      entryPoints: [
        fileURLToPath(new URL("../src/trade-amendment.tsx", import.meta.url)),
      ],
      outfile: out,
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      external: ["react", "react/jsx-runtime"],
      logLevel: "silent",
      define: { "import.meta.env": "{}" },
    });
    const { TradeAmendmentPanel } = createRequire(import.meta.url)(out);
    const html = renderToStaticMarkup(
      React.createElement(TradeAmendmentPanel, {
        session: { user: { id: "u-owner" }, csrf: "synthetic" },
        recordId: "r-synthetic",
        generation: 0,
        blocked: false,
        onSubmit: async () => false,
      }),
    );
    assert.ok(
      html.includes("成交更正") &&
        html.includes("查询更正回执") &&
        html.includes("原请求UUID"),
    );
    assert.ok(!html.includes("确认更正"));
    assert.ok(!html.includes("券商已确认"));
    assert.ok(!html.includes('value="1.03"'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("merge binds every active actual predecessor; delete carries no fabricated replacement or zero paid fee", () => {
  const other = {
    ...item,
    tradeId: "cccccccc-cccc-4ccc-accc-cccccccccccc",
    currentAmendmentId: rid,
  };
  const current: AmendmentHead = {
    ...head,
    scope: "native_manual_actual_correction_actions",
    mergeReady: true,
    deleteReady: true,
    items: [item, other],
  };
  const draft = {
    ...emptyAmendmentDraft(),
    quantity: "20",
    price: "15",
    fees: "0",
    occurredAt: item.event.occurred_at,
    statement: "Verified actual source orders and actual replacement paid zero",
    actual: true,
    ledger: true,
  };
  assert.throws(() =>
    amendmentCommand(current, id, draft, "u-owner", rid, {
      action: "merge",
      members: [],
    }),
  );
  const merge = amendmentCommand(current, id, draft, "u-owner", rid, {
    action: "merge",
    members: [other.tradeId],
  });
  assert.equal(merge.action, "merge");
  assert.equal(merge.members?.[1].expectedAmendmentId, rid);
  assert.equal(merge.replacement?.fees, "0");
  assert.throws(() =>
    amendmentCommand(
      { ...current, items: [item, { ...other, actualFeeKnown: false }] },
      id,
      draft,
      "u-owner",
      rid,
      { action: "merge", members: [other.tradeId] },
    ),
  );
  const remove = amendmentCommand(
    current,
    id,
    {
      ...emptyAmendmentDraft(),
      statement: "Verified original fill must be removed from my book",
      actual: true,
      ledger: true,
    },
    "u-owner",
    rid,
    { action: "delete", members: [] },
  );
  assert.equal(remove.action, "delete");
  assert.equal(remove.replacement, null);
  assert.ok(!("members" in remove));
  assert.throws(() =>
    amendmentCommand(
      { ...current, items: [{ ...item, event: null }] },
      id,
      draft,
      "u-owner",
      rid,
      { action: "delete", members: [] },
    ),
  );
});


test("financed correction requires a separate actual borrowing statement and preserves original UUID evidence", () => {
  const draft={...emptyAmendmentDraft(),quantity:"10",price:"20",fees:"1",occurredAt:item.event.occurred_at,statement:"Actual paid correction",actual:true,ledger:true};
  assert.ok(!("financingConfirmation" in amendmentCommand(head,id,draft,"u-owner",rid)));
  assert.throws(()=>amendmentCommand(head,id,{...draft,financing:true},"u-owner",rid));
  const command=amendmentCommand(head,id,{...draft,financing:true,financingStatement:"Actual borrowing independently checked"},"u-owner",rid);
  assert.deepEqual(command.financingConfirmation,{kind:"owner_statement",statement:"Actual borrowing independently checked",actualBorrowingConfirmed:true,ledgerOnlyConfirmed:true});
  assert.equal(command.requestId,rid);assert.equal(command.tradeId,id);
});
