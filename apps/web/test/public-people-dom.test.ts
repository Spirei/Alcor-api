import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";

test("public original cards retain licensed text without private actions or automatic remote media", async (t) => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  await mkdir(join(root, ".local"), { recursive: true });
  const dir = await mkdtemp(join(root, ".local/public-people-dom-"));
  try {
    const output = join(dir, "ui.cjs");
    await build({
      stdin: {
        contents:
          'export {PublicOriginalPost} from "./src/public-people-feed";',
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
    const { PublicOriginalPost } = createRequire(import.meta.url)(output);
    const post = {
      id: "synthetic",
      author: "duan",
      date: "2026-11-04T16:00:00Z",
      text: "Original source text",
      textZh: "合成译文<script>unsafe()</script>",
      originalUrl: "https://example.com/original",
      images: ["https://example.com/image.png"],
      media: [
        { type: "image", url: "https://example.com/image.png" },
        { type: "video", url: "https://example.com/video.mp4" },
      ],
      quote: {
        name: "合成引用",
        text: "quoted original",
        url: "javascript:alert(1)",
      },
      comments: [
        {
          id: "c",
          name: "<source>",
          text: "observed comment",
          createdAt: "2026-11-04T16:00:00Z",
          likes: 0,
        },
      ],
      sourceEvidence: {
        sourceRevision: "private-source-revision",
        pageId: "private-page-id",
        licenseRevision: "current-license",
      },
    };
    await t.test(
      "default translation is escaped, original toggle is direct and source identifiers are deferred",
      () => {
        const html = render(React.createElement(PublicOriginalPost, { post }));
        assert.match(html, /合成译文&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
        assert.match(html, /查看原文/);
        assert.match(html, /2026\/11\/5 00:00/);
        assert.doesNotMatch(
          html,
          /Original source text|private-page-id|private-source-revision|<script>|javascript:/,
        );
        assert.doesNotMatch(html, /喜欢|保存本人|对此帖的讨论内容/);
      },
    );
    await t.test(
      "media remains explicit, duplicate URLs appear once and no remote image or player loads",
      () => {
        const html = render(React.createElement(PublicOriginalPost, { post }));
        assert.equal(
          (html.match(/href="https:\/\/example.com\/image.png"/g) || []).length,
          1,
        );
        assert.match(html, /查看原视频/);
        assert.match(html, /noopener/);
        assert.doesNotMatch(html, /<img|<video|<iframe/);
      },
    );
    await t.test(
      "missing translation, invalid links, unknown time and zero comment likes remain distinct",
      () => {
        const html = render(
          React.createElement(PublicOriginalPost, {
            post: {
              ...post,
              date: null,
              textZh: undefined,
              originalUrl: "https://user:secret@example.com/private",
              images: [],
              media: [],
            },
          }),
        );
        assert.match(html, /Original source text/);
        assert.match(html, /时间未知/);
        assert.match(html, /来源观察赞数 0/);
        assert.match(html, /&lt;source&gt;/);
        assert.doesNotMatch(html, /查看原文|secret|译文暂不可用/);
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
