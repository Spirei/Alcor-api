import assert from "node:assert/strict";
import test from "node:test";
import {
  parseMigrationWorkStatus,
  migrationWorkPresentation,
} from "../src/migration-work-status-model.ts";
const now = Date.parse("2026-11-03T10:00:00Z");
const source = {
  schema_version: 1,
  state: "working",
  feature_id: "F16",
  step: "原件核对",
  updated_at: "2026-11-03T09:59:00Z",
  summary: "定向验证",
  sequence: 3,
};
test("actual camel transport and snake fallback normalize to the same evidence", () => {
  const legacy = parseMigrationWorkStatus(source);
  const current = parseMigrationWorkStatus({
    schemaVersion: 1,
    state: "working",
    featureId: "F16",
    step: "原件核对",
    updatedAt: source.updated_at,
    summary: "定向验证",
    sequence: 3,
  });
  assert.deepEqual(current, legacy);
  assert.equal(migrationWorkPresentation(current, now, true).animated, true);
  assert.equal(parseMigrationWorkStatus({ ...source, sequence: -1 }), null);
  assert.equal(
    parseMigrationWorkStatus({ ...source, updated_at: "2026-11-03" }),
    null,
  );
  assert.equal(parseMigrationWorkStatus({ ...source, state: "unknown" }), null);
  assert.equal(parseMigrationWorkStatus(null), null);
});
test("only fresh working or verifying evidence animates", () => {
  const status = parseMigrationWorkStatus(source)!;
  assert.equal(
    migrationWorkPresentation({ ...status, state: "verifying" }, now, true)
      .animated,
    true,
  );
  for (const state of ["waiting", "blocked", "idle", "complete"] as const)
    assert.equal(
      migrationWorkPresentation({ ...status, state }, now, true).animated,
      false,
    );
  assert.equal(
    migrationWorkPresentation(status, now + 61000, true).label,
    "更新中断",
  );
  assert.equal(
    migrationWorkPresentation(
      { ...status, updated_at: "2026-11-03T10:00:06Z" },
      now,
      true,
    ).animated,
    false,
  );
  assert.equal(
    migrationWorkPresentation({ ...status, stale: true }, now, true).animated,
    false,
  );
});
test("disconnect preserves evidence without advertising live work; missing status stays unknown", () => {
  const status = parseMigrationWorkStatus(source)!;
  assert.deepEqual(migrationWorkPresentation(status, now, false), {
    animated: false,
    label: "工作状态连接中断",
  });
  assert.equal(
    migrationWorkPresentation(null, now, true).label,
    "尚无工作状态",
  );
  const safe = parseMigrationWorkStatus({
    ...source,
    feature_id: "https://invalid",
    source_commit: "not a commit",
    summary: "a\u0000b",
    step: { private: "value" },
  })!;
  assert.equal(safe.feature_id, null);
  assert.equal(safe.source_commit, undefined);
  assert.equal(safe.step, "");
  assert.equal(safe.summary, "a b");
});
