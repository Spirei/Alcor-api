import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("global source directory controls are admin-only and initially publish no metadata or path input", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await mkdir(join(root, ".local"), { recursive: true });
  const area = await mkdtemp(join(root, ".local/font-catalog-dom-"));
  try {
    const out = join(area, "catalog.cjs");
    await build({
      entryPoints: [
        fileURLToPath(new URL("../src/font-catalog.tsx", import.meta.url)),
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
    const m = createRequire(import.meta.url)(out),
      props = {
        active: true,
        blocked: false,
        options: [],
        onRegister() {},
        onDenied() {},
      };
    const member = renderToStaticMarkup(
      React.createElement(m.FontCatalogPanel, {
        ...props,
        session: { csrf: "synthetic", user: { id: "synthetic", role: "user" } },
      }),
    );
    assert.equal(member, "");
    const admin = renderToStaticMarkup(
      React.createElement(m.FontCatalogPanel, {
        ...props,
        session: {
          csrf: "synthetic",
          user: { id: "synthetic", role: "admin" },
        },
      }),
    );
    assert.ok(admin.includes("来源目录清单"));
    for (const fragment of [
      "<form",
      "<input",
      "open=",
      "目录已截断",
      "全部完成",
      "<img",
      "<a ",
      "root",
      "locator",
      "DSN",
    ])
      assert.ok(!admin.includes(fragment), fragment);
  } finally {
    await rm(area, { recursive: true, force: true });
  }
});
