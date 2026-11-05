import assert from "node:assert/strict";
import test from "node:test";
import { syncRows, type ChangeSignals } from "../src/sync-status-model.ts";
test("missing and incomplete change sources never appear synchronized", () => {
  const data: ChangeSignals = {
    userId: "user",
    instanceId: "instance",
    observedAt: "2026-11-06T00:00:00Z",
    unrepresentedSources: [],
    domains: {
      profile: {
        state: "observed",
        revision: 0,
        lastChangedAt: null,
        commitSignalComplete: true,
      },
      portfolio: {
        state: "observed",
        revision: 12,
        lastChangedAt: null,
        commitSignalComplete: false,
      },
      resources: {
        state: "forbidden",
        revision: null,
        lastChangedAt: null,
        commitSignalComplete: false,
      },
      watch: {
        state: "partial",
        revision: 4,
        lastChangedAt: null,
        commitSignalComplete: false,
      },
    },
  };
  const rows = Object.fromEntries(syncRows(data).map((row) => [row.key, row]));
  assert.equal(rows.profile.status, "已监测");
  assert.equal(rows.portfolio.status, "待接入");
  assert.equal(rows.resources.status, "未授权");
  assert.equal(rows.watch.status, "部分覆盖");
  assert.equal(rows.feed.status, "待接入");
  assert.ok(!syncRows(data).some((row) => row.status.includes("同步完成")));
});
