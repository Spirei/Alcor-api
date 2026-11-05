import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("baseline UI keeps original/target separate, explicit metadata consent and bounded original-order pages", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await mkdir(join(root, ".local"), { recursive: true });
  const dir = await mkdtemp(join(root, ".local", "baseline-dom-"));
  try {
    const output = join(dir, "baseline.cjs");
    await build({
      entryPoints: [
        fileURLToPath(
          new URL("../src/fee-baseline-fields.tsx", import.meta.url),
        ),
      ],
      outfile: output,
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      external: ["react", "react/jsx-runtime"],
      logLevel: "silent",
    });
    const { BaselineFeeFields } = createRequire(import.meta.url)(output);
    const orders = Array.from({ length: 401 }, (_, index) => ({
      id: "original-" + index,
      code: "TEST",
      market: "US",
      quantity: "1",
      registeredFee: "0",
      status: "filled",
      occurredAt: "2026-09-01T12:00:00Z",
      actualFeeKnown: false,
    }));
    const props = {
      source: {
        manifestId: "same-manifest",
        manifestSha256: "a".repeat(64),
        sourceOwner: "old-owner",
        timezone: "America/New_York",
        ordersKnown: true,
        orders,
      },
      targets: [
        {
          orderId: "canonical-target",
          recordId: "r",
          code: "TEST",
          qty: "1",
          recordRevision: 2,
          status: "filled",
          actualFeeKnown: false,
        },
      ],
      draft: {
        originalId: "original-0",
        targetId: "canonical-target",
        instrumentKind: "unknown",
        registeredConfirmed: true,
        estimatedOnly: false,
      },
      disabled: false,
      loading: false,
      onRead() {},
      onEdit() {},
      onPreview() {},
      onEstimate() {},
    };
    const html = renderToStaticMarkup(
      React.createElement(BaselineFeeFields, props),
    );
    assert.ok(
      html.includes("原始订单") &&
        html.includes("已有本人成交") &&
        html.includes("本次仅保存估算与原订单基线"),
    );
    assert.ok(html.includes("原订单 401 条") && html.includes("下一页"));
    assert.ok(html.includes("original-199"));
    assert.ok(!html.includes("original-200"));
    assert.ok(/<button class="button">预览原登记基线<\/button>/.test(html));
    assert.ok(
      /<button class="button" disabled="">预览费率估算<\/button>/.test(html),
    );
    assert.ok(!html.includes("确认实际记账"));
    assert.ok(!html.includes("<h1>"));
    const direct = renderToStaticMarkup(
      React.createElement(BaselineFeeFields, { ...props, expanded: true }),
    );
    assert.ok(direct.includes("<h2>核对原订单基线</h2>"));
    assert.ok(!direct.includes("<summary>核对原订单基线</summary>"));
    assert.ok(
      direct.includes("original-199") && !direct.includes("original-200"),
    );
    assert.ok(!direct.includes("确认实际记账"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
