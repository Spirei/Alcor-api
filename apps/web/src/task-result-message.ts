export function taskResultMessage(task: {
  kind: string;
  status: string;
  result: Record<string, unknown> | null;
}) {
  const result = task.result;
  const backupMessage =
    result?.scope === "backup" && typeof result.message === "string"
      ? result.message
      : null;
  if (task.status === "failed")
    return backupMessage
      ? "任务失败：" + backupMessage
      : "任务执行失败，请核对原请求回执。";
  if (task.status === "cancelled") return "任务已取消。";
  if (task.status !== "succeeded") return "任务结果待核对。";
  if (backupMessage) return backupMessage;
  if (result?.scope === "runtime" && typeof result.healthy === "boolean")
    return result.healthy
      ? "内部运行检查通过，回执已保存。"
      : "内部运行检查完成，存在异常依赖。";
  return task.kind === "system.diagnostics"
    ? "系统检查已完成，回执已保存。"
    : "任务回执已保存。";
}
