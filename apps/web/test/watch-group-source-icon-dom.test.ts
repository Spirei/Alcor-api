import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("source icon tools stay closed; raw source references are text evidence and never render images or external links", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await mkdir(join(root, ".local"), { recursive: true });
  const area = await mkdtemp(join(root, ".local/source-icon-dom-"));
  try {
    const out = join(area, "source-icons.cjs");
    await build({
      entryPoints: [
        fileURLToPath(
          new URL("../src/watch-group-source-icons.tsx", import.meta.url),
        ),
      ],
      outfile: out,
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
    const m = createRequire(import.meta.url)(out);
    const closed = renderToStaticMarkup(
      React.createElement(m.WatchGroupSourceIcons, {
        session: { csrf: "synthetic", user: { id: "synthetic", role: "user" } },
        active: true,
        blocked: false,
        revision: 0,
        manifest: null,
        receipt: null,
        onBusy() {},
        onCommand() {},
        onDenied() {},
      }),
    );
    assert.ok(closed.includes("来源图标"));
    for (const word of [
      "读取该组原图",
      "下载已归档原图",
      "替换当前图标",
      "open=",
      "<h1",
    ])
      assert.ok(!closed.includes(word));
    const details = renderToStaticMarkup(
      React.createElement(m.SourceOriginalDetails, {
        captured: {
          requestId: "448fca63-e431-4968-86c0-d701c60046bf",
          kind: "capture",
          domain: "source_icon",
          state: "completed_with_blocked",
          captureState: "blocked",
          originalGroupId: "old-custom",
          originalSha256: null,
          originalSize: null,
          sourceReferenceKnown: true,
          sourceReference: "https://unapproved.example.invalid/raw.svg",
          financialApplied: false,
        },
      }),
    );
    assert.ok(details.includes("原图读取受阻"));
    assert.ok(details.includes("未知"));
    assert.ok(details.includes("unapproved.example.invalid"));
    for (const word of ["<img", "<a ", "src=", "href=", "已应用"])
      assert.ok(!details.includes(word));
  } finally {
    await rm(area, { recursive: true, force: true });
  }
});
