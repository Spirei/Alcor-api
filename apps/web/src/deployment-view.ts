// Adapted from fire-web/app/deploy-status/page.tsx: status, duration and continuous-year heatmap.
export type WorkflowRun = {
  id: number;
  name: string;
  title: string;
  sha: string;
  status: string;
  conclusion: string | null;
  event: string;
  workflow_path: string;
  started_at: string | null;
  updated_at: string | null;
  url: string;
};
export type BuildStep = {
  number: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
};
export type BuildJob = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  steps: BuildStep[];
};
export type Release = {
  version: string;
  image: string;
  revision: string;
  schema_hash: string;
};
export type Receipt = {
  id: string;
  request_id: string;
  version: string;
  image: string;
  status: string;
  created_at: string;
};
export type Deployment = {
  can_build: boolean;
  build_requests: { request_id: string; status: string; created_at: string }[];
  configured: boolean;
  repository: string;
  package_url: string | null;
  running_version: string;
  running_image: string | null;
  running_revision: string | null;
  matches_release: boolean;
  release: Release | null;
  release_error: string | null;
  build_error: string | null;
  build: (WorkflowRun & { head_sha: string }) | null;
  source: { sha: string; url: string } | null;
  check: WorkflowRun | null;
  source_error: string | null;
  jobs: BuildJob[] | null;
  jobs_error: string | null;
  checked_at: string;
  has_token: boolean;
  schema_compatible: boolean;
  can_update: boolean;
  runner: { online: boolean; observed_at: string } | null;
  receipts: Receipt[];
};
export type Tone = "good" | "bad" | "pending" | "neutral";
export function runState(
  status?: string,
  conclusion?: string | null,
): { label: string; tone: Tone } {
  if (!status) return { label: "待核对", tone: "neutral" };
  if (status !== "completed")
    return {
      label: status === "in_progress" ? "进行中" : "等待中",
      tone: "pending",
    };
  if (conclusion === "success") return { label: "已完成", tone: "good" };
  if (conclusion === "skipped") return { label: "已跳过", tone: "neutral" };
  if (conclusion === "cancelled") return { label: "已取消", tone: "neutral" };
  return { label: "失败", tone: "bad" };
}
export function formatTime(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return (
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(value))
  );
}
export function formatDuration(start?: string | null, end?: string | null) {
  if (
    !start ||
    !end ||
    !Number.isFinite(Date.parse(start)) ||
    !Number.isFinite(Date.parse(end))
  )
    return "—";
  const seconds = Math.max(
    0,
    Math.round((Date.parse(end) - Date.parse(start)) / 1000),
  );
  return seconds < 60
    ? `${seconds} 秒`
    : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
export const workflowLabel = (name: string) =>
  (
    ({
      publish: "构建并发布镜像",
      foundation: "检查",
      "Set up job": "准备任务",
      "Release identity": "核对发布版本",
      "Reuse an existing release for this commit": "检查已有发布",
      "Publish immutable release manifest": "发布镜像清单",
      "Complete job": "完成任务",
      "Build and push": "构建并推送",
      "Run npm ci": "安装前端依赖",
      "Run npm run build": "前端构建",
      "Run uv run pytest -q": "后端检查",
      "Run npm run test:web": "前端检查",
    }) as Record<string, string>
  )[name] || name;
export type HeatView = "day" | "week" | "month" | "total";
export type HeatCell = {
  key: string;
  date: string;
  month: number;
  week: string;
  count: number | null;
  future: boolean;
};
export function heatCells(
  year: number,
  counts: Record<string, number> | null,
  complete: boolean,
  today: string,
): HeatCell[] {
  const first = new Date(Date.UTC(year, 0, 1)),
    last = new Date(Date.UTC(year, 11, 31));
  first.setUTCDate(first.getUTCDate() - first.getUTCDay());
  last.setUTCDate(last.getUTCDate() + 6 - last.getUTCDay());
  const cells: HeatCell[] = [];
  for (let d = new Date(first); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10),
      week = new Date(d);
    week.setUTCDate(week.getUTCDate() - week.getUTCDay());
    const inside = d.getUTCFullYear() === year,
      future = date > today;
    cells.push({
      key: date,
      date: inside ? date : "",
      month: d.getUTCMonth() + 1,
      week: week.toISOString().slice(0, 10),
      future,
      count:
        !inside || future || !counts
          ? null
          : (counts[date] ?? (complete ? 0 : null)),
    });
  }
  return cells;
}
export function selectedHeat(
  cells: HeatCell[],
  cell: HeatCell,
  view: HeatView,
): { count: number | null; partial: boolean } {
  const group = cells.filter(
    (c) =>
      c.date &&
      !c.future &&
      (view === "week"
        ? c.week === cell.week
        : view === "month"
          ? c.month === cell.month
          : view === "total"
            ? c.date <= cell.date
            : c.date === cell.date),
  );
  if (!group.length || group.every((c) => c.count === null))
    return { count: null, partial: true };
  return {
    count: group.reduce((sum, c) => sum + (c.count || 0), 0),
    partial: group.some((c) => c.count === null),
  };
}
