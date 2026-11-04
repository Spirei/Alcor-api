import assert from "node:assert/strict";
import test from "node:test";
import {
  artworkRequest,
  siteArtworkFields,
  siteArtworkUrl,
} from "../src/site-artwork-state.ts";
test("site artwork recovery binds one original request to an explicit field", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(artworkRequest(null), null);
  for (const { field } of siteArtworkFields)
    assert.deepEqual(artworkRequest(JSON.stringify({ id, field })), {
      id,
      field,
    });
  for (const raw of [
    "{}",
    "null",
    '{"id":"bad","field":"ico"}',
    JSON.stringify({ id, field: "password" }),
    JSON.stringify({ id, field: "ico", url: "https://untrusted.invalid" }),
  ])
    assert.throws(() => artworkRequest(raw));
});
test("site preview uses only versioned images from their matching public directory", () => {
  const asset = {
    id: "version",
    kind: "ico",
    public_path: "/uploads/ico/example.svg",
    served_sha256: "a".repeat(64),
  };
  assert.equal(
    siteArtworkUrl(asset),
    asset.public_path + "?sha256=" + asset.served_sha256,
  );
  for (const patch of [
    { public_path: "https://untrusted.invalid/a.png" },
    { public_path: "/uploads/ico/../login/a.png" },
    { public_path: "//untrusted.invalid/a.svg" },
    { public_path: "/uploads/logo/a.svg" },
    { served_sha256: "bad" },
    { kind: "avatar" },
    { public_path: "/uploads/ico/a.svg?token=private" },
  ])
    assert.equal(siteArtworkUrl({ ...asset, ...patch }), undefined);
});
