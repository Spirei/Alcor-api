import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

test("private safe icon data preview fits the unchanged self/data image policy without opening blob or original access", async (t) => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await mkdir(join(root, ".local"), { recursive: true });
  const dir = await mkdtemp(join(root, ".local/icon-preview-")),
    fetchBefore = globalThis.fetch,
    BlobBefore = globalThis.Blob;
  try {
    const output = join(dir, "preview.cjs");
    await build({
      stdin: {
        contents:
          'export {iconDataPreview} from "./src/watch-group-icon-media";export {bindApiSession} from "./src/api-session";',
        resolveDir: fileURLToPath(new URL("../", import.meta.url)),
        loader: "ts",
      },
      outfile: output,
      bundle: true,
      platform: "node",
      format: "cjs",
      define: {
        "import.meta.env.VITE_UI_PERF": '"0"',
        "import.meta.env.VITE_UI_DELAY_MS": '""',
      },
      logLevel: "silent",
    });
    const m = createRequire(import.meta.url)(output),
      id = "448fca63-e431-4968-86c0-d701c60046bf",
      gid = "wg-synthetic",
      sha = (bytes: Uint8Array) =>
        createHash("sha256").update(bytes).digest("hex"),
      raw = new TextEncoder().encode(
        '<?xml version="1.0"?><!-- by TradingView --><svg xmlns="http://www.w3.org/2000/svg"><text>中文</text></svg>',
      ),
      safe = new TextEncoder().encode(
        '<!-- by alcor -->\n<svg xmlns="http://www.w3.org/2000/svg"><text>中文</text></svg>',
      );
    const media = {
      version: id,
      groupId: gid,
      url:
        "/uploads/asset/group/u-synthetic/" +
        gid +
        "/sample.svg?sha256=" +
        sha(safe),
      contentPath: "/api/watch-groups/" + gid + "/icons/" + id + "/content",
      originalPath: "/api/watch-groups/" + gid + "/icons/" + id + "/original",
      sha256: sha(safe),
      originalSha256: sha(raw),
      size: safe.length,
      originalSize: raw.length,
      mediaType: "image/svg+xml",
    };
    await t.test(
      "exact validated served UTF8 bytes become data:image safe preview while raw source never enters it",
      async () => {
        m.bindApiSession("csrf");
        let calls = 0;
        globalThis.fetch = async (url, options) => {
          calls++;
          assert.equal(url, media.contentPath);
          assert.equal(options.credentials, "same-origin");
          assert.equal(
            new Headers(options.headers).get("X-CSRF-Token"),
            "csrf",
          );
          return new Response(safe, {
            headers: {
              "Content-Length": String(safe.length),
              ETag: '"' + sha(safe) + '"',
            },
          });
        };
        const value = await m.iconDataPreview(
          media,
          { csrf: "csrf", current: () => true },
          new AbortController().signal,
        );
        assert.equal(calls, 1);
        assert.ok(value.startsWith("data:image/svg+xml;base64,"));
        assert.ok(!value.startsWith("blob:"));
        assert.deepEqual(
          Buffer.from(value.split(",")[1], "base64"),
          Buffer.from(safe),
        );
        assert.ok(
          !Buffer.from(value.split(",")[1], "base64").includes(
            Buffer.from("TradingView"),
          ),
        );
      },
    );
    await t.test(
      "wrong original SHA ETag, missing length or truncation never becomes an allowed data image",
      async () => {
        for (const response of [
          new Response(raw, {
            headers: {
              "Content-Length": String(raw.length),
              ETag: '"' + sha(raw) + '"',
            },
          }),
          new Response(safe, { headers: { ETag: '"' + sha(safe) + '"' } }),
          new Response(safe.slice(1), {
            headers: {
              "Content-Length": String(safe.length),
              ETag: '"' + sha(safe) + '"',
            },
          }),
        ]) {
          m.bindApiSession("csrf");
          globalThis.fetch = async () => response;
          await assert.rejects(
            m.iconDataPreview(
              media,
              { csrf: "csrf", current: () => true },
              new AbortController().signal,
            ),
          );
        }
      },
    );
    await t.test(
      "session replacement during the additional data conversion await cannot resurrect hidden private pixels",
      async () => {
        m.bindApiSession("csrf");
        globalThis.fetch = async () =>
          new Response(safe, {
            headers: {
              "Content-Length": String(safe.length),
              ETag: '"' + sha(safe) + '"',
            },
          });
        globalThis.Blob = class extends BlobBefore {
          override arrayBuffer() {
            m.bindApiSession("other");
            return super.arrayBuffer();
          }
        };
        await assert.rejects(
          m.iconDataPreview(
            media,
            { csrf: "csrf", current: () => true },
            new AbortController().signal,
          ),
          /状态|身份/,
        );
        globalThis.Blob = BlobBefore;
        m.bindApiSession("csrf");
        await assert.rejects(
          m.iconDataPreview(
            media,
            { csrf: "csrf", current: () => false },
            new AbortController().signal,
          ),
          /身份/,
        );
      },
    );
  } finally {
    globalThis.fetch = fetchBefore;
    globalThis.Blob = BlobBefore;
    await rm(dir, { recursive: true, force: true });
  }
});
