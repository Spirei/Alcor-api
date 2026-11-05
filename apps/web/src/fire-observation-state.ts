import { dayTime, dateKey } from "./activity.ts";

export type FireObservation = {
  recordedAt: string;
  date: string;
  amountBase: string;
  amountUsd: string;
  currency: string;
};
export type ObservationPeriod = "day" | "week" | "month" | "total";
export function observationDate(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return null;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (name: string) =>
    parts.find((item) => item.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function amount(value: unknown) {
  return typeof value === "string"
    ? value
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : "";
}
/** Original observations are never converted into prices, returns or implied zeroes. */
export function fireObservations(history: unknown[]) {
  const records: FireObservation[] = [];
  let invalid = 0;
  for (const raw of history) {
    const row =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const date = observationDate(row.recordedAt);
    if (!date) {
      invalid++;
      continue;
    }
    records.push({
      recordedAt: row.recordedAt as string,
      date,
      amountBase: amount(row.amountBase),
      amountUsd: amount(row.amountUsd),
      currency: typeof row.currency === "string" ? row.currency : "",
    });
  }
  records.sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  return { records, invalid };
}
export function observationRange(
  records: FireObservation[],
  selected: string,
  period: ObservationPeriod,
) {
  const stamp = dayTime(selected);
  if (!Number.isFinite(stamp)) return [];
  const week = stamp - ((new Date(stamp).getUTCDay() + 6) % 7) * 86400000;
  return records.filter((row) =>
    period === "day"
      ? row.date === selected
      : period === "week"
        ? row.date >= dateKey(week) && row.date <= dateKey(week + 6 * 86400000)
        : period === "month"
          ? row.date.slice(0, 7) === selected.slice(0, 7)
          : row.date <= selected,
  );
}
