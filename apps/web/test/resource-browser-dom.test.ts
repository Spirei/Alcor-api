import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";

test("resource rows keep original names, private downloads and distinct folder/file actions", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await mkdir(join(root, ".local"), { recursive: true });
  const dir = await mkdtemp(join(root, ".local/resource-browser-dom-"));
  try {
    const output = join(dir, "ui.cjs");
    await build({
      stdin: {
        contents: 'export {ResourceRows} from "./src/resources";',
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
      logLevel: "silent",
    });
    const { ResourceRows } = createRequire(import.meta.url)(output);
    const html = render(
      React.createElement(ResourceRows, {
        folders: [
          {
            id: "folder",
            name: "原目录",
            category: "components",
            parentId: null,
            revision: 4,
          },
        ],
        items: [
          {
            id: "file",
            name: '中文 "literal%22" e\u0301.txt',
            kind: "document",
            category: "components",
            folderId: null,
            revision: 2,
            sizeBytes: 31,
            sha256: "a".repeat(64),
            createdAt: "2026-11-04T16:00:00Z",
            downloadPath: "/api/resource-library/files/file/content",
          },
        ],
        blocked: false,
        onFolder() {},
        onManage() {},
        onDelete() {},
      }),
    );
    assert.match(html, /中文 &quot;literal%22&quot; e\u0301.txt/);
    assert.match(html, /31 B/);
    assert.match(html, /2026\/11\/5 00:00/);
    assert.match(html, /href="\/api\/resource-library\/files\/file\/content"/);
    assert.match(html, /管理文件夹 原目录/);
    assert.match(html, /删除文件夹 原目录/);
    assert.match(html, /删除文件 中文/);
    assert.doesNotMatch(html, /a{64}|token=|uploads\/|市值|最新价/);
    assert.equal((html.match(/class="resource-row"/g) || []).length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
