import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("actual SSR DOM keeps migration duties separate and consent uses shared hidden password and accessible code fields", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const temporary = join(root, ".local");
  await mkdir(temporary, { recursive: true });
  const directory = await mkdtemp(join(temporary, "source-dom-"));
  const output = join(directory, "source.cjs");
  try {
    await build({
      entryPoints: [
        fileURLToPath(new URL("../src/legacy-import.tsx", import.meta.url)),
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
    const components = createRequire(import.meta.url)(output);
    for (const approve of [true, false]) {
      const markup = renderToStaticMarkup(
        React.createElement(components.SourceConsentForm, {
          formRef: { current: null },
          disabled: false,
          approve,
          onSubmit() {},
        }),
      );
      assert.match(markup, /type="password"/);
      assert.match(markup, /aria-label="显示密码"/);
      assert.match(markup, /autoComplete="current-password"/);
      assert.match(markup, /autoComplete="one-time-code"/);
      assert.ok(markup.includes(approve ? "同意来源读取" : "撤销来源读取"));
      assert.ok(!markup.includes("确认金融入账"));
    }
    const previous = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { hidden: false },
    });
    try {
      const markup = renderToStaticMarkup(
        React.createElement(components.LegacyImportPage, {
          active: true,
          session: {
            instance_id: "synthetic",
            user: {
              id: "synthetic-owner",
              role: "admin",
              username: "Synthetic",
            },
            receipt_scope: "synthetic-scope",
            csrf: "synthetic-only",
          },
        }),
      );
      assert.equal((markup.match(/<h1>/g) || []).length, 1);
      assert.ok(markup.includes("旧数据导入"));
      assert.ok(!markup.includes("迁移进度"));
      assert.ok(!markup.includes("全部迁移完成"));
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previous,
      });
    }
  } finally {
    assert.equal(dirname(output), directory);
    await rm(directory, { recursive: true, force: true });
  }
});
