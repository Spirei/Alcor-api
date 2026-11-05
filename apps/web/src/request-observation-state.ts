export type RequestObservation = {
  id: number;
  at: number;
  path: string;
  method: string;
  source: string;
  status: number;
  duration: number;
};
export type RequestSnapshot = {
  localCollector: {
    running: boolean;
    buffered: number;
    storageAvailable: boolean | null;
    scope: "this_process";
  };
  revision: number;
  aggregateRevision: number;
  summary: {
    total: number;
    errors: number;
    serverErrors: number;
    averageMs: number;
    sources: Record<string, number>;
  };
  logs: RequestObservation[];
  pagination: { page: number; pageSize: number; total: number; anchor: number };
  detailGap: boolean;
  rollupPending: boolean;
  observedOnly: boolean;
  lostBuffered: number;
  crashLossKnown: boolean;
  legacyImport: {
    detailRows: number;
    dailyCells: number;
    hourCells: number;
    historicalCoverageKnown: false;
    hourDurationKnown: false;
  };
  chart: { key: string; count: number; errors: number }[];
  chartUnit: string;
  endpoints: {
    path: string;
    method: string;
    count: number;
    errors: number;
    averageMs: number;
  }[];
  heatmap: Record<string, number>;
};
export function requestSnapshot(value: unknown): RequestSnapshot {
  if (!value || typeof value !== "object") throw new Error("请求记录无效");
  const row = value as RequestSnapshot;
  if (
    row.observedOnly !== true ||
    !Number.isSafeInteger(row.revision) ||
    !Number.isSafeInteger(row.aggregateRevision) ||
    row.aggregateRevision > row.revision ||
    !Array.isArray(row.logs) ||
    !Array.isArray(row.chart) ||
    !Array.isArray(row.endpoints) ||
    !row.pagination ||
    !row.summary ||
    !row.heatmap ||
    !row.legacyImport ||
    row.legacyImport.historicalCoverageKnown !== false ||
    row.legacyImport.hourDurationKnown !== false ||
    !Number.isSafeInteger(row.legacyImport.detailRows) ||
    row.legacyImport.detailRows < 0 ||
    !Number.isSafeInteger(row.legacyImport.dailyCells) ||
    row.legacyImport.dailyCells < 0 ||
    !Number.isSafeInteger(row.legacyImport.hourCells) ||
    row.legacyImport.hourCells < 0
  )
    throw new Error("请求记录无效");
  if (
    row.logs.some(
      (log) =>
        !Number.isSafeInteger(log.id) ||
        typeof log.path !== "string" ||
        !log.path.startsWith("/api/") ||
        !Number.isFinite(log.duration) ||
        !Number.isFinite(log.at),
    )
  )
    throw new Error("请求记录无效");
  return row;
}

export function legacyImportLabel(
  value: RequestSnapshot["legacyImport"],
): string {
  if (
    value.historicalCoverageKnown !== false ||
    value.hourDurationKnown !== false ||
    value.detailRows < 0 ||
    value.dailyCells < 0 ||
    value.hourCells < 0
  )
    throw new Error("请求导入状态无效");
  if (value.detailRows === 0 && value.dailyCells === 0 && value.hourCells === 0)
    return "旧请求历史尚未导入";
  const parts = [];
  if (value.detailRows) parts.push(`明细 ${value.detailRows} 条`);
  if (value.dailyCells) parts.push(`日汇总 ${value.dailyCells} 格`);
  if (value.hourCells) parts.push(`小时汇总 ${value.hourCells} 格，不含时长`);
  return `已单独导入${parts.join("、")}，未计入本次汇总；历史是否完整尚未核对`;
}

export function requestObservationFilters(search: string) {
  const p = new URLSearchParams(search);
  const choice = (key: string, values: readonly string[], fallback: string) => {
    const value = p.get(key);
    return value && values.includes(value) ? value : fallback;
  };
  const integer = (key: string, fallback: number) => {
    const raw = p.get(key) || "";
    const value = /^\d{1,16}$/.test(raw) ? Number(raw) : NaN;
    return Number.isSafeInteger(value) && value >= fallback ? value : fallback;
  };
  return {
    period: choice("rPeriod", ["today", "7d", "30d"], "today"),
    status: choice(
      "rStatus",
      ["all", "success", "4xx", "5xx", "cancelled"],
      "all",
    ),
    source: choice("rSource", ["all", "web", "ios", "app", "other"], "all"),
    method: choice(
      "rMethod",
      [
        "all",
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "HEAD",
        "OPTIONS",
        "OTHER",
      ],
      "all",
    ),
    query: (p.get("rQ") || "").slice(0, 120),
    page: integer("rPage", 1),
    anchor: integer("rAnchor", 0),
  };
}
export function requestObservationSearch(
  search: string,
  patch: Partial<ReturnType<typeof requestObservationFilters>>,
) {
  const p = new URLSearchParams(search),
    next = { ...requestObservationFilters(search), ...patch },
    defaults = requestObservationFilters("");
  for (const key of Object.keys(defaults)) {
    const value = next[key as keyof typeof next];
    const parameter = (
      {
        period: "rPeriod",
        status: "rStatus",
        source: "rSource",
        method: "rMethod",
        query: "rQ",
        page: "rPage",
        anchor: "rAnchor",
      } as Record<string, string>
    )[key];
    if (value === defaults[key as keyof typeof defaults]) p.delete(parameter);
    else p.set(parameter, String(value));
  }
  return p.toString();
}
