import assert from "node:assert/strict";
import test from "node:test";
import {
  heatCells,
  selectedHeat,
  runState,
  formatTime,
  formatShanghai,
  visibleRunTitle,
  orderedJobs,
  buildReceiptMessage,
  verificationOnly,
  deploymentPollDelay,
  canRestartBuild,
  receiptCloseTarget,
  deploymentRuntimeState,
  updateNeedsObservation,
} from "../src/deployment-view.ts";
test("a matching runtime commit stays pending until the service is explicitly ready", () => {
  const release = {
    image: "ghcr.io/synthetic/alcor-api@sha256:" + "a".repeat(64),
    version: "0.1.99",
    revision: "b".repeat(40),
    schema_hash: "c".repeat(64),
  };
  const data = {
    running_revision: release.revision,
    runtime_ready: false,
    matches_release: true,
    release,
  };
  assert.deepEqual(deploymentRuntimeState(data), {
    ready: false,
    current: false,
    waiting: true,
  });
  assert.deepEqual(deploymentRuntimeState({ ...data, runtime_ready: true }), {
    ready: true,
    current: true,
    waiting: false,
  });
  assert.deepEqual(
    deploymentRuntimeState({
      ...data,
      runtime_ready: true,
      matches_release: false,
    }),
    { ready: true, current: false, waiting: false },
  );
  assert.deepEqual(
    deploymentRuntimeState({ ...data, running_revision: "d".repeat(40) }),
    { ready: false, current: false, waiting: false },
  );
  assert.deepEqual(deploymentRuntimeState(null), {
    ready: false,
    current: false,
    waiting: false,
  });
  const idle = {
    ...data,
    source: { sha: release.revision, url: "#" },
    check: null,
    build: null,
    receipts: [],
    build_requests: [],
  };
  assert.equal(deploymentPollDelay(idle, false, false, false), 5000);
  assert.equal(deploymentPollDelay(idle, false, true, false), 15000);
  assert.equal(deploymentPollDelay(idle, true, false, false), null);
  assert.equal(
    deploymentPollDelay({ ...idle, runtime_ready: true }, false, false, false),
    null,
  );
});
test("only unresolved receipts with an immutable complete target can be explicitly closed", () => {
  const receipt = {
    id: "record",
    request_id: "original",
    image: "ghcr.io/synthetic/alcor-api@sha256:" + "a".repeat(64),
    version: "0.1.99",
    revision: "b".repeat(40),
    schema_hash: "c".repeat(64),
    status: "unknown",
    created_at: "2026-11-05T00:00:00Z",
  };
  const target = {
    image: receipt.image,
    version: receipt.version,
    revision: receipt.revision,
    schema_hash: receipt.schema_hash,
  };
  for (const status of ["queued", "running", "unknown"])
    assert.deepEqual(receiptCloseTarget({ ...receipt, status }), target);
  for (const status of ["succeeded", "failed", "cancelled", "other"])
    assert.equal(receiptCloseTarget({ ...receipt, status }), null);
  for (const change of [
    { revision: undefined },
    { schema_hash: undefined },
    { revision: "b".repeat(7) },
    { schema_hash: "bad" },
    { image: "ghcr.io/synthetic/alcor-api:latest" },
    { version: "" },
  ])
    assert.equal(receiptCloseTarget({ ...receipt, ...change }), null);
  const approved = receiptCloseTarget(receipt);
  receipt.revision = "d".repeat(40);
  assert.deepEqual(approved, target);
});
test("an overdue build gets an explicit recovery option only with complete current-source evidence", () => {
  const now = Date.parse("2026-11-06T00:30:00Z"),
    sha = "a".repeat(40);
  const run = {
    id: 1,
    name: "checks",
    title: "源码检查",
    sha,
    status: "completed",
    conclusion: "success",
    event: "push",
    workflow_path: ".github/workflows/checks.yml",
    started_at: null,
    updated_at: null,
    url: "https://example.invalid/checks/1",
  };
  const original = {
    request_id: "original",
    status: "unknown",
    created_at: new Date(now - 15 * 60000).toISOString(),
  };
  const data = {
    can_build: true,
    source: { sha, url: "https://example.invalid/commit/" + sha },
    source_error: null,
    check: run,
    release: null,
    build: null,
    build_error: null,
    build_requests: [original],
  };
  assert.equal(canRestartBuild(data, "original", now), true);
  assert.equal(
    canRestartBuild(
      { ...data, build_requests: [{ ...original, status: "dispatching" }] },
      "original",
      now,
    ),
    true,
  );
  assert.equal(canRestartBuild(data, "other-request", now), false);
  assert.equal(canRestartBuild(data, "original", now - 1), false);
  for (const created_at of ["bad", new Date(now + 60000).toISOString()])
    assert.equal(
      canRestartBuild(
        { ...data, build_requests: [{ ...original, created_at }] },
        "original",
        now,
      ),
      false,
    );
  for (const status of ["submitted", "failed"])
    assert.equal(
      canRestartBuild(
        { ...data, build_requests: [{ ...original, status }] },
        "original",
        now,
      ),
      false,
    );
  for (const change of [
    { can_build: false },
    { source_error: "源码读取失败" },
    { build_error: "发布状态读取失败" },
    { source: { ...data.source, sha: "b".repeat(40) } },
    { check: { ...run, status: "in_progress" } },
    { check: { ...run, conclusion: "failure" } },
    { check: { ...run, conclusion: "skipped" } },
    { check: null },
    { build: { ...run, head_sha: sha, status: "queued", conclusion: null } },
    {
      release: {
        version: "0.1.1",
        image: "synthetic",
        revision: sha,
        schema_hash: "synthetic",
      },
    },
  ])
    assert.equal(
      canRestartBuild({ ...data, ...change }, "original", now),
      false,
    );
});
test("a Watchtower notification remains an observation until the original result is confirmed", () => {
  const now = Date.parse("2026-11-06T00:30:00Z"),
    created_at = new Date(now).toISOString();
  for (const status of ["queued", "running", "unknown"])
    assert.equal(updateNeedsObservation({ status, created_at }, now), true);
  for (const status of ["succeeded", "failed", "cancelled"])
    assert.equal(updateNeedsObservation({ status, created_at }, now), false);
  assert.equal(
    updateNeedsObservation({ status: "unknown", created_at: "bad" }, now),
    false,
  );
  assert.equal(
    updateNeedsObservation({ status: "unknown", created_at }, now + 15 * 60000),
    false,
  );
  const data = {
    source: { sha: "a", url: "#" },
    release: null,
    check: null,
    build: null,
    build_requests: [],
    receipts: [
      {
        id: "id",
        request_id: "original",
        version: "0.1.1",
        image: "synthetic",
        status: "unknown",
        created_at,
      },
    ],
  };
  assert.equal(deploymentPollDelay(data, false, false, false, now), 5000);
  assert.equal(
    deploymentPollDelay(data, false, false, false, now + 15 * 60000),
    null,
  );
});
test("deployment polling retries transient reads but never a withdrawn identity or completed idle state", () => {
  const now = Date.parse("2026-11-04T00:00:00Z");
  const idle = {
    source: { sha: "a", url: "#" },
    release: null,
    check: null,
    build: null,
    receipts: [],
    build_requests: [],
  };
  assert.equal(deploymentPollDelay(idle, false, false, false, now), null);
  const active = {
    ...idle,
    build_requests: [
      {
        request_id: "synthetic",
        status: "unknown",
        created_at: new Date(now).toISOString(),
      },
    ],
  };
  assert.equal(deploymentPollDelay(active, false, false, false, now), 5000);
  assert.equal(deploymentPollDelay(active, false, true, false, now), 15000);
  assert.equal(deploymentPollDelay(active, true, true, false, now), null);
  assert.equal(deploymentPollDelay(null, false, true, true, now), null);
  assert.equal(
    deploymentPollDelay(active, false, false, false, now + 16 * 60000),
    null,
  );
  assert.equal(
    deploymentPollDelay(
      {
        ...active,
        build_requests: [{ ...active.build_requests[0], created_at: "bad" }],
      },
      false,
      false,
      false,
      now,
    ),
    null,
  );
  assert.equal(
    deploymentPollDelay(
      {
        ...active,
        release: {
          version: "1",
          revision: "a",
          image: "synthetic",
          schema_hash: "synthetic",
        },
      },
      false,
      false,
      false,
      now,
    ),
    null,
  );
});
test("explicit build failure stays distinct from lost dispatch and verification-only jobs", () => {
  assert.match(buildReceiptMessage({ status: "failed" }), /未接受/);
  assert.match(buildReceiptMessage({ status: "unknown" }), /同一回执/);
  assert.equal(
    buildReceiptMessage({ status: "failed", message: "GitHub 权限不足" }),
    "GitHub 权限不足",
  );
  const job = {
    id: 1,
    name: "publish",
    status: "completed",
    conclusion: "success",
    started_at: null,
    completed_at: null,
    steps: ["核对同一提交的已有发布", "发布不可变版本清单"].map(
      (name, number) => ({
        name,
        number,
        status: "completed",
        conclusion: "skipped",
        started_at: null,
        completed_at: null,
      }),
    ),
  };
  assert.equal(verificationOnly([job]), true);
  assert.equal(verificationOnly([{ ...job, conclusion: "failure" }]), false);
  assert.equal(
    verificationOnly([
      {
        ...job,
        steps: job.steps.map((s) => ({ ...s, conclusion: "success" })),
      },
    ]),
    false,
  );
  assert.equal(verificationOnly(null), false);
});

