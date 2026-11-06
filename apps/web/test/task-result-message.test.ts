import assert from "node:assert/strict";
import test from "node:test";
import { taskResultMessage } from "../src/task-result-message.ts";

test("备份失败、取消及未知回执不得落入系统检查成功文案", () => {
  for (const status of [
    "failed",
    "cancelled",
    "running",
    "queued",
    "cancel_requested",
    "unexpected",
  ]) {
    const message = taskResultMessage({
      kind: "backup.create",
      status,
      result: { bytes: 2048 },
    });
    assert.ok(!message.includes("已完成") && !message.includes("通过"));
  }
  assert.equal(
    taskResultMessage({
      kind: "backup.create",
      status: "failed",
      result: { scope: "backup", message: "存储拒绝写入" },
    }),
    "任务失败：存储拒绝写入",
  );
  assert.equal(
    taskResultMessage({
      kind: "system.diagnostics",
      status: "succeeded",
      result: {},
    }),
    "系统检查已完成，回执已保存。",
  );
  assert.equal(
    taskResultMessage({
      kind: "backup.create",
      status: "succeeded",
      result: {},
    }),
    "任务回执已保存。",
  );
});
