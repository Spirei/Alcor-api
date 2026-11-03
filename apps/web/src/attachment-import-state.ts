import type { SourceWindow } from "./source-window-view";
type Store = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
const prefix = "alcor.attachment-source-request:",
  uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
  sha = /^[a-f0-9]{64}$/;
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
export function attachmentImportUuid(v: unknown): v is string {
  return typeof v === "string" && uuid.test(v);
}
export function clearAttachmentImportRequests(s: Store, keep?: string) {
  for (const k of Array.from({ length: s.length }, (_, i) => s.key(i)))
    if (k?.startsWith(prefix) && k !== prefix + keep) s.removeItem(k);
}
export function readAttachmentImportRequest(s: Store, scope: string) {
  clearAttachmentImportRequests(s, scope);
  const id = s.getItem(prefix + scope);
  if (id !== null && !uuid.test(id)) throw new Error("原附件导入编号无法读取");
  return id;
}
export function retainAttachmentImportRequest(
  s: Store,
  scope: string,
  id: string,
) {
  if (!uuid.test(id)) throw new Error("原操作编号无效");
  const old = readAttachmentImportRequest(s, scope);
  if (old && old !== id) throw new Error("请先核对原附件导入操作");
  s.setItem(prefix + scope, id);
}
export function releaseAttachmentImportRequest(
  s: Store,
  scope: string,
  id: string,
) {
  if (s.getItem(prefix + scope) === id) s.removeItem(prefix + scope);
}
export type AttachmentSource = {
  alias: string;
  namespace: "admin_shared";
  scope: "attachments.migrate";
  migrationWindow: SourceWindow;
};
export type ArchiveSummary = {
  manifestId: string;
  digest: string;
  state: "sealed" | "partial";
  manifest: {
    namespace: "admin_shared";
    sourceAlias: string;
    captureComplete: boolean;
    entryCount: number;
    readyCount: number;
    blockedCount: number;
    knownFileBytes: number;
    blockers: { path: string; reason: string }[];
  };
  manifestRevision: number;
  pending: number;
  applied: number;
  blocked: number;
  total: number;
  targetChangedCount: number;
  targetImportCompleted: boolean;
  instanceReenrollmentRequired: boolean;
};
export type ArchiveItem = {
  ordinal: number;
  evidence: {
    path: string;
    kind: "file" | "directory" | "unknown";
    size: number | null;
    sha256: string | null;
    captureState: "ready" | "blocked";
    reason: string | null;
  };
  apply_state: "applied" | "blocked" | null;
  result: { reason?: string } | null;
};
export type ArchivePage = ArchiveSummary & {
  items: ArchiveItem[];
  nextAfter: number | null;
};
export type AttachmentImportPlan = {
  manifestId: string;
  digest: string;
  expectedRevision: number;
  manifestRevision: number;
  maxItems: number;
  retryBlocked: boolean;
  items: {
    ordinal: number;
    path: string;
    kind: "file" | "directory";
    size: number | null;
    sha256: string | null;
    status: "ready" | "blocked" | "already_applied";
    reason: string | null;
  }[];
  preview: string;
  summary: ArchiveSummary;
};
export type AttachmentImportReceipt = {
  requestId: string;
  namespace: "admin_shared";
  kind: "capture" | "segment";
  state: "completed" | "failed";
  revision: number;
  httpStatus: number;
  message: string;
  manifestId?: string;
  captureState?: "sealed" | "partial";
  targetImportCompleted: boolean;
  canceled?: boolean;
  summary?: ArchiveSummary;
  items?: {
    ordinal: number;
    path: string;
    state: "applied" | "blocked";
    reason?: string;
  }[];
};
export function captureWindow(
  window: SourceWindow | undefined,
  now = Date.now(),
): SourceWindow {
  if (!window) return { state: "unknown" };
  if (window.state !== "active") return window;
  const start = Date.parse(window.notBefore ?? ""),
    end = Date.parse(window.expiresAt ?? "");
  if (
    ![window.notBefore, window.expiresAt].every(
      (v) => typeof v === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(v),
    ) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end
  )
    return { state: "unavailable" };
  return {
    ...window,
    state: now >= end ? "expired" : now < start ? "not_started" : "active",
  };
}
export function archiveSummary(raw: unknown): ArchiveSummary {
  const v = raw as ArchiveSummary | null,
    m = v?.manifest;
  if (
    !v ||
    !attachmentImportUuid(v.manifestId) ||
    !sha.test(v.digest) ||
    !["sealed", "partial"].includes(v.state) ||
    !m ||
    m.namespace !== "admin_shared" ||
    typeof m.sourceAlias !== "string" ||
    typeof m.captureComplete !== "boolean" ||
    ![
      m.entryCount,
      m.readyCount,
      m.blockedCount,
      m.knownFileBytes,
      v.pending,
      v.applied,
      v.blocked,
      v.total,
      v.targetChangedCount,
    ].every(count) ||
    !count(v.manifestRevision) ||
    v.manifestRevision < 1 ||
    m.readyCount + m.blockedCount !== m.entryCount ||
    v.total !== m.entryCount ||
    v.pending + v.applied + v.blocked !== v.total ||
    v.targetChangedCount > v.applied ||
    !Array.isArray(m.blockers) ||
    m.blockers.some(
      (b) => !b || typeof b.path !== "string" || typeof b.reason !== "string",
    ) ||
    typeof v.instanceReenrollmentRequired !== "boolean" ||
    typeof v.targetImportCompleted !== "boolean"
  )
    throw new Error("附件来源清单范围待核对");
  if (
    (v.state === "sealed" &&
      (!m.captureComplete ||
        m.blockedCount !== 0 ||
        m.blockers.length !== 0)) ||
    (v.targetImportCompleted &&
      (v.state !== "sealed" ||
        !m.captureComplete ||
        v.pending !== 0 ||
        v.blocked !== 0 ||
        v.targetChangedCount !== 0 ||
        v.applied !== v.total ||
        v.instanceReenrollmentRequired))
  )
    throw new Error("附件来源完成状态不符");
  return v;
}
export function archivePage(raw: unknown, id: string): ArchivePage {
  const v = raw as ArchivePage;
  archiveSummary(raw);
  if (
    v.manifestId !== id ||
    !Array.isArray(v.items) ||
    v.items.length > 100 ||
    (v.nextAfter !== null && !count(v.nextAfter)) ||
    v.items.some(
      (i) =>
        !i ||
        !count(i.ordinal) ||
        !i.evidence ||
        typeof i.evidence.path !== "string" ||
        !["file", "directory", "unknown"].includes(i.evidence.kind) ||
        !["ready", "blocked"].includes(i.evidence.captureState) ||
        (i.evidence.size !== null && !count(i.evidence.size)) ||
        (i.evidence.sha256 !== null && !sha.test(i.evidence.sha256)) ||
        ![null, "applied", "blocked"].includes(i.apply_state),
    ) ||
    new Set(v.items.map((i) => i.ordinal)).size !== v.items.length
  )
    throw new Error("附件清单项目待核对");
  return v;
}
export function attachmentImportPlan(
  raw: unknown,
  page: ArchiveSummary,
  maxItems: number,
  retry: boolean,
): AttachmentImportPlan {
  const v = raw as AttachmentImportPlan | null;
  if (
    !v ||
    v.manifestId !== page.manifestId ||
    v.digest !== page.digest ||
    v.manifestRevision !== page.manifestRevision ||
    v.maxItems !== maxItems ||
    v.retryBlocked !== retry ||
    !count(v.expectedRevision) ||
    v.expectedRevision < 1 ||
    !sha.test(v.preview) ||
    !Array.isArray(v.items) ||
    v.items.length > maxItems ||
    v.items.some(
      (i) =>
        !i ||
        !count(i.ordinal) ||
        typeof i.path !== "string" ||
        !["file", "directory"].includes(i.kind) ||
        (i.size !== null && !count(i.size)) ||
        (i.sha256 !== null && !sha.test(i.sha256)) ||
        !["ready", "blocked", "already_applied"].includes(i.status),
    ) ||
    new Set(v.items.map((i) => i.ordinal)).size !== v.items.length
  )
    throw new Error("附件导入预览已变化，请重新核对");
  const summary = archiveSummary(v.summary);
  if (
    summary.manifestId !== page.manifestId ||
    summary.digest !== page.digest ||
    summary.manifestRevision !== v.manifestRevision ||
    summary.instanceReenrollmentRequired
  )
    throw new Error("来源清单或实例已变化");
  return v;
}
export function attachmentSourceSegment(
  id: string,
  plan: AttachmentImportPlan | null,
  page: ArchiveSummary | null,
  maxItems: number,
  retry: boolean,
) {
  if (
    !attachmentImportUuid(id) ||
    !plan ||
    !page ||
    !Number.isInteger(maxItems) ||
    maxItems < 1 ||
    maxItems > 32
  )
    throw new Error("请先预览当前附件清单");
  attachmentImportPlan(plan, page, maxItems, retry);
  return {
    requestId: id,
    expectedRevision: plan.expectedRevision,
    manifestRevision: plan.manifestRevision,
    preview: plan.preview,
    maxItems,
    retryBlocked: retry,
  };
}
export function importReceipt(
  raw: unknown,
  id: string,
): AttachmentImportReceipt {
  const v = raw as AttachmentImportReceipt | null;
  if (
    !v ||
    v.requestId !== id ||
    !attachmentImportUuid(id) ||
    v.namespace !== "admin_shared" ||
    !["capture", "segment"].includes(v.kind) ||
    !["completed", "failed"].includes(v.state) ||
    !count(v.revision) ||
    v.revision < 1 ||
    typeof v.message !== "string" ||
    typeof v.targetImportCompleted !== "boolean" ||
    (v.state === "completed"
      ? v.httpStatus !== 200
      : !Number.isInteger(v.httpStatus) ||
        v.httpStatus < 400 ||
        v.httpStatus > 599)
  )
    throw new Error("原附件导入回执不符，请继续核对");
  if (v.state === "failed" && v.targetImportCompleted)
    throw new Error("失败回执不能作为整库应用完成回执");
  if (v.state === "completed") {
    if (!attachmentImportUuid(v.manifestId))
      throw new Error("回执缺少真实来源清单");
    if (
      v.kind === "capture" &&
      (!["sealed", "partial"].includes(v.captureState ?? "") ||
        v.targetImportCompleted)
    )
      throw new Error("捕获不能作为整库应用完成回执");
    if (v.kind === "segment") {
      const summary = archiveSummary(v.summary);
      if (
        summary.manifestId !== v.manifestId ||
        summary.targetImportCompleted !== v.targetImportCompleted
      )
        throw new Error("导入回执的完成范围不符");
    }
  }
  return v;
}
export function archivePhase(v: ArchiveSummary) {
  if (v.instanceReenrollmentRequired) return "恢复实例待认领";
  if (v.state !== "sealed") return "捕获范围不完整";
  if (v.total === 0) return "清单为空";
  if (v.targetImportCompleted) return "本清单已全部应用";
  if (v.targetChangedCount) return "目标已有变更";
  return v.blocked ? "有项目待核对" : "尚有项目待应用";
}
export function attachmentSourceReason(code: string | null | undefined) {
  return (
    (
      {
        source_entry_unverified: "来源项目未核实",
        source_directory_unreadable: "目录无法读取",
        source_directory_changed: "目录身份发生变化",
        source_entry_missing_or_unreadable: "原件缺失或无法读取",
        source_entry_changed_after_read: "原件在捕获后发生变化",
        source_file_changed: "原件读取时发生变化",
        source_link_or_special_file_not_allowed: "链接或特殊文件待核对",
        source_file_exceeds_50MiB: "原件超过50MiB",
        source_entry_budget_exceeded: "超过本次项目预算",
        source_byte_budget_exceeded: "超过本次字节预算",
        source_depth_budget_exceeded: "超过本次目录深度",
        source_path_not_representable: "原路径无法无损表示",
        source_entry_permissions_unverified: "来源权限无法核实",
        source_cross_filesystem_unregistered: "其他文件系统尚未登记",
        captured_original_not_durable: "原件未可靠落盘",
        source_final_verification_unavailable: "捕获结束核对未完成",
        source_directory_membership_changed: "目录内容发生变化",
        source_root_membership_changed: "来源根内容发生变化",
        attachment_source_root_identity_mismatch: "来源根身份无法核实",
        target_path_collision: "目标已有同名项目",
        target_parent_not_source_mapped: "父目录尚未有来源映射",
        source_parent_not_applied: "来源父目录尚未应用",
        parent_required_in_segment: "父目录将在本段创建",
        source_revision_requires_reconciliation: "同原路径的来源版本需核对",
        target_was_deleted: "目标已被删除",
        target_was_changed: "目标版本已变化",
        target_path_changed: "目标路径已变化",
      } as Record<string, string>
    )[code ?? ""] ??
    code ??
    "待核对"
  );
}
