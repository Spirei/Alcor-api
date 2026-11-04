/** Display preferences only. Amounts and observed ratios remain separate. */
export const defaultFxOrder = [
  "USD",
  "EUR",
  "HKD",
  "CNY",
  "JPY",
  "KRW",
  "SGD",
  "GBP",
  "AUD",
  "CAD",
  "TWD",
  "CHF",
  "INR",
  "BRL",
];
export function currencyCodes(
  value: unknown,
  fallback: string[] = [],
): string[] {
  return Array.isArray(value) &&
    value.length <= 64 &&
    value.every((v) => typeof v === "string" && /^[A-Z]{3}$/.test(v))
    ? [...new Set(value)]
    : [...fallback];
}
export const currencyInfo: Record<
  string,
  { name: string; country: string; symbol: string }
> = {
  USD: { name: "美元", country: "US", symbol: "$" },
  EUR: { name: "欧元", country: "EU", symbol: "€" },
  HKD: { name: "港元", country: "HK", symbol: "HK$" },
  CNY: { name: "人民币", country: "CN", symbol: "¥" },
  JPY: { name: "日元", country: "JP", symbol: "¥" },
  KRW: { name: "韩元", country: "KR", symbol: "₩" },
  SGD: { name: "新加坡元", country: "SG", symbol: "S$" },
  GBP: { name: "英镑", country: "GB", symbol: "£" },
  AUD: { name: "澳元", country: "AU", symbol: "A$" },
  CAD: { name: "加元", country: "CA", symbol: "C$" },
  TWD: { name: "新台币", country: "TW", symbol: "NT$" },
  CHF: { name: "瑞士法郎", country: "CH", symbol: "Fr." },
  INR: { name: "印度卢比", country: "IN", symbol: "₹" },
  BRL: { name: "巴西雷亚尔", country: "BR", symbol: "R$" },
  NZD: { name: "新西兰元", country: "NZ", symbol: "NZ$" },
  THB: { name: "泰铢", country: "TH", symbol: "฿" },
  MOP: { name: "澳门元", country: "MO", symbol: "MOP$" },
  MYR: { name: "马来西亚林吉特", country: "MY", symbol: "RM" },
};
/** Group the original decimal string without converting precise digits into a float. */
export function formatFxAmount(value: string): string {
  const [whole, fraction] = value.split(".");
  return (
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
    (fraction ? "." + fraction : "")
  );
}

/** Preserve invalid numeric text so it is rejected rather than silently changed. */
export function fxInput(raw: string): string {
  return /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?$/.test(raw.trim())
    ? raw.trim().replaceAll(",", "") : raw.trim();
}
/** Currency presentation rounds decimal strings with integers, never IEEE-754 amounts. */
export function formatFxCurrency(value: string, code: string): string {
  if (!/^[+-]?\d{1,40}(?:\.\d{0,12})?$/.test(value)) return value;
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^[+-]/, "").split(".");
  const digits = code === "JPY" || code === "KRW" ? 0 : BigInt(whole) > 0n ? 2 : 4;
  const scale = 10n ** BigInt(digits);
  const decimal = (fraction + "0".repeat(digits)).slice(0, digits);
  const rounded = BigInt(whole) * scale + BigInt(decimal || "0") + (Number(fraction[digits] || "0") >= 5 ? 1n : 0n);
  const result = (negative && rounded !== 0n ? "-" : "") + (rounded / scale).toString() +
    (digits ? "." + (rounded % scale).toString().padStart(digits, "0") : "");
  return formatFxAmount(result);
}
