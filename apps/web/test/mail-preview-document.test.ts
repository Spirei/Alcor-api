import assert from "node:assert/strict";
import test from "node:test";
import { mailPreviewDocument } from "../src/mail-preview-document.ts";

test("mail preview follows the global theme with a restrictive document policy", () => {
  const source =
    '<!doctype html><HTML lang="zh-CN" class="old"><HEAD><style>p{color:red}</style></HEAD><body><p>示例 {{name}}</p><img src="data:image/png;base64,AA=="></body></HTML>';
  for (const mode of ["light", "dark"] as const) {
    const value = mailPreviewDocument(source, mode)!;
    assert.match(value, new RegExp(`data-theme="${mode}"`));
    assert.match(value, /default-src 'none'/);
    assert.match(value, /img-src data:/);
    assert.match(value, /form-action 'none'; base-uri 'none'/);
    assert.ok(
      value.indexOf("Content-Security-Policy") < value.indexOf("<style>"),
    );
    assert.match(value, /示例 \{\{name\}\}/);
    assert.match(value, /src="data:image\/png;base64,AA=="/);
  }
  assert.equal(mailPreviewDocument("<p>不完整邮件</p>", "light"), null);
  assert.equal(
    mailPreviewDocument("<html><body>缺少文档头</body></html>", "dark"),
    null,
  );
  const withBanner = mailPreviewDocument(
    source,
    "light",
    "https://example.test",
  )!;
  assert.match(
    withBanner,
    /img-src data: https:\/\/example.test\/api\/system-assets\/mail-banner;/,
  );
  assert.doesNotMatch(withBanner, /img-src[^;]*\*|img-src[^;]*https:;/);
  for (const origin of [
    "data:text/html,test",
    "https://example.test/extra",
    'https://example.test"; img-src *',
  ])
    assert.equal(mailPreviewDocument(source, "light", origin), null);
});
