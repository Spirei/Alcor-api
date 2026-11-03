export type MigrationWorkState =
  "working" | "verifying" | "waiting" | "blocked" | "idle" | "complete";
export type MigrationWorkStatus = {
  schema_version: 1;
  state: MigrationWorkState;
  feature_id: string | null;
  step: string;
  updated_at: string;
  summary: string;
  sequence: number;
  source_commit?: string;
  stale?: boolean;
};
const states = new Set<MigrationWorkState>([
  "working",
  "verifying",
  "waiting",
  "blocked",
  "idle",
  "complete",
]);
const text = (value: unknown, limit: number) =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim()
        .slice(0, limit)
    : "";
export function parseMigrationWorkStatus(
  value: unknown,
): MigrationWorkStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const row =
    raw.schemaVersion === 1
      ? {
          ...raw,
          schema_version: raw.schemaVersion,
          feature_id: raw.featureId,
          updated_at: raw.updatedAt,
          source_commit: raw.sourceCommit,
        }
      : raw;
  if (
    row.schema_version !== 1 ||
    !states.has(row.state as MigrationWorkState) ||
    !Number.isSafeInteger(row.sequence) ||
    (row.sequence as number) < 0 ||
    typeof row.updated_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      row.updated_at,
    ) ||
    !Number.isFinite(Date.parse(row.updated_at))
  )
    return null;
  const feature =
    typeof row.feature_id === "string" && /^F\d{2}$/.test(row.feature_id)
      ? row.feature_id
      : null;
  const commit =
    typeof row.source_commit === "string" &&
    /^[a-f0-9]{7,40}$/.test(row.source_commit)
      ? row.source_commit
      : undefined;
  return {
    schema_version: 1,
    state: row.state as MigrationWorkState,
    feature_id: feature,
    step: text(row.step, 200),
    summary: text(row.summary, 400),
    updated_at: row.updated_at,
    sequence: row.sequence as number,
    stale: row.stale === true,
    ...(commit ? { source_commit: commit } : {}),
  };
}
export function migrationWorkPresentation(
  status: MigrationWorkStatus | null,
  now: number,
  connected: boolean,
) {
  if (!status)
    return {
      animated: false,
      label: connected ? "尚无工作状态" : "工作状态连接中断",
    };
  if (!connected) return { animated: false, label: "工作状态连接中断" };
  const age = now - Date.parse(status.updated_at);
  if (status.stale || age < -5000 || age > 120000)
    return { animated: false, label: "更新中断" };
  const labels: Record<MigrationWorkState, string> = {
    working: "正在迁移",
    verifying: "正在验证",
    waiting: "等待中",
    blocked: "已阻塞",
    idle: "空闲",
    complete: "本次工作完成",
  };
  return {
    animated: status.state === "working" || status.state === "verifying",
    label: labels[status.state],
  };
}
