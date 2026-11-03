export type SourceWindow = {
  state: string;
  notBefore?: string;
  expiresAt?: string;
};
function bounds(window: SourceWindow | undefined) {
  if (!window?.notBefore || !window.expiresAt) return null;
  if (
    ![window.notBefore, window.expiresAt].every((v) =>
      /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(v),
    )
  )
    return null;
  const start = Date.parse(window.notBefore),
    end = Date.parse(window.expiresAt);
  return Number.isFinite(start) && Number.isFinite(end) && start < end
    ? [start, end]
    : null;
}
export function sourceWindowActive(window: SourceWindow | undefined) {
  return window?.state === "active" && bounds(window) !== null;
}
export function sourceWindowLabel(window: SourceWindow | undefined) {
  const labels: Record<string, string> = {
    active: "取数窗口有效",
    expired: "取数窗口已到期",
    revoked: "取数窗口已撤销",
    not_started: "取数窗口尚未开始",
    unknown: "取数窗口未配置",
    unavailable: "取数窗口无法核验",
  };
  const state = window?.state ?? "unknown",
    range = bounds(window);
  let label = labels[state] ?? labels.unavailable;
  if (state === "active" && !range) label = labels.unavailable;
  if (!range) return label;
  const format = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return (
    label +
    " · " +
    format.format(new Date(range[0])) +
    " – " +
    format.format(new Date(range[1]))
  );
}

export function sourceReadFailure(value: string | undefined | null) {
  const labels: Record<string, string> = {
    source_migration_window_expired: "迁移取数窗口已到期",
    source_migration_window_revoked: "迁移取数窗口已撤销",
    source_migration_window_not_started: "迁移取数窗口尚未开始",
    source_migration_window_unknown: "迁移取数窗口未配置或无法核验",
    source_migration_registry_changed: "迁移来源登记已变化，已停止取数",
    source_migration_registry_unavailable: "迁移来源登记无法核验，已停止取数",
  };
  return value ? (labels[value] ?? value) : "来源操作失败";
}
