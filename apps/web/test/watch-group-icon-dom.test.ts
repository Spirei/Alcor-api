import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("actual personal icon SSR and byte reader keep current owner, scope epoch, and raw-vs-derived distinction", async (t) => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await mkdir(join(root, ".local"), { recursive: true });
  const dir = await mkdtemp(join(root, ".local/group-icon-dom-")),
    before = globalThis.fetch;
  try {
    const output = join(dir, "icons.cjs");
    await build({
      stdin: {
        contents:
          'export {WatchGroupIcons,IconVersionActions} from "./src/watch-group-icons";export {iconBlob} from "./src/watch-group-icon-media";export {bindApiSession} from "./src/api-session";',
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
    const id = "448fca63-e431-4968-86c0-d701c60046bf",
      gid = "wg-synthetic",
      media = {
        version: id,
        groupId: gid,
        url:
          "/uploads/asset/group/u-synthetic/" +
          gid +
          "/sample.svg?sha256=" +
          "a".repeat(64),
        contentPath: "/api/watch-groups/" + gid + "/icons/" + id + "/content",
        originalPath: "/api/watch-groups/" + gid + "/icons/" + id + "/original",
        sha256: "a".repeat(64),
        originalSha256: "b".repeat(64),
        size: 9,
        originalSize: 8,
        mediaType: "image/svg+xml",
      },
      raw = new TextEncoder().encode("original"),
      served = new TextEncoder().encode("safe-icon");
    await t.test(
      "ordinary user and administrator see personal icon controls with no shared asset or remote URL editor",
      () => {
        for (const role of ["user", "admin"]) {
          const html = renderToStaticMarkup(
            React.createElement(m.WatchGroupIcons, {
              session: {
                instance_id: "synthetic",
                user: { id: "u-synthetic", role },
                receipt_scope: "scope",
                csrf: "csrf",
              },
              groups: { groups: [], revision: 0, initialized: false },
              active: true,
              blocked: false,
              onBlocked() {},
              onChanged() {},
              onDenied() {},
            }),
          );
          for (const label of [
            "分组图标",
            "上传图标",
            "清空图标",
            "查询图标回执",
          ])
            assert.ok(html.includes(label));
          assert.ok(html.includes('type="file"'));
          assert.ok(!html.includes("需要管理员"));
          assert.ok(!html.includes("共享素材"));
          assert.ok(!html.includes('type="url"'));
          assert.ok(!html.includes("<img"));
        }
      },
    );
    await t.test(
      "version controls distinguish safe SVG and original and never load the provided legacy URL automatically",
      () => {
        const html = renderToStaticMarkup(
          React.createElement(m.IconVersionActions, {
            media,
            label: "回执版本",
            disabled: false,
            onRead() {},
          }),
        );
        assert.ok(html.includes("预览"));
        assert.ok(html.includes("下载原件"));
        assert.ok(html.includes(id));
        assert.ok(!html.includes("<img"));
        assert.ok(!html.includes("/uploads/"));
      },
    );
    await t.test(
      "original uses fixed same-owner version path, Cookie and displayed CSRF, never returned safe bytes",
      async () => {
        m.bindApiSession("csrf");
        globalThis.fetch = async (url, options) => {
          assert.equal(url, media.originalPath);
          assert.equal(options.credentials, "same-origin");
          assert.equal(
            new Headers(options.headers).get("X-CSRF-Token"),
            "csrf",
          );
          assert.equal(new Headers(options.headers).get("Authorization"), null);
          return new Response(raw, {
            headers: {
              "Content-Length": "8",
              ETag: '"' + media.originalSha256 + '"',
            },
          });
        };
        const blob = await m.iconBlob(
          media,
          true,
          { csrf: "csrf", current: () => true },
          new AbortController().signal,
        );
        assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), raw);
        assert.equal(blob.type, "application/octet-stream");
        globalThis.fetch = async () =>
          new Response(served, {
            headers: { "Content-Length": "8", ETag: '"' + media.sha256 + '"' },
          });
        await assert.rejects(
          m.iconBlob(
            media,
            true,
            { csrf: "csrf", current: () => true },
            new AbortController().signal,
          ),
          /摘要/,
        );
      },
    );
    await t.test(
      "hidden or replaced identity cannot receive private image; rejection, truncation or extra bytes never become Blob",
      async () => {
        let called = 0;
        m.bindApiSession("other");
        globalThis.fetch = async () => {
          called++;
          throw Error("unexpected");
        };
        await assert.rejects(
          m.iconBlob(
            media,
            false,
            { csrf: "csrf", current: () => true },
            new AbortController().signal,
          ),
          /身份/,
        );
        assert.equal(called, 0);
        m.bindApiSession("csrf");
        await assert.rejects(
          m.iconBlob(
            media,
            false,
            { csrf: "csrf", current: () => false },
            new AbortController().signal,
          ),
          /身份/,
        );
        globalThis.fetch = async () => {
          m.bindApiSession("other");
          return new Response(served, {
            headers: { "Content-Length": "9", ETag: '"' + media.sha256 + '"' },
          });
        };
        await assert.rejects(
          m.iconBlob(
            media,
            false,
            { csrf: "csrf", current: () => true },
            new AbortController().signal,
          ),
          /身份/,
        );
        for (const response of [
          new Response("blocked", { status: 403 }),
          new Response(served.slice(1), {
            headers: { "Content-Length": "9", ETag: '"' + media.sha256 + '"' },
          }),
          new Response(new Uint8Array(10), {
            headers: { "Content-Length": "9", ETag: '"' + media.sha256 + '"' },
          }),
        ]) {
          m.bindApiSession("csrf");
          globalThis.fetch = async () => response;
          await assert.rejects(
            m.iconBlob(
              media,
              false,
              { csrf: "csrf", current: () => true },
              new AbortController().signal,
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
