import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  emptyBrokerDraft,
  brokerDraftFrom,
  type BrokerAccount,
} from "../src/broker-account-state.ts";
test("account fields expose supported currencies while edit cannot reclassify broker identity or open a financial balance", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await mkdir(join(root, ".local"), { recursive: true });
  const dir = await mkdtemp(join(root, ".local", "broker-dom-"));
  try {
    const out = join(dir, "fields.cjs");
    await build({
      entryPoints: [
        fileURLToPath(
          new URL("../src/broker-account-fields.tsx", import.meta.url),
        ),
      ],
      outfile: out,
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      external: ["react", "react/jsx-runtime"],
      logLevel: "silent",
    });
    const { BrokerAccountFields } = createRequire(import.meta.url)(out);
    const create = renderToStaticMarkup(
      React.createElement(BrokerAccountFields, {
        draft: emptyBrokerDraft(),
        existing: null,
        disabled: false,
        onChange() {},
      }),
    );
    assert.ok(
      create.includes("选择账户类型") &&
        create.includes("选择默认币种") &&
        create.includes("支持币种"),
    );
    assert.ok(!create.includes('checked=""'));
    assert.ok(!create.includes("期初金额"));
    const row: BrokerAccount = {
      id: "ba-synthetic",
      name: "Independent",
      provider_id: "ibkr",
      account_kind: "real",
      currency: "USD",
      currencies: ["USD", "HKD"],
      holding_source: "manual",
      revision: 7,
      currency_usage: {
        complete: false,
        used_currencies: [],
        reference_count: 1,
      },
    };
    const edit = renderToStaticMarkup(
      React.createElement(BrokerAccountFields, {
        draft: brokerDraftFrom(row),
        existing: row,
        disabled: false,
        onChange() {},
      }),
    );
    assert.ok(
      edit.includes("盈透") &&
        edit.includes("版本 7") &&
        edit.includes("范围未知"),
    );
    assert.ok(!edit.includes('aria-label="账户类型：'));
    assert.ok(edit.includes("已引用或范围未知"));
    assert.ok(!edit.includes("已连接"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
