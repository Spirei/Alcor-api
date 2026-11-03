import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("cash history labels immutable posted amounts and unknown fees without pretending page sums are actual balances", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await mkdir(join(root, ".local"), { recursive: true });
  const dir = await mkdtemp(join(root, ".local", "cash-dom-"));
  try {
    const out = join(dir, "entries.cjs");
    await build({
      entryPoints: [
        fileURLToPath(new URL("../src/cash-entry-table.tsx", import.meta.url)),
      ],
      outfile: out,
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      external: ["react", "react/jsx-runtime"],
      logLevel: "silent",
    });
    const { CashEntryTable } = createRequire(import.meta.url)(out);
    const html = renderToStaticMarkup(
      React.createElement(CashEntryTable, {
        value: {
          accountId: "synthetic",
          accountKind: "real",
          coverageScope: "platform_registered_entries_only",
          revision: 7,
          total: 2,
          nextOffset: null,
          items: [
            {
              id: "a",
              requestId: "u",
              kind: "opening",
              currency: "HKD",
              registeredAmount: "0",
              occurredAt: "2026-01-01T00:00:00+08:00",
              createdAt: "2026-01-01T00:00:00Z",
              note: "",
              affectsOwnerCash: true,
              sourceTradeId: null,
              feeAuthority: null,
              actualFeeKnown: null,
            },
            {
              id: "b",
              requestId: "v",
              kind: "trade_buy",
              currency: "USD",
              registeredAmount: "-100",
              occurredAt: "2026-01-01T00:00:00Z",
              createdAt: "2026-01-01T00:00:00Z",
              note: "Raw registered source",
              affectsOwnerCash: true,
              sourceTradeId: "t",
              feeAuthority: "unverified_legacy",
              actualFeeKnown: false,
            },
          ],
        },
      }),
    );
    assert.ok(
      html.includes("原币登记金额") &&
        html.includes("0 HKD") &&
        html.includes("-100 USD") &&
        html.includes("实付费用未知"),
    );
    assert.ok(html.includes("原请求 v"));
    assert.ok(!html.includes("账户总额"));
    assert.ok(!html.includes("余额 0"));
    const empty = renderToStaticMarkup(
      React.createElement(CashEntryTable, { value: { items: [] } }),
    );
    assert.ok(empty.includes("暂无登记流水"));
    assert.ok(!empty.includes("余额"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
