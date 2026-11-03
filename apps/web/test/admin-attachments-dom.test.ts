import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("actual shared attachment page SSR is admin gated and download uses current cookie/CSRF and exact bounded bytes", async (t) => {
  const root = fileURLToPath(new URL("../../../", import.meta.url)),
    tmp = join(root, ".local");
  await mkdir(tmp, { recursive: true });
  const dir = await mkdtemp(join(tmp, "admin-attachment-dom-"));
  const beforeFetch = globalThis.fetch;
  try {
    const output = join(dir, "attachments.cjs");
    await build({
      stdin: {
        contents:
          'export {AdminAttachmentsPage} from "./src/admin-attachments"; export {attachmentOriginal} from "./src/admin-attachment-original"; export {bindApiSession} from "./src/api-session";',
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
    const module = createRequire(import.meta.url)(output),
      session = {
        instance_id: "synthetic",
        user: { id: "synthetic", username: "Synthetic", role: "admin" },
        receipt_scope: "scope",
        csrf: "synthetic",
      };
    await t.test(
      "one heading, ordinary file upload and recovery controls; nonadmin sees no upload",
      () => {
        const html = renderToStaticMarkup(
          React.createElement(module.AdminAttachmentsPage, { session }),
        );
        assert.equal((html.match(/<h1>/g) || []).length, 1);
        assert.ok(html.includes("共享附件"));
        assert.ok(html.includes('type="file"'));
        assert.ok(html.includes("查询回执"));
        assert.ok(!html.includes("accept="));
        assert.ok(!html.includes("已迁移"));
        const denied = renderToStaticMarkup(
          React.createElement(module.AdminAttachmentsPage, {
            session: { ...session, user: { ...session.user, role: "user" } },
          }),
        );
        assert.ok(denied.includes("需要管理员权限"));
        assert.ok(!denied.includes('type="file"'));
      },
    );
    const digest = '"' + "0".repeat(64) + '"',
      signal = new AbortController().signal;
    await t.test(
      "zero and nonempty downloads keep original bytes, exact private URL and same-session CSRF",
      async () => {
        for (const bytes of [new Uint8Array(), new Uint8Array([0, 255, 4])]) {
          module.bindApiSession("synthetic");
          globalThis.fetch = async (url, init) => {
            const actual = new URL(String(url), "https://example.invalid");
            assert.equal(actual.pathname, "/api/admin/attachments");
            assert.equal(actual.searchParams.get("path"), "报告/a?.bin");
            assert.equal(init?.credentials, "same-origin");
            assert.equal(
              new Headers(init?.headers).get("x-csrf-token"),
              "synthetic",
            );
            assert.equal(new Headers(init?.headers).get("authorization"), null);
            return new Response(bytes, {
              headers: { "Content-Length": String(bytes.length), ETag: digest },
            });
          };
          const result = await module.attachmentOriginal(
            { rel: "报告/a?.bin", size: bytes.length },
            { csrf: "synthetic", current: () => true },
            signal,
          );
          assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
          assert.equal(result.type, "application/octet-stream");
        }
      },
    );
    await t.test(
      "stale displayed CSRF or hidden page performs no download request",
      async () => {
        module.bindApiSession("new");
        globalThis.fetch = async () => {
          throw Error("must not fetch");
        };
        await assert.rejects(
          module.attachmentOriginal(
            { rel: "one", size: 1 },
            { csrf: "old", current: () => true },
            signal,
          ),
          /身份/,
        );
        module.bindApiSession("synthetic");
        await assert.rejects(
          module.attachmentOriginal(
            { rel: "one", size: 1 },
            { csrf: "synthetic", current: () => false },
            signal,
          ),
          /身份/,
        );
      },
    );
    await t.test(
      "identity replacement while download response is pending cannot yield old bytes",
      async () => {
        module.bindApiSession("synthetic");
        globalThis.fetch = async () => {
          module.bindApiSession("changed");
          return new Response("private", {
            headers: { "Content-Length": "7", ETag: digest },
          });
        };
        await assert.rejects(
          module.attachmentOriginal(
            { rel: "one", size: 7 },
            { csrf: "synthetic", current: () => true },
            signal,
          ),
          /身份/,
        );
      },
    );
    await t.test(
      "permission, length mismatch, truncation and overflow never yield a downloadable blob",
      async () => {
        for (const response of [
          new Response("private", { status: 403 }),
          new Response("a", {
            headers: { "Content-Length": "1", ETag: digest },
          }),
          new Response("a", {
            headers: { "Content-Length": "2", ETag: digest },
          }),
          new Response("abc", {
            headers: { "Content-Length": "2", ETag: digest },
          }),
        ]) {
          module.bindApiSession("synthetic");
          globalThis.fetch = async () => response;
          await assert.rejects(
            module.attachmentOriginal(
              { rel: "one", size: 2 },
              { csrf: "synthetic", current: () => true },
              signal,
            ),
          );
        }
      },
    );
  } finally {
    globalThis.fetch = beforeFetch;
    await rm(dir, { recursive: true, force: true });
  }
});
