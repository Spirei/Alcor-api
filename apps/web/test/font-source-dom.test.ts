import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("font source controls start collapsed for member and admin, no root path or secret form is published before opening", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await mkdir(join(root, ".local"), { recursive: true });
  const area = await mkdtemp(join(root, ".local/font-source-dom-"));
  try {
    const out = join(area, "font-source.cjs");
    await build({
      entryPoints: [
        fileURLToPath(new URL("../src/font-source.tsx", import.meta.url)),
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
    for (const role of ["admin", "user"]) {
      const html = renderToStaticMarkup(
        React.createElement(m.PersonalFontSourcePanel, {
          session: {
            csrf: "synthetic",
            instance_id: "test",
            receipt_scope: "test",
            expires_at: "2099-01-01",
            user: { id: "synthetic", role },
          },
          active: true,
          onChanged() {},
        }),
      );
      assert.ok(html.includes("旧字体导入"));
      for (const fragment of [
        "<form",
        'type="password"',
        "open=",
        "root",
        "locator",
        "DSN",
        "旧字体编号",
        "<img",
        "<a ",
        "迁移完成",
      ])
        assert.ok(!html.includes(fragment), fragment);
    }
  } finally {
    await rm(area, { recursive: true, force: true });
  }
});
