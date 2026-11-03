import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("actual FIRE SSR supports ordinary user form and immutable past annual rows without invented starting assets", async (t) => {
  const root = fileURLToPath(new URL("../../../", import.meta.url)),
    tmp = join(root, ".local");
  await mkdir(tmp, { recursive: true });
  const dir = await mkdtemp(join(tmp, "fire-dom-"));
  try {
    const output = join(dir, "fire.cjs");
    await build({
      entryPoints: [fileURLToPath(new URL("../src/fire.tsx", import.meta.url))],
      outfile: output,
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      external: ["react", "react/jsx-runtime"],
      loader: { ".css": "empty" },
      define: {
        "import.meta.env.VITE_UI_PERF": '"0"',
        "import.meta.env.VITE_UI_DELAY_MS": '""',
      },
      logLevel: "silent",
    });
    const m = createRequire(import.meta.url)(output);
    await t.test(
      "ordinary user sees manual plan and separate observations, no JSON editor or defaults",
      () => {
        const html = renderToStaticMarkup(
          React.createElement(m.FirePage, {
            session: {
              instance_id: "synthetic",
              user: { id: "synthetic", username: "Synthetic", role: "user" },
              receipt_scope: "scope",
              csrf: "synthetic",
            },
          }),
        );
        assert.equal((html.match(/<h1>/g) || []).length, 1);
        for (const label of [
          "FIRE 规划",
          "当前资产（手填）",
          "预期年化回报",
          "手填资产观察",
          "美元金额（手填）",
          "查询回执",
        ])
          assert.ok(html.includes(label));
        assert.ok(!html.includes("需要管理员"));
        assert.ok(!html.includes("textarea"));
        assert.ok(!html.includes('value="60000"'));
        assert.ok(!html.includes("canvas"));
        assert.ok(!html.includes("已迁移"));
      },
    );
    await t.test(
      "ended years have no editable amount controls and preserve explicit zero while current year is editable",
      () => {
        const html = renderToStaticMarkup(
          React.createElement(m.FireAnnualTable, {
            rows: [
              { year: 2025, original: "0", current: "12" },
              { year: 2026, current: "20" },
              { year: 2027 },
            ],
            year: 2026,
            disabled: false,
            onChange() {},
            onRemove() {},
          }),
        );
        assert.ok(html.includes("已结束"));
        assert.ok(!html.includes('aria-label="2025 '));
        assert.ok(html.includes('aria-label="2026 当前资产"'));
        assert.ok(html.includes('aria-label="移除 2027 年"'));
        assert.ok(!html.includes('aria-label="移除 2025 年"'));
        assert.ok(html.includes("<span>0</span>"));
        assert.ok(html.includes("<span>—</span>"));
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
