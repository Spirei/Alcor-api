import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("source management stays folded with no source data fetch, prompts or replacement of existing group controls", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await mkdir(join(root, ".local"), { recursive: true });
  const area = await mkdtemp(join(root, ".local/source-dom-"));
  try {
    const output = join(area, "source.cjs");
    await build({
      entryPoints: [
        fileURLToPath(
          new URL("../src/watch-group-source.tsx", import.meta.url),
        ),
      ],
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
    const html = renderToStaticMarkup(
      React.createElement(m.WatchGroupSourcePanel, {
        session: {
          instance_id: "synthetic",
          user: { id: "synthetic", role: "user" },
          receipt_scope: "scope",
          csrf: "synthetic",
        },
        active: true,
        blocked: false,
        revision: 0,
        onBlocked() {},
        onChanged() {},
        onDenied() {},
      }),
    );
    assert.ok(html.includes("来源迁移"));
    for (const forbidden of [
      "同意来源读取",
      "当前密码",
      "读取旧分组",
      "统一",
      "已迁移",
      "<h1>",
      'open=""',
    ])
      assert.ok(!html.includes(forbidden));
    const rows = renderToStaticMarkup(
      React.createElement(m.SourceRows, {
        rows: [
          {
            sequence: 0,
            originalId: "old-owned",
            rowSha256: "a".repeat(64),
            state: "unknown",
            reason: "original_record_binding_missing_or_deleted",
          },
        ],
        members: true,
      }),
    );
    assert.ok(rows.includes("待核对"));
    assert.ok(rows.includes("原记录尚未映射或已删除"));
    assert.ok(!rows.includes("已核对"));
  } finally {
    await rm(area, { recursive: true, force: true });
  }
});
