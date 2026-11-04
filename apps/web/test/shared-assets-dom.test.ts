import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("actual shared image SSR and original downloader enforce administrator current session and raw-vs-served evidence", async (t) => {
  const root = fileURLToPath(new URL("../../../", import.meta.url)),
    tmp = join(root, ".local");
  await mkdir(tmp, { recursive: true });
  const dir = await mkdtemp(join(tmp, "shared-asset-dom-"));
  const before = globalThis.fetch;
  try {
    const output = join(dir, "asset.cjs");
    await build({
      stdin: {
        contents:
          'export {SharedAssetsPage} from "./src/shared-assets";export {sharedAssetOriginal} from "./src/shared-asset-original";export {bindApiSession} from "./src/api-session";export {assetImageUrl} from "./src/asset-library-browser";',
        resolveDir: fileURLToPath(new URL("../", import.meta.url)),
        loader: "tsx",
      },
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
    await t.test("asset previews only use registered local media paths", () => {
      for (const url of [
        "https://tracker.invalid/image.png",
        "//tracker.invalid/image.png",
        "data:image/svg+xml,bad",
        "/uploads/../private",
        "/uploads/%2e%2e/private",
        "/uploads/x%2fsecret",
        "/api/session",
        "/uploads/x\\secret",
      ])
        assert.equal(m.assetImageUrl(url), "");
      for (const url of [
        "/api/asset-image/registered?v=123",
        "/uploads/asset/stock/US/DEMO.png?sha256=abc",
      ])
        assert.equal(m.assetImageUrl(url), url);
    });
    const raw = new TextEncoder().encode("original-SVG-source"),
      normalized = new TextEncoder().encode("normalized-SVG-output");
    const hash = (bytes: Uint8Array) =>
      createHash("sha256").update(bytes).digest("hex");
    const id = "448fca63-e431-4968-86c0-d701c60046bf",
      version = "558fca63-e431-4968-86c0-d701c60046bf",
      sha = hash(normalized),
      originalSha = hash(raw),
      legacyUrl = "/uploads/logo/sample.svg";
    const receipt = {
      requestId: id,
      namespace: "system_public",
      state: "completed",
      revision: 1,
      httpStatus: 200,
      message: "ok",
      kind: "logo",
      url: legacyUrl + "?sha256=" + sha,
      legacyUrl,
      version,
      sha256: sha,
      originalSha256: originalSha,
      size: normalized.length,
      originalSize: raw.length,
    };
    const signal = new AbortController().signal;
    await t.test(
      "administrator has all five kinds and upload/receipt controls while ordinary user has no upload form",
      () => {
        const session = {
          instance_id: "synthetic",
          user: { id: "synthetic", username: "Synthetic", role: "admin" },
          receipt_scope: "scope",
          csrf: "synthetic",
        };
        const html = renderToStaticMarkup(
          React.createElement(m.SharedAssetsPage, { session }),
        );
        assert.equal((html.match(/<h1>/g) || []).length, 1);
        for (const label of [
          "共享素材",
          "主页背景",
          "站点标志",
          "登录页图片",
          "查询回执",
        ])
          assert.ok(html.includes(label));
        assert.ok(html.includes('type="file"'));
        assert.ok(!html.includes("img src="));
        const denied = renderToStaticMarkup(
          React.createElement(m.SharedAssetsPage, {
            session: { ...session, user: { ...session.user, role: "user" } },
          }),
        );
        assert.ok(denied.includes("需要管理员权限"));
        assert.ok(!denied.includes('type="file"'));
      },
    );
    await t.test(
      "original download uses fixed admin version URL Cookie and current CSRF and returns original bytes not normalized preview",
      async () => {
        m.bindApiSession("synthetic");
        globalThis.fetch = async (url, options) => {
          assert.equal(
            url,
            "/api/admin/shared-assets/versions/" + version + "/original",
          );
          assert.equal(options?.credentials, "same-origin");
          assert.equal(
            new Headers(options?.headers).get("X-CSRF-Token"),
            "synthetic",
          );
          assert.equal(
            new Headers(options?.headers).get("Authorization"),
            null,
          );
          return new Response(raw, {
            headers: {
              "Content-Length": String(raw.length),
              ETag: '"' + originalSha + '"',
            },
          });
        };
        const blob = await m.sharedAssetOriginal(
          receipt,
          { csrf: "synthetic", current: () => true },
          signal,
        );
        assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), raw);
        assert.equal(blob.type, "application/octet-stream");
      },
    );
    await t.test(
      "served SHA cannot masquerade as original even with same body size",
      async () => {
        m.bindApiSession("synthetic");
        globalThis.fetch = async () =>
          new Response(raw, {
            headers: {
              "Content-Length": String(raw.length),
              ETag: '"' + sha + '"',
            },
          });
        await assert.rejects(
          m.sharedAssetOriginal(
            receipt,
            { csrf: "synthetic", current: () => true },
            signal,
          ),
          /摘要/,
        );
      },
    );
    await t.test(
      "stale hidden or replaced session cannot receive a downloadable old original",
      async () => {
        m.bindApiSession("new");
        globalThis.fetch = async () => {
          throw Error("no request");
        };
        await assert.rejects(
          m.sharedAssetOriginal(
            receipt,
            { csrf: "old", current: () => true },
            signal,
          ),
          /身份/,
        );
        m.bindApiSession("synthetic");
        await assert.rejects(
          m.sharedAssetOriginal(
            receipt,
            { csrf: "synthetic", current: () => false },
            signal,
          ),
          /身份/,
        );
        globalThis.fetch = async () => {
          m.bindApiSession("other");
          return new Response(raw, {
            headers: {
              "Content-Length": String(raw.length),
              ETag: '"' + originalSha + '"',
            },
          });
        };
        await assert.rejects(
          m.sharedAssetOriginal(
            receipt,
            { csrf: "synthetic", current: () => true },
            signal,
          ),
          /身份/,
        );
      },
    );
    await t.test(
      "permission rejection truncation or overlong body never become an original download",
      async () => {
        for (const response of [
          new Response("private", { status: 403 }),
          new Response(raw.slice(1), {
            headers: {
              "Content-Length": String(raw.length),
              ETag: '"' + originalSha + '"',
            },
          }),
          new Response(new Uint8Array(raw.length + 1), {
            headers: {
              "Content-Length": String(raw.length),
              ETag: '"' + originalSha + '"',
            },
          }),
        ]) {
          m.bindApiSession("synthetic");
          globalThis.fetch = async () => response;
          await assert.rejects(
            m.sharedAssetOriginal(
              receipt,
              { csrf: "synthetic", current: () => true },
              signal,
            ),
          );
        }
      },
    );
  } finally {
    globalThis.fetch = before;
    await rm(dir, { recursive: true, force: true });
  }
});
