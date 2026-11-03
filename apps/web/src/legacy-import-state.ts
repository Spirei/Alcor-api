type Store = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
const prefix = "alcor.legacy-import-request:";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function sourceUuid(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}
export function sourceSessionMatches(
  displayed: string,
  binding: { csrf: string | null },
) {
  return !!displayed && binding.csrf === displayed;
}
export function clearLegacyImportScope(storage: Store, scope: string) {
  storage.removeItem(prefix + scope);
}
export function clearLegacyImportRequests(storage: Store, keep?: string) {
  for (const key of Array.from({ length: storage.length }, (_, i) =>
    storage.key(i),
  ))
    if (key?.startsWith(prefix) && key !== prefix + keep)
      storage.removeItem(key);
}
export function readLegacyImportRequest(
  storage: Store,
  scope: string,
): string | null {
  clearLegacyImportRequests(storage, scope);
  const raw = storage.getItem(prefix + scope);
  if (raw !== null && !sourceUuid(raw))
    throw new Error("原操作编号无法读取，请先核对");
  return raw;
}
export function retainLegacyImportRequest(
  storage: Store,
  scope: string,
  id: string,
) {
  if (!sourceUuid(id)) throw new Error("原操作编号无效");
  const previous = readLegacyImportRequest(storage, scope);
  if (previous && previous !== id) throw new Error("请先查询原操作");
  storage.setItem(prefix + scope, id);
}
export function releaseLegacyImportRequest(
  storage: Store,
  scope: string,
  id: string,
) {
  if (storage.getItem(prefix + scope) === id)
    storage.removeItem(prefix + scope);
}
export function sourceOperationLabel(state: string) {
  return (
    (
      { completed: "已完成", failed: "失败", reading: "读取未确认" } as Record<
        string,
        string
      >
    )[state] || "待核对"
  );
}
export function sourcePermissionLabel(state: string) {
  return (
    (
      {
        pending_owner: "待本人确认",
        active: "有效",
        revoked: "已撤销",
        instance_reenrollment_required: "恢复实例须重新授权",
        migration_window_expired: "迁移取数窗口已到期",
        migration_window_revoked: "迁移取数窗口已撤销",
        migration_window_not_started: "迁移取数窗口尚未开始",
        migration_window_unknown: "迁移取数窗口未配置",
        migration_window_unavailable: "迁移取数窗口无法核验",
        source_registry_unavailable_or_changed: "来源登记缺失或已变化",
      } as Record<string, string>
    )[state] || "待核对"
  );
}
export function sourceFinancialReceiptLabel(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    return "金融导入回执待核对";
  return value
    ? `已确认金融导入回执 ${value} 条`
    : "此清单暂无已确认金融导入回执";
}
export function sourceBlockerLabel(value: unknown) {
  const code =
    value &&
    typeof value === "object" &&
    "code" in value &&
    typeof value.code === "string"
      ? value.code
      : "unknown";
  const labels: Record<string, string> = {
    original_input_missing: "原始输入缺失",
    stored_binary_number_not_original_decimal: "原始十进制数值无法核实",
    stored_number_invalid: "原始数值无效",
    original_revision_unknown: "原版本未知",
    original_timezone_or_instant_unknown: "原时区或发生时间未知",
    actual_fee_authority_unknown: "实际费用依据未知",
    fee_snapshot_authority_mismatch: "费用快照依据不符",
    original_fill_causal_order_unproved: "成交先后依据不足",
    original_position_prefix_inconsistent: "历史持仓链不一致",
    source_current_position_differs_from_original_history:
      "当前持仓与原历史不一致",
    source_owner_identity_not_verified: "来源账号身份未核实",
    source_persistent_dataset_identity_not_verified: "来源数据库身份未核实",
    source_table_coverage_incomplete: "来源数据范围不完整",
    source_iana_timezone_missing: "来源时区缺失",
    source_prefix_conflict: "原有来源历史已变化",
    source_read_or_authorization_changed: "来源读取或授权已变化",
    source_authorization_or_normalization_changed: "来源授权或数据核对未通过",
  };
  return labels[code] || `来源需核对 · ${code}`;
}
export class SourceDownloadError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export async function sourceOriginalBytes(
  id: string,
  digest: string,
  context: { csrf: string; current: () => boolean },
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  if (!sourceUuid(id) || !/^[a-f0-9]{64}$/.test(digest))
    throw new Error("原快照编号或摘要无效");
  const current = () => {
    if (signal.aborted || !context.current())
      throw new Error("页面或登录身份已变化");
  };
  current();
  const response = await fetcher(`/api/legacy-financial/manifests/${id}/raw`, {
    credentials: "same-origin",
    redirect: "error",
    signal,
    headers: { Accept: "application/json", "X-CSRF-Token": context.csrf },
  });
  current();
  if (!response.ok)
    throw new SourceDownloadError(
      response.status,
      "原快照下载失败，请重新核对当前会话",
    );
  if (response.headers.get("X-Alcor-Session-Changed") === "true")
    throw new SourceDownloadError(403, "登录身份已变化");
  const length = response.headers.get("content-length");
  if (
    response.headers.get("etag") !== `"${digest}"` ||
    !length ||
    !/^\d{1,9}$/.test(length) ||
    Number(length) < 1 ||
    Number(length) > 64 * 1024 * 1024 ||
    !response.body
  )
    throw new Error("原快照摘要或长度未通过核对");
  const reader = response.body.getReader(),
    chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      current();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > Number(length)) throw new Error("原快照长度与回执不符");
      chunks.push(new Uint8Array(part.value));
    }
    if (size !== Number(length)) throw new Error("原快照接收不完整");
    current();
    return new Blob(chunks, { type: "application/json" });
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