test("deployment heatmap distinguishes unknown, zero, future and leap days", () => {
  const partial = heatCells(2024, { "2024-02-29": 2 }, false, "2024-10-31");
  assert.equal(partial.filter((c) => c.date).length, 366);
  assert.equal(partial.find((c) => c.date === "2024-02-29")!.count, 2);
  assert.equal(partial.find((c) => c.date === "2024-02-28")!.count, null);
  const complete = heatCells(2024, {}, true, "2024-10-31");
  assert.equal(complete.find((c) => c.date === "2024-02-28")!.count, 0);
  assert.equal(complete.find((c) => c.date === "2024-11-01")!.count, null);
  assert.equal(complete.length % 7, 0);
});
test("ported heatmap day/week/month/cumulative selection computes distinct real totals", () => {
  const cells = heatCells(
    2026,
    { "2026-10-01": 2, "2026-10-02": 3, "2026-09-01": 7 },
    true,
    "2026-10-31",
  );
  const cell = cells.find((c) => c.date === "2026-10-02")!;
  assert.equal(selectedHeat(cells, cell, "day").count, 3);
  assert.equal(selectedHeat(cells, cell, "week").count, 5);
  assert.equal(selectedHeat(cells, cell, "month").count, 5);
  assert.equal(selectedHeat(cells, cell, "total").count, 12);
  assert.deepEqual(
    selectedHeat(heatCells(2026, null, false, "2026-10-31"), cell, "day"),
    { count: null, partial: true },
  );
});
test("status and dates never promote missing or skipped checks to success", () => {
  assert.equal(runState().tone, "neutral");
  assert.equal(runState("completed", "skipped").tone, "neutral");
  assert.equal(runState("completed", "success").tone, "good");
  assert.match(formatTime("2026-10-30T16:30:00Z"), /2026\/10\/31 00:30/);
  assert.equal(formatTime(null), "—");
  assert.equal(
    formatShanghai("2026-11-05T22:25:00Z"),
    "2026/11/6 06:25 上海时间",
  );
  assert.equal(formatShanghai(null), "");
  assert.equal(formatShanghai("not-a-date"), "");
  assert.equal(
    visibleRunTitle(
      "feat: 发布 AlcorApi 统一迁移版本 · 81e50f3b-dccb-44a4-b45d-a73782fda35c",
    ),
    "feat: 发布 AlcorApi 统一迁移版本",
  );
  assert.equal(
    visibleRunTitle(`ci: 验证 AlcorApi 发布流程 · ${"ab".repeat(20)}`),
    "ci: 验证 AlcorApi 发布流程",
  );
  assert.equal(visibleRunTitle("Synthetic run"), "Synthetic run");
  assert.deepEqual(
    orderedJobs([
      { id: 3, name: "发布不可变版本清单" },
      { id: 9, name: "publish" },
      { id: 2, name: "TypeScript 检查" },
      { id: 1, name: "核对发布条件" },
    ])?.map((job) => job.name),
    ["核对发布条件", "TypeScript 检查", "发布不可变版本清单", "publish"],
  );
});
