type Store = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
const prefix = "alcor.fire-request:",
  uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const fireCurrencies = [
  "USD",
  "HKD",
  "CNY",
  "SGD",
  "JPY",
  "KRW",
  "EUR",
] as const;
export const fireFields = [
  { key: "fireTargetBase", label: "目标资产", numeric: true },
  { key: "currentInput", label: "当前资产（手填）" },
  { key: "passiveInput", label: "被动收入（手填）" },
  { key: "originalInput", label: "原始资产（手填）" },
  { key: "yearsInput", label: "还需年数（手填）" },
  { key: "annualExpense", label: "年支出", numeric: true },
  { key: "withdrawalRate", label: "提款率（%）", numeric: true },
  { key: "annualReturn", label: "预期年化回报（%）", numeric: true },
  { key: "inflation", label: "预期通胀（%）", numeric: true },
  { key: "savingsRate", label: "储蓄率（%）", numeric: true },
] as const;
export const rowFields = [
  { key: "original", label: "原始资产" },
  { key: "extra", label: "追加投入" },
  { key: "current", label: "当前资产" },
  { key: "profit", label: "盈利总额" },
  { key: "rate", label: "收益率（%）" },
  { key: "target", label: "目标资产" },
  { key: "progress", label: "进度（%）" },
] as const;
export type Fire = Record<string, unknown>;
export type FireChanges = {
  fields: Record<string, string>;
  rows: Record<string, Record<string, string>>;
  added: number[];
  removed: number[];
};
export const emptyFireChanges = (): FireChanges => ({
  fields: {},
  rows: {},
  added: [],
  removed: [],
});
export function fireYear(date = new Date()) {
  return Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
    }).format(date),
  );
}
export function fireText(value: unknown): string {
  return typeof value === "string"
    ? value
    : typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : "";
}
export function fireRows(fire: Fire): Record<string, unknown>[] {
  return Array.isArray(fire.tableRows)
    ? fire.tableRows.filter(
        (r): r is Record<string, unknown> =>
          !!r &&
          typeof r === "object" &&
          !Array.isArray(r) &&
          ["number", "string"].includes(typeof r.year) &&
          Number.isSafeInteger(Number(r.year)) &&
          Number(r.year) > 0,
      )
    : [];
}
export function fireCurrencyLocked(fire: Fire, year: number) {
  return (
    Array.isArray(fire.tableRows) &&
    fire.tableRows.some(
      (r) =>
        !!r &&
        typeof r === "object" &&
        !Array.isArray(r) &&
        ["number", "string"].includes(typeof r.year) &&
        Number.isFinite(Number(r.year)) &&
        Number(r.year) < year,
    )
  );
}
function normalized(value: string) {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(value);
  if (!match || !(match[2] || match[3])) throw new Error("请输入有效数字");
  let digits = (match[2] + (match[3] ?? "")).replace(/^0+/, "");
  let scale = (match[3]?.length ?? 0) - Number(match[4] ?? 0);
  while (digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    scale--;
  }
  return digits ? (match[1] === "-" ? "-" : "") + digits + ":" + scale : "0";
}
export function fireNumber(raw: string) {
  const text = raw.trim();
  if (!text || text.length > 128) throw new Error("请输入有效数字");
  const value = Number(text);
  if (!Number.isFinite(value) || normalized(text) !== normalized(String(value)))
    throw new Error("数值或精度超出可保存范围");
  return value;
}
export function buildFire(
  stored: Fire,
  changes: FireChanges,
  year: number,
): Fire {
  const result = { ...stored };
  for (const field of fireFields) {
    if (!(field.key in changes.fields)) continue;
    const raw = changes.fields[field.key].trim();
    if ("numeric" in field && field.numeric) {
      if (raw === "") delete result[field.key];
      else result[field.key] = fireNumber(raw);
    } else {
      if (raw !== "") fireNumber(raw);
      result[field.key] = raw;
    }
  }
  const locked = fireCurrencyLocked(stored, year);
  if ("baseCurrency" in changes.fields && !locked) {
    const currency = changes.fields.baseCurrency;
    if (!fireCurrencies.includes(currency as (typeof fireCurrencies)[number]))
      throw new Error("请选择规划币种");
    result.baseCurrency = currency;
  }
  if (locked) {
    if (Object.hasOwn(stored, "baseCurrency"))
      result.baseCurrency = stored.baseCurrency;
    else delete result.baseCurrency;
  }
  const existing = Array.isArray(stored.tableRows) ? stored.tableRows : [],
    seen = new Set<number>();
  result.tableRows = existing
    .filter((r) => {
      const v = r as Record<string, unknown> | null;
      return (
        !v ||
        typeof v !== "object" ||
        Number(v.year) <= year ||
        !changes.removed.includes(Number(v.year))
      );
    })
    .map((r) => {
      if (!r || typeof r !== "object" || Array.isArray(r)) return r;
      const old = r as Record<string, unknown>,
        y = Number(old.year),
        duplicate = seen.has(y);
      seen.add(y);
      if (!Number.isSafeInteger(y) || y < year) return old;
      const patch = changes.rows[String(y)];
      if (!patch) return old;
      if (duplicate) throw new Error("年度记录重复，请先核对");
      return {
        ...old,
        ...Object.fromEntries(
          Object.entries(patch).map(([k, v]) => {
            if (v.trim() !== "") fireNumber(v);
            return [k, v.trim()];
          }),
        ),
      };
    });
  for (const y of changes.added) {
    if (!Number.isSafeInteger(y) || y < year || y > 9999 || seen.has(y))
      throw new Error("年份重复或已结束");
    const row: Record<string, unknown> = { year: y };
    for (const key of rowFields) {
      const v = changes.rows[String(y)]?.[key.key] ?? "";
      if (v.trim() !== "") fireNumber(v);
      row[key.key] = v.trim();
    }
    (result.tableRows as unknown[]).push(row);
    seen.add(y);
  }
  const units = fireText(result.baseCurrency);
  const amountFields = [
    "fireTargetBase",
    "currentInput",
    "passiveInput",
    "originalInput",
    "annualExpense",
  ];
  if (
    (amountFields.some(
      (k) =>
        Object.hasOwn(changes.fields, k) && changes.fields[k].trim() !== "",
    ) ||
      changes.added.length ||
      Object.keys(changes.rows).length) &&
    !fireCurrencies.includes(units as (typeof fireCurrencies)[number])
  )
    throw new Error(
      locked ? "历史规划币种缺失，金额暂无法确认" : "请选择规划币种",
    );
  return result;
}
export function fireAsset(amount: string, usd: string, currency: string) {
  if (!fireCurrencies.includes(currency as (typeof fireCurrencies)[number]))
    throw new Error("请选择观察币种");
  const amountBase = fireNumber(amount),
    amountUsd = currency === "USD" ? amountBase : fireNumber(usd);
  if (
    amountBase <= 0 ||
    amountUsd <= 0 ||
    amountBase > 1e15 ||
    amountUsd > 1e15
  )
    throw new Error("请输入有效的资产观察金额");
  return { amountBase, amountUsd, currency };
}
export function clearFireRequests(s: Store, keep?: string) {
  for (const k of Array.from({ length: s.length }, (_, i) => s.key(i)))
    if (k?.startsWith(prefix) && k !== prefix + keep) s.removeItem(k);
}
export function readFireRequest(s: Store, scope: string) {
  clearFireRequests(s, scope);
  const id = s.getItem(prefix + scope);
  if (id !== null && !uuid.test(id)) throw new Error("原操作编号无法读取");
  return id;
}
export function retainFireRequest(s: Store, scope: string, id: string) {
  if (!uuid.test(id)) throw new Error("原操作编号无效");
  const prior = readFireRequest(s, scope);
  if (prior && prior !== id) throw new Error("请先核对原操作");
  s.setItem(prefix + scope, id);
}
export function releaseFireRequest(s: Store, scope: string, id: string) {
  if (s.getItem(prefix + scope) === id) s.removeItem(prefix + scope);
}
export type FireReceipt = {
  ok: true;
  requestId: string;
  state: "completed";
  revision: number;
  assetHistory: unknown[];
};
export function fireReceipt(value: unknown, id: string): FireReceipt {
  const v = value as Partial<FireReceipt> | null;
  if (
    !v ||
    v.requestId !== id ||
    v.ok !== true ||
    v.state !== "completed" ||
    !Number.isSafeInteger(v.revision) ||
    Number(v.revision) < 1 ||
    !Array.isArray(v.assetHistory)
  )
    throw new Error("原规划回执不符，请继续核对");
  return v as FireReceipt;
}
