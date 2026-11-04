export type ObservedRates = {
  base: string;
  rates: Record<string, string>;
  quoted: string[];
  exactRatios?: Record<string, { numerator: string; denominator: string }>;
  roundedCurrencies?: string[];
  quarantined?: boolean;
};
type Ratio = { n: bigint; d: bigint };
function decimal(value: string): Ratio | null {
  if (!/^[+-]?\d{1,30}(?:\.\d{0,12})?$/.test(value)) return null;
  const sign = value.startsWith("-") ? -1n : 1n;
  const [whole, fraction = ""] = value.replace(/^[+-]/, "").split(".");
  return {
    n: sign * BigInt(whole + fraction),
    d: 10n ** BigInt(fraction.length),
  };
}
function observed(data: ObservedRates, code: string): Ratio | null {
  if (code === data.base && /^[A-Z]{3}$/.test(code)) return { n: 1n, d: 1n };
  if (!data.quoted.includes(code)) return null;
  const exact = data.exactRatios?.[code];
  if (exact) {
    if (
      !/^\d{1,80}$/.test(exact.numerator) ||
      !/^\d{1,80}$/.test(exact.denominator)
    )
      return null;
    const n = BigInt(exact.numerator),
      d = BigInt(exact.denominator);
    return n > 0n && d > 0n ? { n, d } : null;
  }
  const ratio = decimal(data.rates[code] ?? "");
  return ratio && ratio.n > 0n ? ratio : null;
}
/** Read-only display conversion, using observed ratios only; never a financial write authority. */
export function convertObservedFx(
  amount: string,
  from: string,
  to: string,
  data: ObservedRates,
): { value: string; approximate: boolean } | null {
  const input = decimal(amount.trim());
  if (
    (data.quarantined && from !== to) ||
    !input ||
    !/^[A-Z]{3}$/.test(from) ||
    !/^[A-Z]{3}$/.test(to)
  )
    return null;
  const a = from === to ? { n: 1n, d: 1n } : observed(data, from),
    b = from === to ? { n: 1n, d: 1n } : observed(data, to);
  if (!a || !b) return null;
  const n = input.n * b.n * a.d,
    d = input.d * b.d * a.n,
    negative = n < 0n,
    abs = negative ? -n : n;
  const scaled = abs * 1000000n,
    rounded = (scaled + d / 2n) / d,
    whole = rounded / 1000000n,
    fraction = (rounded % 1000000n)
      .toString()
      .padStart(6, "0")
      .replace(/0+$/, "");
  return {
    value:
      (negative && rounded !== 0n ? "-" : "") +
      whole.toString() +
      (fraction ? "." + fraction : ""),
    approximate:
      scaled % d !== 0n ||
      !!data.roundedCurrencies?.some((c) => c === from || c === to),
  };
}
