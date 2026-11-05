/** Display-only public disclosure observations. No quotes or portfolio calculations. */
const decimalPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
export function disclosedExact(value: unknown) {
  return typeof value === "string" &&
    value.trim() !== "" &&
    decimalPattern.test(value)
    ? value
    : "未知";
}
export function disclosedText(value: unknown) {
  return typeof value === "string" && value.trim() ? value : "未知";
}
function decimal(value: unknown) {
  if (
    typeof value !== "string" ||
    !decimalPattern.test(value) ||
    value.length > 512
  )
    return null;
  const [mantissa, power = "0"] = value.toLowerCase().split("e"),
    exponent = Number(power);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) return null;
  const negative = mantissa.startsWith("-"),
    unsigned = mantissa.replace(/^[+-]/, ""),
    [whole, fraction = ""] = unsigned.split(".");
  return {
    coefficient: BigInt((whole || "0") + fraction) * (negative ? -1n : 1n),
    exponent: exponent - fraction.length,
  };
}
export type DisclosureChart = {
  state: "observed" | "partial" | "unknown" | "unrepresentable" | "invalid";
  path: string;
  dots: { x: number; y: number }[];
  known: number;
  total: number;
};
export function disclosureChart(
  dates: readonly string[],
  values: readonly unknown[],
  now = Date.now(),
): DisclosureChart {
  const result: DisclosureChart = {
    state: "unknown",
    path: "",
    dots: [],
    known: 0,
    total: dates.length,
  };
  if (!dates.length) return result;
  if (dates.length !== values.length) return { ...result, state: "invalid" };
  if (dates.length > 5000) return { ...result, state: "unrepresentable" };
  const times = dates.map((day) =>
    typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)
      ? Date.parse(day + "T00:00:00Z")
      : NaN,
  );
  if (
    times.some(
      (time, index) =>
        !Number.isFinite(time) ||
        dates[index].startsWith("0000-") ||
        time > now ||
        new Date(time).toISOString().slice(0, 10) !== dates[index] ||
        (index > 0 && time <= times[index - 1]),
    )
  )
    return { ...result, state: "invalid" };
  const parsed = values.map(decimal);
  // Unknown/invalid values are gaps; a valid exact value outside the plotting
  // budget stays in the table and must never turn into zero or a flat line.
  if (
    parsed.some(
      (item, index) =>
        item === null && disclosedExact(values[index]) !== "未知",
    )
  )
    return { ...result, state: "unrepresentable" };
  const known = parsed.filter((item) => item !== null);
  if (!known.length) return result;
  const exponent = Math.min(...known.map((item) => item.exponent));
  const scales = new Map<number, bigint>();
  const integers = parsed.map((item) => {
    if (!item) return null;
    const difference = item.exponent - exponent;
    let scale = scales.get(difference);
    if (scale === undefined) {
      scale = 10n ** BigInt(difference);
      scales.set(difference, scale);
    }
    return item.coefficient * scale;
  });
  const actual = integers.filter((item) => item !== null),
    low = actual.reduce((a, b) => (a < b ? a : b)),
    high = actual.reduce((a, b) => (a > b ? a : b));
  let gap = true,
    path = "";
  const dots: { x: number; y: number }[] = [];
  integers.forEach((value, index) => {
    if (value === null) {
      gap = true;
      return;
    }
    const point = {
      x:
        times.length === 1
          ? 300
          : 24 +
            ((times[index] - times[0]) * 552) /
              (times[times.length - 1] - times[0]),
      y:
        high === low
          ? 90
          : 156 -
            (Number(((value - low) * 1000000000n) / (high - low)) /
              1000000000) *
              132,
    };
    path += (gap ? " M " : " L ") + point.x + " " + point.y;
    dots.push(point);
    gap = false;
  });
  return {
    state: actual.length === values.length ? "observed" : "partial",
    path,
    dots,
    known: actual.length,
    total: dates.length,
  };
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function disclosureScope(authority: unknown, detail: unknown) {
  const value = record(detail),
    integrity = record(value.sourceIntegrity),
    evidence = record(value.reportedSourceEvidence),
    coverage = record(evidence.coverage);
  if (
    authority === "registered_disclosure_source_retained_unavailable" ||
    integrity.state === "retained_unavailable"
  )
    return {
      state: "unavailable",
      label:
        "原披露来源当前不可核对；以下为保留的历史登记，不代表当前已核实披露",
    };
  const failures = Array.isArray(coverage.unparsedAccessions)
    ? coverage.unparsedAccessions.length
    : 0;
  if (
    coverage.wholePortfolioKnown === false ||
    coverage.state === "observed_filings_only" ||
    failures
  )
    return {
      state: "partial",
      label:
        "仅已观察的公开申报；完整持仓与交易历史未知" +
        (failures ? " · " + failures + " 份申报未解析" : ""),
    };
  if (authority === "example_data")
    return { state: "sample", label: "示例声明，不是实际账户持仓或收益" };
  return {
    state: "unknown",
    label: "公开登记范围尚未证明完整，不代表该人物全部资产或实际账户收益",
  };
}

