import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("administrator recovery starts folded with no secret inputs, danger text or duplicate page headings", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await mkdir(join(root, ".local"), { recursive: true });
  const area = await mkdtemp(join(root, ".local/admin-recovery-dom-"));
  try {
    const out = join(area, "recovery.cjs");
    await build({
      entryPoints: [
        fileURLToPath(
          new URL("../src/admin-credential-recovery.tsx", import.meta.url),
        ),
      ],
      outfile: out,
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      external: ["react", "react/jsx-runtime"],
      loader: { ".css": "empty" },
      logLevel: "silent",
    });
    const m = createRequire(import.meta.url)(out);
    const html = renderToStaticMarkup(
      React.createElement(m.AdminCredentialRecovery, {
        target: {
          id: "synthetic",
          username: "Target",
          revision: "448fca63-e431-4968-86c0-d701c60046bf",
          two_factor_enabled: true,
        },
        disabled: false,
        onSubmit() {},
      }),
    );
    assert.ok(html.includes("账号恢复"));
    for (const forbidden of [
      "<h1",
      "<h2",
      "<h3",
      "<input",
      "当前管理员密码",
      "新密码",
      "通行密钥将失效",
      "open=",
    ])
      assert.ok(!html.includes(forbidden));
  } finally {
    await rm(area, { recursive: true, force: true });
  }
});
