import { dayTime, dateKey } from "./activity.ts";
export type AnalysisPeriod =
  "month" | "1m" | "6m" | "ytd" | "1y" | "retained" | "custom";
export type AnalysisRange = { start: string; through: string; days: number };
const DAY = 86400000;
export function analysisToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) =>
    parts.find((item) => item.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(dayTime(value)) &&
    dateKey(dayTime(value)) === value
  );
}
function monthsBefore(value: string, months: number) {
  const date = new Date(dayTime(value)),
    day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const last = new Date(date);
  last.setUTCMonth(last.getUTCMonth() + 1);
  last.setUTCDate(0);
  date.setUTCDate(Math.min(day, last.getUTCDate()));
  return dateKey(date.getTime());
}
export function analysisRange(
  period: AnalysisPeriod,
  today: string,
  custom: { start: string; through: string },
): AnalysisRange | null {
  if (!validDate(today)) return null;
  const through = period === "custom" ? custom.through : today;
  const start =
    period === "custom"
      ? custom.start
      : period === "month"
        ? today.slice(0, 7) + "-01"
        : period === "ytd"
          ? today.slice(0, 4) + "-01-01"
          : period === "1m"
            ? monthsBefore(today, 1)
            : period === "6m"
              ? monthsBefore(today, 6)
              : period === "1y"
                ? monthsBefore(today, 12)
                : dateKey(dayTime(today) - 7299 * DAY);
  if (
    !validDate(start) ||
    !validDate(through) ||
    start > through ||
    through > today ||
    (dayTime(through) - dayTime(start)) / DAY > 7300
  )
    return null;
  return {
    start,
    through,
    days: Math.max(
      60,
      Math.min(1200, (dayTime(through) - dayTime(start)) / DAY + 1),
    ),
  };
}
export function observedPricePlot(
  points: { d: string; c: string }[],
  range: Pick<AnalysisRange, "start" | "through">,
) {
  if (
    !validDate(range.start) ||
    !validDate(range.through) ||
    range.start > range.through ||
    points.length > 2000
  )
    return null;
  const dates = new Set<string>();
  for (const row of points) {
    const n = Number(row.c);
    if (
      !validDate(row.d) ||
      dates.has(row.d) ||
      row.c.length > 128 ||
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(row.c) ||
      !Number.isFinite(n) ||
      (n === 0 && /[1-9]/.test(row.c.split(/[eE]/)[0]))
    )
      return null;
    dates.add(row.d);
  }
  const selected = points
    .filter((row) => row.d >= range.start && row.d <= range.through)
    .sort((a, b) => a.d.localeCompare(b.d));
  if (!selected.length) return { points: [], path: "" };
  const values = selected.map((row) => Number(row.c)),
    low = Math.min(...values),
    high = Math.max(...values);
  if (!Number.isFinite(high - low)) return null;
  const from = dayTime(range.start),
    duration = dayTime(range.through) - from;
  const plotted = selected.map((row) => ({
    ...row,
    x: duration ? 24 + (552 * (dayTime(row.d) - from)) / duration : 300,
    y: high === low ? 90 : 156 - (132 * (Number(row.c) - low)) / (high - low),
  }));
  return {
    points: plotted,
    path: plotted
      .map(
        (row, index) =>
          `${index === 0 || dayTime(row.d) - dayTime(plotted[index - 1].d) > DAY ? "M" : "L"} ${row.x} ${row.y}`,
      )
      .join(" "),
  };
}
