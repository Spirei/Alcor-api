import assert from "node:assert/strict";
import test from "node:test";
import {
  readLegacyImportRequest,
  retainLegacyImportRequest,
} from "../src/legacy-import-state.ts";
import {
  clearResourceImportRequests,
  readResourceImportRequest,
  retainResourceImportRequest,
  releaseResourceImportRequest,
  resourceImportPhase,
  resourceSegment,
} from "../src/resource-import-state.ts";
function storage() {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (n: number) => [...map.keys()][n] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}
const id = "448fca63-e431-4968-86c0-d701c60046bf",
  next = "558fca63-e431-4968-86c0-d701c60046bf",
  proof = { manifestId: id, revision: 2, preview: "a".repeat(64) };
test("financial and resource journals keep separate original UUIDs and never persist passwords, body or preview", () => {
  const s = storage();
  retainLegacyImportRequest(s, "owner", id);
  retainResourceImportRequest(s, "owner", next);
  assert.equal(readLegacyImportRequest(s, "owner"), id);
  assert.equal(readResourceImportRequest(s, "owner"), next);
  assert.equal(s.getItem("alcor.resource-import-request:owner"), next);
  assert.throws(() => retainResourceImportRequest(s, "owner", id), /原操作/);
  releaseResourceImportRequest(s, "owner", id);
  assert.equal(readResourceImportRequest(s, "owner"), next);
  clearResourceImportRequests(s);
  assert.equal(readLegacyImportRequest(s, "owner"), id);
});
test("failed or still-capturing empty indexes never mean completion; only a sealed applied manifest can complete", () => {
  assert.equal(resourceImportPhase("failed", true, 0), "来源捕获失败");
  assert.equal(resourceImportPhase("capturing", true, 0), "来源捕获未确认");
  assert.equal(resourceImportPhase("sealed", true, 0), "本清单已全部应用");
  assert.equal(resourceImportPhase("sealed", false, 3), "本清单尚余 3 条");
  assert.equal(
    resourceImportPhase("sealed", false, undefined),
    "本清单应用结果待核对",
  );
});
test("a segment uses the same UUID, manifest, revision, CAS and exact retry choice; another context cannot borrow proof", () => {
  assert.deepEqual(resourceSegment(next, id, 2, proof, 1, true), {
    requestId: next,
    revision: 2,
    preview: proof.preview,
    maxItems: 1,
    retryBlocked: true,
  });
  assert.throws(
    () => resourceSegment(next, next, 2, proof, 1, false),
    /重新预览/,
  );
  assert.throws(
    () => resourceSegment(next, id, 3, proof, 1, false),
    /重新预览/,
  );
  assert.throws(() => resourceSegment(next, id, 2, null, 1, false), /重新预览/);
  assert.throws(
    () => resourceSegment(next, id, 2, proof, 33, false),
    /重新预览/,
  );
});
