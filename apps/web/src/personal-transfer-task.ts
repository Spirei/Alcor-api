import type { OperationState } from "./operation-task-card";

export function personalTransferTask(value: {
  exporting: boolean;
  busy: boolean;
  pending: boolean;
  operation: string | null;
  exported: boolean;
  hasFile: boolean;
  fileValid: boolean;
  hasMessage: boolean;
  plan: { blocked: unknown[] } | null;
  receipt: { state: string; executed?: boolean } | null;
}): { state: OperationState; currentStep?: number; statusLabel?: string } {
  if (value.exporting) {
    if (value.busy)
      return { state: "running", statusLabel: "等待读取导出文件" };
    if (value.exported)
      return { state: "success", currentStep: 3, statusLabel: "文件已就绪" };
    return { state: value.hasMessage ? "unknown" : "idle" };
  }
  if (value.busy)
    return {
      state: "running",
      currentStep:
        value.operation === "file"
          ? 0
          : value.operation === "preview"
            ? 1
            : value.operation === "submit"
              ? 2
              : undefined,
    };
  if (value.pending) return { state: "unknown", statusLabel: "结果待核对" };
  if (value.receipt?.state === "closed")
    return { state: "idle", statusLabel: "已关闭，未执行导入" };
  if (value.receipt?.state === "completed" && value.receipt.executed === true)
    return { state: "success", currentStep: 3, statusLabel: "导入已完成" };
  if (value.plan)
    return {
      state: value.plan.blocked.length ? "partial" : "confirm",
      currentStep: 1,
      statusLabel: value.plan.blocked.length
        ? "预览存在待处理项"
        : "预览待确认",
    };
  if (value.operation === "file" && !value.fileValid && value.hasMessage)
    return { state: "failed", currentStep: 0 };
  if (value.receipt) return { state: "unknown", statusLabel: "导入回执待核对" };
  return {
    state: "idle",
    currentStep: value.hasFile ? 1 : undefined,
    statusLabel: value.hasFile ? "文件已读取，待核对映射" : undefined,
  };
}
