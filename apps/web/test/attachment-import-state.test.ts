import assert from "node:assert/strict";
import test from "node:test";
import {
  clearAttachmentImportRequests,
  readAttachmentImportRequest,
  retainAttachmentImportRequest,
  releaseAttachmentImportRequest,
  captureWindow,
  archiveSummary,
  archivePage,
  attachmentImportPlan,
  attachmentSourceSegment,
  importReceipt,
  archivePhase,
} from "../src/attachment-import-state.ts";
const id = "448fca63-e431-4968-86c0-d701c60046bf",
  other = "558fca63-e431-4968-86c0-d701c60046bf",
  digest = "a".repeat(64);
function storage() {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
function summary() {
  return {
    manifestId: id,
    digest,
    state: "sealed" as const,
    manifest: {
      namespace: "admin_shared" as const,
      sourceAlias: "fixture",
      captureComplete: true,
      entryCount: 1,
      readyCount: 1,
      blockedCount: 0,
      knownFileBytes: 0,
      blockers: [],
    },
    manifestRevision: 1,
    pending: 1,
    applied: 0,
    blocked: 0,
    total: 1,
    targetChangedCount: 0,
    targetImportCompleted: false,
    instanceReenrollmentRequired: false,
  };
}
function plan() {
  return {
    manifestId: id,
    digest,
    expectedRevision: 7,
    manifestRevision: 1,
    maxItems: 32,
    retryBlocked: false,
    items: [
      {
        ordinal: 0,
        path: "empty.bin",
        kind: "file" as const,
        size: 0,
        sha256: digest,
        status: "ready" as const,
        reason: null,
      },
    ],
    preview: "b".repeat(64),
    summary: summary(),
  };
}
test("shared source journal stores only one original UUID, rejects overwriting unknown results, and clears on identity or role change", () => {
  const s = storage();
  s.setItem("alcor.attachment-request:owner", other);
  retainAttachmentImportRequest(s, "admin", id);
  assert.equal(s.getItem("alcor.attachment-source-request:admin"), id);
  assert.throws(
    () => retainAttachmentImportRequest(s, "admin", other),
    /原附件导入/,
  );
  releaseAttachmentImportRequest(s, "admin", other);
  assert.equal(readAttachmentImportRequest(s, "admin"), id);
  assert.equal(readAttachmentImportRequest(s, "other-admin"), null);
  assert.equal(s.getItem("alcor.attachment-source-request:admin"), null);
  assert.equal(s.getItem("alcor.attachment-request:owner"), other);
  retainAttachmentImportRequest(s, "other-admin", other);
  clearAttachmentImportRequests(s);
  assert.equal(s.length, 1);
});
test("migration window cannot become active from missing, unknown, revoked or malformed bounds; elapsed active window expires locally", () => {
  const from = "2026-01-01T00:00:00Z",
    to = "2026-01-02T00:00:00Z",
    inside = Date.parse("2026-01-01T12:00:00Z");
  assert.equal(captureWindow(undefined, inside).state, "unknown");
  for (const state of ["unknown", "revoked", "expired"])
    assert.equal(
      captureWindow({ state, notBefore: from, expiresAt: to }, inside).state,
      state,
    );
  assert.equal(
    captureWindow({ state: "active", notBefore: from, expiresAt: to }, inside)
      .state,
    "active",
  );
  assert.equal(
    captureWindow(
      { state: "active", notBefore: from, expiresAt: to },
      Date.parse(to),
    ).state,
    "expired",
  );
  assert.equal(
    captureWindow(
      { state: "active", notBefore: "2026-01-01T00:00:00", expiresAt: to },
      inside,
    ).state,
    "unavailable",
  );
});
test("partial or empty capture, target drift and restored instance never become whole-manifest completion; known zero stays zero", () => {
  const partial = {
    ...summary(),
    state: "partial" as const,
    manifest: {
      ...summary().manifest,
      captureComplete: false,
      entryCount: 0,
      readyCount: 0,
      blockers: [{ path: "", reason: "source_directory_unreadable" }],
    },
    total: 0,
    pending: 0,
  };
  assert.equal(archivePhase(archiveSummary(partial)), "捕获范围不完整");
  assert.throws(
    () => archiveSummary({ ...partial, targetImportCompleted: true }),
    /完成状态/,
  );
  assert.equal(archiveSummary(summary()).manifest.knownFileBytes, 0);
  const done = {
    ...summary(),
    pending: 0,
    applied: 1,
    targetImportCompleted: true,
  };
  assert.equal(archivePhase(archiveSummary(done)), "本清单已全部应用");
  assert.throws(
    () => archiveSummary({ ...done, targetChangedCount: 1 }),
    /完成状态/,
  );
  assert.throws(
    () => archiveSummary({ ...done, instanceReenrollmentRequired: true }),
    /完成状态/,
  );
  assert.throws(
    () =>
      archiveSummary({
        ...summary(),
        manifest: { ...summary().manifest, knownFileBytes: null },
      }),
    /范围/,
  );
});
test("archived page keeps a real zero-byte file distinct from unknown and rejects another manifest or duplicate ordinal", () => {
  const item = {
    ordinal: 0,
    evidence: {
      path: "empty.bin",
      kind: "file",
      size: 0,
      sha256: digest,
      captureState: "ready",
      reason: null,
    },
    apply_state: null,
    result: null,
  };
  const raw = { ...summary(), items: [item], nextAfter: null };
  assert.equal(archivePage(raw, id).items[0].evidence.size, 0);
  assert.throws(() => archivePage(raw, other), /项目/);
  assert.throws(() => archivePage({ ...raw, items: [item, item] }, id), /项目/);
  assert.throws(() => archivePage({ ...raw, items: [null] }, id), /项目/);
});
test("archived apply proof is independent of source-window availability but strictly bound to manifest, both revisions and exact segment choices", () => {
  const p = plan(),
    s = summary();
  assert.equal(captureWindow({ state: "expired" }).state, "expired");
  assert.deepEqual(attachmentSourceSegment(other, p, s, 32, false), {
    requestId: other,
    expectedRevision: 7,
    manifestRevision: 1,
    preview: p.preview,
    maxItems: 32,
    retryBlocked: false,
  });
  for (const [raw, page, max, retry] of [
    [{ ...p, manifestId: other }, s, 32, false],
    [{ ...p, digest: "c".repeat(64) }, s, 32, false],
    [{ ...p, expectedRevision: 0 }, s, 32, false],
    [p, { ...s, manifestRevision: 2 }, 32, false],
    [p, s, 1, false],
    [p, s, 32, true],
  ] as const)
    assert.throws(() => attachmentImportPlan(raw, page, max, retry), /变化/);
  assert.throws(
    () => attachmentSourceSegment(other, p, s, 33, false),
    /预览|变化/,
  );
  assert.throws(
    () => attachmentSourceSegment(other, null, s, 32, false),
    /预览/,
  );
  assert.deepEqual(
    Object.keys(attachmentSourceSegment(other, p, s, 32, false)).sort(),
    [
      "expectedRevision",
      "manifestRevision",
      "maxItems",
      "preview",
      "requestId",
      "retryBlocked",
    ],
  );
});
test("original receipt accepts explicit canceled tombstone and partial capture, never labels capture or failed zero as application completion", () => {
  const receipt = {
    requestId: other,
    namespace: "admin_shared",
    kind: "capture",
    state: "completed",
    revision: 7,
    httpStatus: 200,
    message: "ok",
    manifestId: id,
    captureState: "partial",
    targetImportCompleted: false,
  };
  assert.equal(importReceipt(receipt, other).captureState, "partial");
  assert.throws(
    () => importReceipt({ ...receipt, targetImportCompleted: true }, other),
    /捕获/,
  );
  assert.throws(() => importReceipt(receipt, id), /不符/);
  assert.equal(
    importReceipt(
      { ...receipt, state: "failed", httpStatus: 409, canceled: true },
      other,
    ).canceled,
    true,
  );
  assert.throws(
    () =>
      importReceipt(
        {
          ...receipt,
          state: "failed",
          httpStatus: 409,
          targetImportCompleted: true,
        },
        other,
      ),
    /失败/,
  );
  const completed = {
    ...summary(),
    pending: 0,
    applied: 1,
    targetImportCompleted: true,
  };
  assert.equal(
    importReceipt(
      {
        ...receipt,
        kind: "segment",
        summary: completed,
        targetImportCompleted: true,
      },
      other,
    ).targetImportCompleted,
    true,
  );
  assert.throws(
    () =>
      importReceipt({ ...receipt, kind: "segment", summary: completed }, other),
    /范围/,
  );
});
