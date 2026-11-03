import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const id = "448fca63-e431-4968-86c0-d701c60046bf",
  sha = "a".repeat(64);
test("actual source panel preserves shared manager and binds archived downloads to original UUID, ordinal and current scope", async (t) => {
  const root = fileURLToPath(new URL("../../../", import.meta.url)),
    tmp = join(root, ".local");
  await mkdir(tmp, { recursive: true });
  const dir = await mkdtemp(join(tmp, "attachment-source-dom-"));
  const prior = globalThis.fetch;
  try {
    const output = join(dir, "source.cjs");
    await build({
      stdin: {
        contents:
          'export {AdminAttachmentsPage} from "./src/admin-attachments";export {AttachmentImportPanel,AttachmentImportPreview} from "./src/attachment-import";export {attachmentArchiveOriginal} from "./src/attachment-import-original";export {bindApiSession} from "./src/api-session";',
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
    const m = createRequire(import.meta.url)(output),
      session = {
        instance_id: "fixture",
        user: { id: "fixture", username: "Fixture", role: "admin" },
        receipt_scope: "scope",
        csrf: "fixture",
      },
      props = {
        session,
        active: true,
        blocked: false,
        onBlocked() {},
        onChanged() {},
        onDenied() {},
      };
    const item = (size: number | null = 3) => ({
      ordinal: 9,
      evidence: {
        path: "do-not-use-this-as-http-path.bin",
        kind: "file",
        size,
        sha256: sha,
        captureState: "ready",
        reason: null,
      },
      apply_state: null,
      result: null,
    });
    const signal = new AbortController().signal;
    await t.test(
      "admin has one file manager with embedded source tools; member denied and source panel accepts no root, DSN or remote URL",
      () => {
        const html = renderToStaticMarkup(
          React.createElement(m.AdminAttachmentsPage, {
            session,
            active: true,
          }),
        );
        assert.equal((html.match(/<h1>/g) || []).length, 1);
        assert.equal((html.match(/type="file"/g) || []).length, 1);
        for (const text of [
          "共享附件",
          "来源导入",
          "全局共享",
          "新建文件夹",
          "查询回执",
          "查询导入回执",
        ])
          assert.ok(html.includes(text), text);
        const panel = renderToStaticMarkup(
          React.createElement(m.AttachmentImportPanel, props),
        );
        for (const forbidden of [
          'type="file"',
          'type="url"',
          'type="password"',
          "DSN",
          "源文件路径",
          "rootIdentity",
          "已迁移完成",
        ])
          assert.ok(!panel.includes(forbidden), forbidden);
        const denied = renderToStaticMarkup(
          React.createElement(m.AttachmentImportPanel, {
            ...props,
            session: { ...session, user: { ...session.user, role: "user" } },
          }),
        );
        assert.ok(denied.includes("需要管理员权限"));
        assert.ok(!denied.includes("捕获清单"));
      },
    );
    await t.test(
      "actual preview labels exact blocked and already-applied rows without promoting capture to full migration",
      () => {
        const html = renderToStaticMarkup(
          React.createElement(m.AttachmentImportPreview, {
            plan: {
              items: [
                {
                  ordinal: 0,
                  path: "folder",
                  status: "already_applied",
                  reason: null,
                },
                {
                  ordinal: 1,
                  path: "folder/conflict.bin",
                  status: "blocked",
                  reason: "target_path_collision",
                },
                {
                  ordinal: 2,
                  path: "folder/empty.bin",
                  status: "ready",
                  reason: null,
                },
              ],
            },
            reason: (s: string) =>
              s === "target_path_collision" ? "目标已有同名项目" : s,
          }),
        );
        for (const text of [
          "本段预览",
          "3",
          "已经应用",
          "阻断",
          "目标已有同名项目",
          "待应用",
        ])
          assert.ok(html.includes(text), text);
        assert.ok(!html.includes("全部应用"));
      },
    );
    await t.test(
      "zero and binary archive downloads use only fixed manifest/ordinal URL, cookie and current CSRF, never source path or bearer",
      async () => {
        for (const bytes of [new Uint8Array(), new Uint8Array([0, 255, 6])]) {
          m.bindApiSession("fixture");
          globalThis.fetch = async (url, init) => {
            assert.equal(
              String(url),
              "/api/admin/attachment-import/snapshots/" +
                id +
                "/items/9/original",
            );
            assert.equal(init?.credentials, "same-origin");
            assert.equal(
              new Headers(init?.headers).get("x-csrf-token"),
              "fixture",
            );
            assert.equal(new Headers(init?.headers).get("authorization"), null);
            return new Response(bytes, {
              headers: {
                "Content-Length": String(bytes.length),
                ETag: '"' + sha + '"',
              },
            });
          };
          const blob = await m.attachmentArchiveOriginal(
            id,
            item(bytes.length),
            { csrf: "fixture", current: () => true },
            signal,
          );
          assert.equal(blob.type, "application/octet-stream");
          assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
        }
      },
    );
    await t.test(
      "unknown size, oversized file, foreign identity or hidden page never initiates archive read",
      async () => {
        let calls = 0;
        globalThis.fetch = async () => {
          calls++;
          throw Error("must not fetch");
        };
        m.bindApiSession("fixture");
        for (const invalid of [
          item(null),
          item(52428801),
          { ...item(), ordinal: -1 },
        ])
          await assert.rejects(
            m.attachmentArchiveOriginal(
              id,
              invalid,
              { csrf: "fixture", current: () => true },
              signal,
            ),
            /归档/,
          );
        await assert.rejects(
          m.attachmentArchiveOriginal(
            id,
            item(),
            { csrf: "fixture", current: () => false },
            signal,
          ),
          /身份/,
        );
        m.bindApiSession("other");
        await assert.rejects(
          m.attachmentArchiveOriginal(
            id,
            item(),
            { csrf: "fixture", current: () => true },
            signal,
          ),
          /身份/,
        );
        assert.equal(calls, 0);
      },
    );
    await t.test(
      "wrong SHA ETag, wrong length, truncated or excess response fails before download result",
      async () => {
        m.bindApiSession("fixture");
        for (const [body, headers, pattern] of [
          [
            new Uint8Array([1, 2, 3]),
            { "Content-Length": "3", ETag: '"' + "b".repeat(64) + '"' },
            /摘要/,
          ],
          [new Uint8Array([1, 2, 3]), { ETag: '"' + sha + '"' }, /大小/],
          [
            new Uint8Array([1, 2]),
            { "Content-Length": "3", ETag: '"' + sha + '"' },
            /不完整/,
          ],
          [
            new Uint8Array([1, 2, 3, 4]),
            { "Content-Length": "3", ETag: '"' + sha + '"' },
            /超过/,
          ],
        ] as const) {
          globalThis.fetch = async () => new Response(body, { headers });
          await assert.rejects(
            m.attachmentArchiveOriginal(
              id,
              item(),
              { csrf: "fixture", current: () => true },
              signal,
            ),
            pattern,
          );
        }
      },
    );
    await t.test(
      "identity switch while reading and actual 403 retract access rather than returning a blob",
      async () => {
        m.bindApiSession("fixture");
        globalThis.fetch = async () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                m.bindApiSession("changed");
                controller.enqueue(new Uint8Array([1, 2, 3]));
                controller.close();
              },
            }),
            { headers: { "Content-Length": "3", ETag: '"' + sha + '"' } },
          );
        await assert.rejects(
          m.attachmentArchiveOriginal(
            id,
            item(),
            { csrf: "fixture", current: () => true },
            signal,
          ),
          /身份/,
        );
        m.bindApiSession("fixture");
        globalThis.fetch = async () => new Response("", { status: 403 });
        await assert.rejects(
          m.attachmentArchiveOriginal(
            id,
            item(),
            { csrf: "fixture", current: () => true },
            signal,
          ),
          (err: any) => err.status === 403,
        );
      },
    );
  } finally {
    globalThis.fetch = prior;
    await rm(dir, { recursive: true, force: true });
  }
});