/** A declared annual figure is never a calculated account return or a 250-day gain. */
export function disclosureReasonText(value: unknown) {
  const labels: Record<string, string> = {
    dated_return_observations_missing: "未登记带日期的收益观察",
    invalid_or_unordered_observation_date: "部分观察日期无效或顺序待核对",
    return_observation_value_unknown: "部分日期的观察值未知",
    return_series_source_evidence_missing: "观察来源尚未登记",
    disclosure_original_integrity_unavailable: "披露原件当前不可核对",
    synthetic_return_history_not_used: "合成历史不作为实际收益展示",
    actual_portfolio_history_not_registered: "未登记完整账户历史",
  };
  return typeof value === "string" && Object.hasOwn(labels, value)
    ? labels[value]
    : "部分来源仍待核对，详情见来源依据";
}
export function disclosureReturnSummary(value: unknown, historical = false) {
  const source = record(value);
  for (const [key, period] of [
    ["y1", "1年"],
    ["y3", "3年"],
    ["y5", "5年"],
  ] as const) {
    const amount = disclosedExact(source[key]);
    if (amount !== "未知")
      return {
        value: amount,
        label: (historical ? "保留声明" : "原声明") + " · " + period,
      };
  }
  return {
    value: null,
    label:
      Array.isArray(source.dates) && source.dates.length
        ? "查看日期观察"
        : "未登记收益",
  };
}
/** Plot only stated percentages; leave unknown space and reject overfull/negative rings. */
export function disclosedWeightSegments(rows: readonly { weight?: unknown }[]) {
  const parsed = rows.map((row, index) => ({
    index,
    item: decimal(row.weight),
  }));
  if (
    parsed.some(
      (row, index) =>
        !row.item && disclosedExact(rows[index].weight) !== "未知",
    )
  )
    return { segments: [], unfilled: 100, invalid: true };
  const exponent = Math.min(0, ...parsed.map((row) => row.item?.exponent ?? 0));
  const limit = 100n * 10n ** BigInt(-exponent);
  const segments: { index: number; weight: number; offset: number }[] = [];
  let total = 0n;
  for (const { index, item } of parsed) {
    if (!item) continue;
    const exact = item.coefficient * 10n ** BigInt(item.exponent - exponent);
    if (exact < 0n || exact > limit || total + exact > limit)
      return { segments: [], unfilled: 100, invalid: true };
    const scaled = (exact * 1000000n) / limit;
    if (scaled > 0n)
      segments.push({
        index,
        weight: Number(scaled) / 10000,
        offset: Number((total * 1000000n) / limit) / 10000,
      });
    total += exact;
  }
  return {
    segments,
    unfilled: 100 - Number((total * 1000000n) / limit) / 10000,
    invalid: false,
  };
}
