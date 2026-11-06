import assert from "node:assert/strict";
import test from "node:test";
import { personalTransferTask } from "../src/personal-transfer-task.ts";

const base = {
  exporting: false,
  busy: false,
  pending: false,
  operation: "file",
  exported: false,
  hasFile: true,
  fileValid: true,
  hasMessage: false,
  plan: null,
  receipt: null,
};

test("export and import receipts cannot certify each other's success", () => {
  assert.equal(personalTransferTask({ ...base, exported: true }).state, "idle");
  assert.equal(
    personalTransferTask({
      ...base,
      exporting: true,
      hasMessage: true,
      receipt: { state: "completed", executed: true },
    }).state,
    "unknown",
  );
  assert.equal(
    personalTransferTask({ ...base, exporting: true, exported: true })
      .statusLabel,
    "文件已就绪",
  );
  assert.equal(
    personalTransferTask({ ...base, receipt: { state: "completed" } }).state,
    "unknown",
  );
});

test("confirmation, closed, pending and in-flight writes retain their distinct meanings", () => {
  assert.equal(
    personalTransferTask({ ...base, plan: { blocked: [] } }).state,
    "confirm",
  );
  assert.equal(
    personalTransferTask({ ...base, plan: { blocked: ["unmapped"] } }).state,
    "partial",
  );
  assert.deepEqual(
    personalTransferTask({ ...base, receipt: { state: "closed" } }),
    {
      state: "idle",
      statusLabel: "已关闭，未执行导入",
    },
  );
  assert.equal(
    personalTransferTask({
      ...base,
      pending: true,
      receipt: { state: "completed", executed: true },
    }).state,
    "unknown",
  );
  assert.equal(
    personalTransferTask({
      ...base,
      operation: "submit",
      pending: true,
      busy: true,
    }).state,
    "running",
  );
});
