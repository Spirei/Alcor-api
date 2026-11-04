import assert from "node:assert/strict";
import test from "node:test";
import {
  heatCells,
  selectedHeat,
  runState,
  formatTime,
  buildReceiptMessage,
  verificationOnly,
  deploymentPollDelay,
} from "../src/deployment-view.ts";
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
});
