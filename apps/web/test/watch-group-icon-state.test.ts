import assert from "node:assert/strict";
import test from "node:test";
import {
  clearIconRequests,
  readIconRequest,
  retainIconRequest,
  releaseIconRequest,
  groupIcon,
  iconCurrent,
  iconReceipt,
} from "../src/watch-group-icon-state.ts";
const id = "448fca63-e431-4968-86c0-d701c60046bf",
  other = "558fca63-e431-4968-86c0-d701c60046bf",
  gid = "wg-synthetic";
const media = {
  version: id,
  groupId: gid,
  url:
    "/uploads/asset/group/u-synthetic/" +
    gid +
    "/sample.svg?sha256=" +
    "a".repeat(64),
  contentPath: "/api/watch-groups/" + gid + "/icons/" + id + "/content",
  originalPath: "/api/watch-groups/" + gid + "/icons/" + id + "/original",
  sha256: "a".repeat(64),
  originalSha256: "b".repeat(64),
  size: 10,
  originalSize: 20,
  mediaType: "image/svg+xml",
};
function storage() {
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
    values: () => [...m.values()],
  };
}
test("icon journal retains only original UUID, unknown cannot be overwritten and identity switch clears it", () => {
  const s = storage();
  retainIconRequest(s, "same-owner", id);
  assert.deepEqual(s.values(), [id]);
  assert.throws(() => retainIconRequest(s, "same-owner", other), /先核对/);
  releaseIconRequest(s, "same-owner", other);
  assert.equal(readIconRequest(s, "same-owner"), id);
  assert.equal(readIconRequest(s, "different-owner"), null);
  retainIconRequest(s, "different-owner", other);
  clearIconRequests(s);
  assert.equal(s.length, 0);
});
test("only owner-group version paths with original/served evidence become downloadable or previewable", () => {
  assert.deepEqual(groupIcon(media), media);
  for (const patch of [
    { originalPath: "https://external.example.invalid/raw" },
    { groupId: "another-group" },
    { url: media.url.replace(gid, "another-group") },
    { originalSize: 2097153 },
    { size: 2162689 },
    { mediaType: "image/png" },
    { sha256: media.originalSha256 },
  ])
    assert.throws(() => groupIcon({ ...media, ...patch }), /图标/);
});
test("unmapped source remains unknown without a guessed image while mapped metadata must match the actual group", () => {
  const base = {
    revision: 7,
    group: { id: gid, icon: media.url },
    maxBytes: 2097152,
    extensions: ["jpg", "jpeg", "png", "gif", "webp", "svg"],
  };
  assert.equal(
    iconCurrent({ ...base, icon: media, sourceState: "mapped" }, gid).icon
      ?.version,
    id,
  );
  const unknown = iconCurrent(
    {
      ...base,
      group: { id: gid, icon: "https://unmapped.example.invalid/no-fetch.png" },
      icon: null,
      sourceState: "unmapped",
    },
    gid,
  );
  assert.equal(unknown.icon, null);
  assert.throws(
    () => iconCurrent({ ...base, icon: null, sourceState: "mapped" }, gid),
    /状态/,
  );
  assert.throws(
    () =>
      iconCurrent(
        { ...base, icon: media, sourceState: "mapped" },
        "other-group",
      ),
    /状态/,
  );
});
test("failed original icon receipt is terminal without inventing a version; ordinary empty-icon receipt is only evidence of empty field", () => {
  const failed = {
    requestId: id,
    revision: 7,
    state: "failed",
    httpStatus: 409,
    message: "分组已变化",
  };
  assert.equal(iconReceipt(failed, id).state, "failed");
  assert.equal(
    iconReceipt(
      { requestId: id, revision: 8, group: { id: gid, icon: "" } },
      id,
    ).icon,
    undefined,
  );
  assert.equal(
    iconReceipt(
      {
        requestId: id,
        revision: 8,
        state: "completed",
        httpStatus: 200,
        group: { id: gid, icon: media.url },
        icon: media,
      },
      id,
    ).icon?.version,
    id,
  );
  assert.throws(() => iconReceipt({ ...failed, requestId: other }, id), /回执/);
  assert.throws(
    () =>
      iconReceipt(
        { requestId: id, revision: 7, group: { id: gid, icon: media.url } },
        id,
      ),
    /待核对/,
  );
});
