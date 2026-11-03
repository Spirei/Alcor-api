import assert from "node:assert/strict";
import test from "node:test";
import {
  clearSourceRequests,
  readSourceRequest,
  retainSourceRequest,
  releaseSourceRequest,
  sourceCanCapture,
  sourceGrants,
  sourceManifest,
  sourceOutcomes,
  sourceProof,
  sourceReceipt,
  sourceReceiptLabel,
} from "../src/watch-group-source-state.ts";
const id = "448fca63-e431-4968-86c0-d701c60046bf",
  other = "558fca63-e431-4968-86c0-d701c60046bf",
  hash = "a".repeat(64),
  owner = "synthetic-owner",
  instance = "synthetic-instance";
const grant = {
  id,
  source_alias: "controlled",
  source_owner: "old-owner",
  source_instance: "old-instance",
  revision: 2,
  state: "active",
  effectiveState: "active",
  platform_instance: instance,
  migrationWindow: {
    state: "active",
    notBefore: "2026-01-01T00:00:00Z",
    expiresAt: "2026-01-02T00:00:00Z",
  },
};
const row = {
  originalId: "old-group",
  sequence: 0,
  rowSha256: hash,
  blocker: "canonical_name_collision",
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
    all: () => [...m.values()],
  };
}
test("source journal stores only UUID/kind/status and never replays body or overwrites unknown operation", () => {
  const s = storage();
  retainSourceRequest(s, "owner", {
    id,
    kind: "capture",
    password: "must-not-persist",
    preview: hash,
  } as never);
  assert.deepEqual(JSON.parse(s.all()[0]), { id, kind: "capture" });
  assert.throws(
    () => retainSourceRequest(s, "owner", { id: other, kind: "apply" }),
    /核对/,
  );
  releaseSourceRequest(s, "owner", other);
  assert.equal(readSourceRequest(s, "owner")?.id, id);
  retainSourceRequest(s, "owner", {
    id,
    kind: "capture",
    submissionStatus: 409,
  });
  assert.equal(readSourceRequest(s, "owner")?.submissionStatus, 409);
  assert.equal(readSourceRequest(s, "another-owner"), null);
  retainSourceRequest(s, "another-owner", { id: other, kind: "grant" });
  releaseSourceRequest(s, "owner", id);
  assert.equal(readSourceRequest(s, "another-owner")?.id, other);
  clearSourceRequests(s);
  assert.equal(s.length, 0);
});
test("active source capture is bounded by current instance and exact declared time; archived manifests retain independent PG consent", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  assert.equal(sourceCanCapture(grant, instance, now), true);
  for (const value of [
    { ...grant, state: "revoked" },
    { ...grant, effectiveState: "source_registry_unavailable_or_changed" },
    { ...grant, platform_instance: "other" },
    {
      ...grant,
      migrationWindow: { ...grant.migrationWindow, state: "unknown" },
    },
    {
      ...grant,
      migrationWindow: {
        ...grant.migrationWindow,
        expiresAt: "2026-01-01T12:00:00Z",
      },
    },
  ])
    assert.equal(sourceCanCapture(value, instance, now), false);
  assert.deepEqual(
    sourceGrants({ targetUserId: owner, items: [grant] }, owner),
    [grant],
  );
  assert.throws(
    () => sourceGrants({ targetUserId: "foreign", items: [grant] }, owner),
    /账号/,
  );
  const manifest = {
    id,
    rawSha256: hash,
    publishedAt: "2026-11-01T00:00:00Z",
    source: { owner: "old-owner", instance: "old-instance" },
    groups: [row],
    members: [],
    counts: { watch_groups: 1, records: 0 },
    next: null,
    metadataCapturedComplete: true,
    membershipMappingComplete: false,
    currentSourceAccess: {
      grantState: "active",
      grantRevisionMatches: true,
      window: { state: "expired" },
    },
  };
  assert.deepEqual(sourceManifest(manifest, id), manifest);
  assert.throws(() => sourceManifest({ ...manifest, counts: {} }, id), /清单/);
});
test("unknown rows and real zero counts stay distinct; incomplete or mismatched receipts cannot release an original UUID", () => {
  const proof = {
    manifestId: id,
    rawSha256: hash,
    preview: hash,
    ready: true,
    groupRevision: 0,
    recordRevision: 0,
    groups: [row],
    members: [],
    memberCount: 0,
    membersTruncated: false,
    unknownGroups: 1,
    unknownMembers: 0,
    iconPending: 0,
    orderingUnknown: 0,
    metadataTimeUnknown: 0,
    financialApplied: false,
    financialHeadAdvanced: false,
  };
  assert.deepEqual(sourceProof(proof, id).groups, [row]);
  assert.equal(sourceProof(proof, id).unknownMembers, 0);
  assert.throws(
    () => sourceProof({ ...proof, unknownMembers: undefined }, id),
    /预览/,
  );
  assert.throws(
    () => sourceProof({ ...proof, financialApplied: true }, id),
    /预览/,
  );
  assert.throws(
    () =>
      sourceReceipt(
        {
          requestId: id,
          state: "completed",
          kind: "capture",
          financialApplied: false,
        },
        id,
        "capture",
      ),
    /清单/,
  );
  assert.throws(
    () =>
      sourceReceipt(
        {
          requestId: other,
          state: "reading",
          kind: "capture",
          financialApplied: false,
        },
        id,
        "capture",
      ),
    /回执/,
  );
  assert.equal(
    sourceReceiptLabel(
      sourceReceipt(
        {
          requestId: id,
          state: "unknown",
          kind: "capture",
          financialApplied: false,
        },
        id,
        "capture",
      ),
    ),
    "结果未知，读取已关闭",
  );
});

test("persisted unknown member outcome never claims cleared or applied membership", () => {
  const outcome = sourceOutcomes(
    {
      requestId: id,
      items: [
        {
          sequence: 0,
          source_row_sha256: hash,
          original_record_id: "old-record",
          original_group_id: "old-group",
          target_record_id: null,
          target_group_id: null,
          state: "unknown",
          reason: "original_record_binding_missing_or_deleted",
        },
      ],
      next: null,
    },
    id,
  );
  assert.deepEqual(
    outcome.items.map((v) => [
      v.originalId,
      v.state,
      v.targetRecordId,
      v.targetGroupId,
    ]),
    [["old-record", "unknown", null, null]],
  );
  assert.equal(outcome.next, null);
  assert.throws(
    () => sourceOutcomes({ requestId: other, items: [], next: null }, id),
    /归属/,
  );
});
