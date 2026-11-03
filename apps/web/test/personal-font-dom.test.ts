import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("actual appearance/font controls and binary FontFace loader guard current ownership, bytes and hidden/late loads", async (t) => {
  const root = fileURLToPath(new URL("../../../", import.meta.url)),
    tmp = join(root, ".local");
  await mkdir(tmp, { recursive: true });
  const dir = await mkdtemp(join(tmp, "personal-font-dom-")),
    beforeFetch = globalThis.fetch,
    beforeFace = (globalThis as any).FontFace;
  try {
    const output = join(dir, "font.cjs");
    await build({
      stdin: {
        contents:
          'export {AppearancePage} from "./src/appearance";export {defaultAppearance,resolvedColors} from "./src/appearance-preferences";export {personalFontBytes,preparePersonalFont} from "./src/personal-font-media";export {bindApiSession} from "./src/api-session";',
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
      bytes = new Uint8Array(64);
    bytes.set([0, 1, 0, 0]);
    const hash = createHash("sha256").update(bytes).digest("hex"),
      id = "custom-1-" + hash + ".ttf",
      font = {
        id,
        name: "Fixture",
        sha256: hash,
        size: bytes.length,
        mediaType: "font/ttf",
        contentPath: "/api/personal-fonts/" + id + "/content",
        originalPath: "/api/personal-fonts/" + id + "/original",
      },
      signal = new AbortController().signal,
      context = { csrf: "fixture", current: () => true };
    await t.test(
      "one heading, original builtin menu and actual upload/preview/receipt/close controls remain without root or URL editor",
      () => {
        const settings = m.defaultAppearance(),
          appearance = {
            settings,
            palette: settings.shared,
            mode: "light",
            colors: m.resolvedColors(settings.shared, "light"),
            editVersion: { current: 0 },
            update() {},
            updatePalette() {},
            separate() {},
            reset() {},
          };
        const html = renderToStaticMarkup(
          React.createElement(m.AppearancePage, {
            appearance,
            active: true,
            session: {
              instance_id: "fixture",
              user: { id: "fixture", username: "Fixture", role: "user" },
              csrf: "fixture",
              receipt_scope: "scope",
              expires_at: new Date(Date.now() + 3600000).toISOString(),
            },
          }),
        );
        assert.equal((html.match(/<h1>/g) || []).length, 1);
        for (const text of [
          "外观",
          "界面字体",
          "无衬线",
          "衬线",
          "等宽",
          "本人字体",
          "上传字体",
          "预览字体",
          "下载原件",
          "查询字体回执",
        ])
          assert.ok(html.includes(text), text);
        assert.equal((html.match(/type="file"/g) || []).length, 1);
        assert.ok(!html.includes('type="url"'));
        assert.ok(!html.includes('type="password"'));
        assert.ok(!html.includes("全部迁移完成"));
      },
    );
    await t.test(
      "only fixed private original URL/cookie/CSRF is fetched, actual byte SHA checked, FontFace uses ArrayBuffer without blob/data URL",
      async () => {
        m.bindApiSession("fixture");
        let called = 0;
        globalThis.fetch = async (url, init) => {
          assert.equal(String(url), font.originalPath);
          assert.equal(init?.credentials, "same-origin");
          assert.equal(
            new Headers(init?.headers).get("x-csrf-token"),
            "fixture",
          );
          assert.equal(new Headers(init?.headers).get("authorization"), null);
          return new Response(bytes, {
            headers: {
              "Content-Length": String(bytes.length),
              ETag: '"' + hash + '"',
            },
          });
        };
        (globalThis as any).FontFace = class {
          family: string;
          status = "unloaded";
          constructor(family: string, source: any) {
            called++;
            this.family = family;
            assert.ok(source instanceof ArrayBuffer);
            assert.deepEqual(new Uint8Array(source), bytes);
            assert.ok(!family.includes("blob:"));
          }
          async load() {
            this.status = "loaded";
            return this;
          }
        };
        const face = await m.preparePersonalFont(font, context, signal);
        assert.equal(face.status, "loaded");
        assert.equal(called, 1);
        assert.equal(face.family, "alcor-personal-font-" + hash);
      },
    );
    await t.test(
      "wrong content behind matching SHA ETag, wrong length, truncation and overrun all fail before a face is prepared",
      async () => {
        m.bindApiSession("fixture");
        for (const [raw, headers, pattern] of [
          [
            new Uint8Array(bytes.length),
            { "Content-Length": String(bytes.length), ETag: '"' + hash + '"' },
            /类型|摘要/,
          ],
          [bytes, { ETag: '"' + hash + '"' }, /大小/],
          [
            bytes.subarray(0, 63),
            { "Content-Length": "64", ETag: '"' + hash + '"' },
            /不完整/,
          ],
          [
            new Uint8Array(65),
            { "Content-Length": "64", ETag: '"' + hash + '"' },
            /超过/,
          ],
        ] as const) {
          globalThis.fetch = async () => new Response(raw, { headers });
          await assert.rejects(
            m.personalFontBytes(font, context, signal),
            pattern,
          );
        }
        const corrupt = bytes.slice();
        corrupt[63] = 1;
        globalThis.fetch = async () =>
          new Response(corrupt, {
            headers: { "Content-Length": "64", ETag: '"' + hash + '"' },
          });
        await assert.rejects(
          m.personalFontBytes(font, context, signal),
          /内容摘要/,
        );
      },
    );
    await t.test(
      "unknown URL, hidden caller and stale displayed session do not initiate a byte read",
      async () => {
        let calls = 0;
        globalThis.fetch = async () => {
          calls++;
          throw Error("must not fetch");
        };
        m.bindApiSession("fixture");
        await assert.rejects(
          m.personalFontBytes(
            {
              ...font,
              originalPath: "https://unapproved.example.invalid/private.ttf",
            },
            context,
            signal,
          ),
        );
        await assert.rejects(
          m.personalFontBytes(
            font,
            { csrf: "fixture", current: () => false },
            signal,
          ),
          /身份/,
        );
        m.bindApiSession("other");
        await assert.rejects(
          m.personalFontBytes(font, context, signal),
          /身份/,
        );
        assert.equal(calls, 0);
      },
    );
    await t.test(
      "a late FontFace load after identity switch or Activity abort never returns an applicable face",
      async () => {
        m.bindApiSession("fixture");
        globalThis.fetch = async () =>
          new Response(bytes, {
            headers: { "Content-Length": "64", ETag: '"' + hash + '"' },
          });
        (globalThis as any).FontFace = class {
          status = "unloaded";
          async load() {
            m.bindApiSession("changed");
            this.status = "loaded";
            return this;
          }
        };
        await assert.rejects(
          m.preparePersonalFont(font, context, signal),
          /尚未|变化|停止/,
        );
        m.bindApiSession("fixture");
        const controller = new AbortController();
        (globalThis as any).FontFace = class {
          status = "unloaded";
          load() {
            queueMicrotask(() => controller.abort());
            return new Promise(() => {});
          }
        };
        await assert.rejects(
          m.preparePersonalFont(font, context, controller.signal),
          /停止/,
        );
      },
    );
    await t.test(
      "server403 remains explicit permission failure; decode rejection never becomes loaded",
      async () => {
        m.bindApiSession("fixture");
        globalThis.fetch = async () => new Response("", { status: 403 });
        await assert.rejects(
          m.personalFontBytes(font, context, signal),
          (error: any) => error.status === 403,
        );
        globalThis.fetch = async () =>
          new Response(bytes, {
            headers: { "Content-Length": "64", ETag: '"' + hash + '"' },
          });
        (globalThis as any).FontFace = class {
          status = "error";
          load() {
            return Promise.reject(Error("synthetic decoder rejected"));
          }
        };
        await assert.rejects(
          m.preparePersonalFont(font, context, signal),
          /decoder rejected/,
        );
      },
    );
    await t.test(
      "binary401 or changed-session headers retire the displayed session before any font can load",
      async () => {
        const previousWindow = (globalThis as any).window;
        const events: string[] = [];
        (globalThis as any).window = {
          dispatchEvent(event: Event) {
            events.push(event.type);
            return true;
          },
        };
        try {
          m.bindApiSession("fixture");
          globalThis.fetch = async () => new Response("", { status: 401 });
          await assert.rejects(
            m.personalFontBytes(font, context, signal),
            (error: any) => error.status === 401,
          );
          assert.ok(events.includes("alcor:session-expired"));
          m.bindApiSession("fixture");
          globalThis.fetch = async () =>
            new Response("", {
              status: 403,
              headers: { "X-Alcor-Session-Changed": "true" },
            });
          await assert.rejects(
            m.personalFontBytes(font, context, signal),
            (error: any) => error.code === "session_changed",
          );
          assert.ok(events.includes("alcor:session-changed"));
          globalThis.fetch = async () => {
            throw Error("must not fetch");
          };
          await assert.rejects(
            m.personalFontBytes(font, context, signal),
            /身份/,
          );
        } finally {
          (globalThis as any).window = previousWindow;
        }
      },
    );
  } finally {
    globalThis.fetch = beforeFetch;
    (globalThis as any).FontFace = beforeFace;
    await rm(dir, { recursive: true, force: true });
  }
});
