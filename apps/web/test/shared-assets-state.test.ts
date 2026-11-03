import assert from "node:assert/strict";
import test from "node:test";
import {
  clearSharedAssetRequests,
  readSharedAssetRequest,
  retainSharedAssetRequest,
  releaseSharedAssetRequest,
  sharedAssetReceipt,
  sharedAssetConfig,
} from "../src/shared-assets-state.ts";
const id = "448fca63-e431-4968-86c0-d701c60046bf",
  next = "558fca63-e431-4968-86c0-d701c60046bf",
  version = "668fca63-e431-4968-86c0-d701c60046bf",
  sha = "a".repeat(64),
  source = "b".repeat(64);
function store() {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
}
function receipt() {
  const legacyUrl = "/uploads/asset/icon/source.svg";
  return {
    requestId: id,
    namespace: "system_public",
    state: "completed",
    revision: 1,
    httpStatus: 200,
    message: "ok",
    kind: "asset",
    url: legacyUrl + "?sha256=" + sha,
    legacyUrl,
    version,
    sha256: sha,
    originalSha256: source,
    size: 19,
    originalSize: 23,
  };
}
test("shared image journal retains UUID only and unknown operation cannot be replaced", () => {
  const s = store();
  retainSharedAssetRequest(s, "scope", id);
  assert.equal(s.getItem("alcor.shared-asset-request:scope"), id);
  assert.throws(() => retainSharedAssetRequest(s, "scope", next));
  releaseSharedAssetRequest(s, "scope", next);
  assert.equal(readSharedAssetRequest(s, "scope"), id);
  releaseSharedAssetRequest(s, "scope", id);
  assert.equal(readSharedAssetRequest(s, "scope"), null);
});
test("role or instance scope change clears only this journal and late completion cannot clear the next identity", () => {
  const s = store();
  s.setItem("alcor.resource-request:scope", id);
  s.setItem("appearance", "dark");
  retainSharedAssetRequest(s, "old", id);
  assert.equal(readSharedAssetRequest(s, "new"), null);
  retainSharedAssetRequest(s, "new", next);
  releaseSharedAssetRequest(s, "old", id);
  assert.equal(readSharedAssetRequest(s, "new"), next);
  clearSharedAssetRequests(s);
  assert.equal(s.length, 2);
});
test("malformed journal cannot become an arbitrary server locator", () => {
  const s = store();
  s.setItem(
    "alcor.shared-asset-request:scope",
    "https://example.invalid/private",
  );
  assert.throws(() => readSharedAssetRequest(s, "scope"));
  assert.throws(() => retainSharedAssetRequest(s, "scope", id));
  assert.equal(
    s.getItem("alcor.shared-asset-request:scope"),
    "https://example.invalid/private",
  );
});
test("completed shared image receipt must bind same UUID public namespace exact SHA URL and independent raw original", () => {
  const good = receipt();
  assert.deepEqual(sharedAssetReceipt(good, id), good);
  for (const bad of [
    { ...good, requestId: next },
    { ...good, namespace: "personal" },
    { ...good, state: "pending" },
    { ...good, url: good.legacyUrl },
    { ...good, url: "https://example.invalid/public.svg" },
    { ...good, legacyUrl: "/uploads/avatar/private.svg" },
    { ...good, version: "../../private" },
    { ...good, originalSha256: sha, originalSize: 24 },
    { ...good, kind: "avatar" },
  ])
    assert.throws(() => sharedAssetReceipt(bad, id));
});
test("failed original operation is terminal without inventing a preview or download URL", () => {
  const bad = {
    requestId: id,
    namespace: "system_public",
    state: "failed",
    revision: 0,
    httpStatus: 503,
    message: "not durable",
  };
  assert.deepEqual(sharedAssetReceipt(bad, id), bad);
  assert.throws(() => sharedAssetReceipt({ ...bad, httpStatus: 200 }, id));
});
test("actual configured formats and card allowance remain distinct while absent or wrong authority is unknown", () => {
  const config = {
    namespace: "system_public",
    revision: 0,
    kinds: {
      ico: { extensions: ["png", "ico", "svg"], maxBytes: 1048576 },
      background: { extensions: ["png"], maxBytes: 10485760 },
      login: { extensions: ["png"], maxBytes: 10485760 },
      logo: { extensions: ["png", "svg"], maxBytes: 2097152 },
      asset: { extensions: ["png", "svg"], maxBytes: 2097152 },
    },
    cardMaxBytes: 20971520,
  };
  assert.deepEqual(sharedAssetConfig(config), config);
  for (const bad of [
    { ...config, namespace: "personal" },
    { ...config, revision: -1 },
    { ...config, kinds: {} },
    { ...config, cardMaxBytes: 0 },
  ])
    assert.throws(() => sharedAssetConfig(bad));
});
