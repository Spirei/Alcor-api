import assert from "node:assert/strict";
import test from "node:test";
import {
  sourceIconReceipt,
  sourceIconProof,
  sourceIconCanCapture,
  sourceIconLabel,
} from "../src/watch-group-source-icon-state.ts";
import { sourceReceipt } from "../src/watch-group-source-state.ts";
const id = "448fca63-e431-4968-86c0-d701c60046bf",
  manifest = "558fca63-e431-4968-86c0-d701c60046bf",
  hash = "a".repeat(64);
export const captured = {
  requestId: id,
  manifestId: manifest,
  originalGroupId: "old-custom",
  kind: "capture",
  domain: "source_icon",
  state: "completed",
  captureState: "captured",
  rawSha256: hash,
  sourceRowSha256: hash,
  originalSha256: hash,
  originalSize: 10,
  originalPath: "/api/watch-group-import/operations/" + id + "/icon-original",
  sourceReference: "https://unapproved.example.invalid/raw.svg",
  sourceReferenceKnown: true,
  displayValidated: false,
  financialApplied: false,
};
test("source icon capture retains unsafe original as a private attachment and blocks forged paths, missing data or success-shaped failures", () => {
  assert.equal(sourceIconReceipt(captured, id).kind, "capture");
  assert.equal(sourceReceipt(captured, id, "capture").domain, "source_icon");
  assert.equal(sourceIconLabel(sourceIconReceipt(captured, id)), "原图已归档");
  for (const bad of [
    { ...captured, originalPath: captured.sourceReference },
    { ...captured, originalSize: 0 },
    { ...captured, originalSize: 2097153 },
    { ...captured, displayValidated: true },
    { ...captured, captureState: "blocked" },
    { ...captured, originalSha256: undefined },
    { ...captured, sourceRowSha256: "" },
  ])
    assert.throws(() => sourceReceipt(bad, id, "capture"));
  for (const state of ["empty", "blocked", "market_default"]) {
    const value = {
      ...captured,
      state: state === "blocked" ? "completed_with_blocked" : "completed",
      captureState: state,
      originalSha256: null,
      originalSize: null,
      originalPath: null,
    };
    assert.equal(sourceIconReceipt(value, id).kind, "capture");
    assert.ok(sourceIconLabel(sourceIconReceipt(value, id)).length);
  }
  assert.throws(() =>
    sourceIconReceipt(
      { ...captured, kind: "apply", captureRequestId: id, icon: undefined },
      id,
    ),
  );
});
test("source icon preview separates unknown current state, explicit replacement and the immutable capture identity", () => {
  const proof = {
    captureRequestId: id,
    manifestId: manifest,
    originalGroupId: "old-custom",
    originalSha256: hash,
    originalSize: 10,
    targetGroupId: "wg-known",
    beforeIcon: "",
    groupRevision: 0,
    replaceCurrent: false,
    ready: true,
    blocker: null,
    preview: hash,
    financialApplied: false,
  };
  assert.deepEqual(sourceIconProof(proof, id, false), proof);
  const unknown = {
    ...proof,
    ready: false,
    targetGroupId: null,
    beforeIcon: null,
    blocker: "original_group_binding_missing",
  };
  assert.equal(sourceIconProof(unknown, id, false).beforeIcon, null);
  for (const bad of [
    { ...proof, groupRevision: -1 },
    { ...proof, captureRequestId: manifest },
    { ...proof, replaceCurrent: true },
    { ...proof, originalSize: null },
    { ...proof, targetGroupId: null },
  ])
    assert.throws(() => sourceIconProof(bad, id, false));
  assert.equal(
    sourceIconCanCapture(
      {
        currentSourceAccess: {
          grantState: "active",
          grantRevisionMatches: true,
          window: {
            state: "active",
            notBefore: "2026-01-01T00:00:00Z",
            expiresAt: "2026-01-01T01:00:00Z",
          },
        },
      } as never,
      Date.parse("2026-01-01T01:00:00Z"),
    ),
    false,
  );
});
