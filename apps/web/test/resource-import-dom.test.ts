import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("actual SSR resource/financial tabs keep one heading and distinct accessible secret input IDs", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url)),
    tmp = join(root, ".local");
  await mkdir(tmp, { recursive: true });
  const dir = await mkdtemp(join(tmp, "resource-source-dom-"));
  try {
    const output = join(dir, "source.cjs");
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
    const forms = [undefined, "resource-consent"].map((idPrefix) =>
      renderToStaticMarkup(
        React.createElement(components.SourceConsentForm, {
          formRef: { current: null },
          disabled: false,
          approve: true,
          idPrefix,
          onSubmit() {},
        }),
      ),
    );
    assert.ok(forms[0].includes('id="source-consent-password"'));
    assert.ok(forms[1].includes('id="resource-consent-password"'));
    assert.ok(forms[1].includes('aria-controls="resource-consent-password"'));
    assert.ok(!forms[1].includes('id="source-consent-password"'));
    const before = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { hidden: false },
    });
    try {
      const html = renderToStaticMarkup(
        React.createElement(components.LegacyImportPage, {
          active: true,
          session: {
            instance_id: "synthetic",
            user: { id: "synthetic", username: "Synthetic", role: "admin" },
            receipt_scope: "scope",
            csrf: "synthetic",
          },
        }),
      );
      assert.equal((html.match(/<h1>/g) || []).length, 1);
      assert.ok(html.includes('role="tablist"'));
      assert.ok(html.includes("金融来源"));
      assert.ok(html.includes("资源来源"));
      assert.ok(!html.includes("整库迁移完成"));
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: before,
      });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
