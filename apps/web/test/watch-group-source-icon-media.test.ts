import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
test("private source original validates bounded bytes and session then downloads octet-stream, never an image URL", async (t) => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await mkdir(join(root, ".local"), { recursive: true });
  const area = await mkdtemp(join(root, ".local/source-original-")),
    before = globalThis.fetch;
  try {
    const out = join(area, "original.cjs");
    await build({
      stdin: {
        contents:
          'export {sourceIconOriginal} from "./src/watch-group-source-icon-media";export {bindApiSession} from "./src/api-session";',
        resolveDir: fileURLToPath(new URL("../", import.meta.url)),
        loader: "ts",
      },
      outfile: out,
      bundle: true,
      platform: "node",
      format: "cjs",
      define: {
        "import.meta.env.VITE_UI_PERF": '"0"',
        "import.meta.env.VITE_UI_DELAY_MS": '""',
      },
      logLevel: "silent",
    });
    const m = createRequire(import.meta.url)(out),
      id = "448fca63-e431-4968-86c0-d701c60046bf",
      bytes = new TextEncoder().encode(
        "<svg><script>doNotDisplay()</script></svg>",
      ),
      sha = createHash("sha256").update(bytes).digest("hex"),
      capture = {
        requestId: id,
        manifestId: "558fca63-e431-4968-86c0-d701c60046bf",
        originalGroupId: "old-custom",
        kind: "capture",
        domain: "source_icon",
        state: "completed",
        captureState: "captured",
        rawSha256: sha,
        sourceRowSha256: sha,
        originalSha256: sha,
        originalSize: bytes.length,
        originalPath:
          "/api/watch-group-import/operations/" + id + "/icon-original",
        sourceReference:
          "/uploads/asset/group/synthetic/old-custom/original.svg",
        sourceReferenceKnown: true,
        displayValidated: false,
        financialApplied: false,
      };
    const headers = {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": "attachment",
      "Content-Length": String(bytes.length),
      ETag: '"' + sha + '"',
    };
    await t.test(
      "original exact bytes remain attachment even if unsafe to display",
      async () => {
        m.bindApiSession("csrf");
        let count = 0;
        globalThis.fetch = async (url, options) => {
          count++;
          assert.equal(url, capture.originalPath);
          assert.equal(options?.credentials, "same-origin");
          return new Response(bytes, { headers });
        };
        const blob = await m.sourceIconOriginal(
          capture,
          { csrf: "csrf", current: () => true },
          new AbortController().signal,
        );
        assert.equal(count, 1);
        assert.equal(blob.type, "application/octet-stream");
        assert.deepEqual(
          Buffer.from(await blob.arrayBuffer()),
          Buffer.from(bytes),
        );
      },
    );
    await t.test(
      "claimed SHA cannot conceal changed body, wrong headers or truncation",
      async () => {
        for (const response of [
          new Response(bytes.slice(1), { headers }),
          new Response(new Uint8Array(bytes.length), { headers }),
          new Response(bytes, {
            headers: { ...headers, "Content-Type": "image/svg+xml" },
          }),
          new Response(bytes, {
            headers: { ...headers, "Content-Disposition": "inline" },
          }),
        ]) {
          m.bindApiSession("csrf");
          globalThis.fetch = async () => response;
          await assert.rejects(
            m.sourceIconOriginal(
              capture,
              { csrf: "csrf", current: () => true },
              new AbortController().signal,
            ),
          );
        }
      },
    );
    await t.test(
      "identity change and forged external original paths never yield data",
      async () => {
        m.bindApiSession("csrf");
        let calls = 0;
        globalThis.fetch = async () => {
          calls++;
          m.bindApiSession("other");
          return new Response(bytes, { headers });
        };
        await assert.rejects(
          m.sourceIconOriginal(
            capture,
            { csrf: "csrf", current: () => true },
            new AbortController().signal,
          ),
          /身份/,
        );
        assert.equal(calls, 1);
        await assert.rejects(
          m.sourceIconOriginal(
            {
              ...capture,
              originalPath: "https://unapproved.example.invalid/x",
            },
            { csrf: "csrf", current: () => true },
            new AbortController().signal,
          ),
        );
        assert.equal(calls, 1);
      },
    );
  } finally {
    globalThis.fetch = before;
    await rm(area, { recursive: true, force: true });
  }
});
