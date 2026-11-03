import assert from "node:assert/strict";
import test from "node:test";
import {
  fontSourceListing,
  fontSourceOptions,
  fontCapture,
  fontSourceProof,
  fontSourceReceipt,
  readFontSourceRequest,
  retainFontSourceRequest,
  releaseFontSourceRequest,
  clearFontSourceRequest,
} from "../src/font-source-state.ts";

const id = "6d61c2ca-8c53-4de0-8e89-d26722d61606",
  other = "4c6d11a6-e939-4bcc-a874-59ece08054e9",
  digest = "a".repeat(64),
  fontId = `custom-831-${digest}.ttf`;
const permission = {
  id,
  grantId: other,
  ownerId: "platform-owner",
  sourceAlias: "registered-old",
  sourceOwner: "source-owner",
  sourceInstance: "source-instance",
  originalId: fontId,
  scope: "fonts.migrate",
  state: "pending_owner",
  revision: 1,
  name: null,
  evidenceRef: "Synthetic evidence",
  historicalUploaderVerified: false,
  ownershipEvidence: "admin-and-owner-attested",
};
const capture = {
  id,
  requestId: other,
  permissionId: other,
  permissionRevision: 2,
  sha256: digest,
  size: 872,
  evidenceSha256: digest,
  originalPath: `/api/personal-font-import/captures/${id}/original`,
  historicalUploaderVerified: false,
  entireSourceComplete: false,
};
function store() {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
    key: (i: number) => [...values.keys()][i] ?? null,
    get length() {
      return values.size;
    },
    values,
  };
}
test("source journal keeps only original UUID, blocks replacement and clears other session scopes", () => {
  const s = store();
  s.setItem("other-app", "keep");
  retainFontSourceRequest(s, "owner-session", id);
  assert.equal(s.values.get("alcor.font-source-request:owner-session"), id);
  assert.throws(
    () => retainFontSourceRequest(s, "owner-session", other),
    /核对原/,
  );
  releaseFontSourceRequest(s, "owner-session", other);
  assert.equal(readFontSourceRequest(s, "owner-session"), id);
  assert.equal(readFontSourceRequest(s, "other-owner"), null);
  retainFontSourceRequest(s, "other-owner", other);
  clearFontSourceRequest(s);
  assert.deepEqual([...s.values], [["other-app", "keep"]]);
});
test("permission never upgrades legacy UID prefix to proof or full-source completion", () => {
  const rows = {
    items: [permission],
    captures: [],
    entireSourceComplete: false,
    limit: 100,
  };
  assert.equal(fontSourceListing(rows).items[0].originalId, fontId);
  for (const change of [
    { historicalUploaderVerified: true },
    { scope: "financial.migrate" },
    { ownershipEvidence: "uid-prefix" },
    { ownerId: null },
    { originalId: "../../private-font.ttf" },
  ])
    assert.throws(() =>
      fontSourceListing({ ...rows, items: [{ ...permission, ...change }] }),
    );
  assert.throws(() =>
    fontSourceListing({ ...rows, entireSourceComplete: true }),
  );
  assert.throws(() =>
    fontSourceListing({ ...rows, items: [permission, permission] }),
  );
  assert.throws(() => fontSourceListing({ ...rows, items: null }));
});
test("archived raw path, size and hash are exact and never remote", () => {
  assert.equal(fontCapture(capture), capture);
  for (const change of [
    { originalPath: "https://not-approved.example.invalid/font.ttf" },
    { size: 0 },
    { size: 10485761 },
    { sha256: "unknown" },
    { historicalUploaderVerified: true },
    { entireSourceComplete: true },
  ])
    assert.throws(() => fontCapture({ ...capture, ...change }));
});
test("preview binds exact original evidence and target CAS rather than receipt display", () => {
  const p = {
    plan: {
      captureId: id,
      permissionId: other,
      permissionRevision: 2,
      expectedRevision: 0,
      sha256: digest,
      size: 872,
      name: "Explicit name",
      originalId: fontId,
      evidenceSha256: digest,
      action: "import",
      targetId: null,
      historicalUploaderVerified: false,
      entireSourceComplete: false,
    },
    preview: digest,
  };
  assert.equal(fontSourceProof(p, capture), p);
  for (const change of [
    { permissionRevision: 1 },
    { captureId: other },
    { sha256: "b".repeat(64) },
    { size: 0 },
    { expectedRevision: null },
    { action: "already_mapped" },
    { historicalUploaderVerified: true },
    { entireSourceComplete: true },
  ])
    assert.throws(() =>
      fontSourceProof({ ...p, plan: { ...p.plan, ...change } }, capture),
    );
});
test("completed capture needs immutable proof; pending and closed operations are not completed files", () => {
  assert.equal(
    fontSourceReceipt({ requestId: id, kind: "capture", state: "reading" }, id)
      .state,
    "reading",
  );
  assert.equal(
    fontSourceReceipt(
      { requestId: id, kind: "capture", state: "failed", canceled: true },
      id,
    ).state,
    "failed",
  );
  assert.equal(
    fontSourceReceipt(
      { requestId: id, kind: "capture", state: "completed", capture },
      id,
    ).capture,
    capture,
  );
  for (const raw of [
    { requestId: id, kind: "apply", state: "reading" },
    { requestId: other, kind: "capture", state: "completed", capture },
    { requestId: id, kind: "capture", state: "completed" },
    { requestId: id, kind: "apply", state: "completed", font: { id: fontId } },
    {
      requestId: id,
      kind: "capture",
      state: "completed",
      capture,
      canceled: true,
    },
  ])
    assert.throws(() => fontSourceReceipt(raw, id));
});
test("registration options use server grants and preserve missing/expired windows as unavailable", () => {
  const value = {
    items: [
      {
        grantId: id,
        grantRevision: 2,
        ownerId: "platform-owner",
        username: "Synthetic Member",
        sourceAlias: "old-scope",
        sourceOwner: "original-owner",
        window: { state: "expired" },
      },
    ],
  };
  assert.equal(fontSourceOptions(value)[0].window.state, "expired");
  assert.throws(() =>
    fontSourceOptions({ items: [{ ...value.items[0], grantRevision: 0 }] }),
  );
  assert.throws(() =>
    fontSourceOptions({ items: [{ ...value.items[0], window: null }] }),
  );
});
