import {
  add,
  amountIn,
  annual,
  decimal,
  negate,
  object,
  performance,
  rows,
  sum,
  text,
  type Row,
} from "./simple-app-model";

/** Presentation uses the same declared ledger; no rates, cash flows or history are inferred. */
export function budgetSummary(ledger: Row) {
  const cf = object(ledger.cashflow),
    currency = text(cf.currency).trim();
  const total = (key: string) => {
    const source = cf[key],
      list = rows(source);
    return currency &&
      Array.isArray(source) &&
      list.length > 0 &&
      list.length === source.length
      ? sum(list.map(annual))
      : null;
  };
  const income = total("incomeItems"),
    expense = total("expenseItems");
  return { currency, income, expense, surplus: add(income, negate(expense)) };
}
export function declaredInvestmentPnl(
  ledger: Row,
  currency: string,
): string | null {
  if (
    !Array.isArray(ledger.invest) ||
    rows(ledger.invest).length !== ledger.invest.length
  )
    return null;
  const list = rows(ledger.invest).filter((row) => row.archived !== true);
  if (!list.length) return null;
  return sum(
    list.map((row) =>
      amountIn(
        {
          ...row,
          amount: add(
            decimal(row.amount),
            negate(add(decimal(row.inAmt), negate(decimal(row.outAmt)))),
          ),
        },
        ledger,
        currency,
      ),
    ),
  );
}
/** Separate account IRRs are not a combined portfolio IRR. */
export function declaredInvestmentAnnual(ledger: Row): string | null {
  if (
    !Array.isArray(ledger.invest) ||
    rows(ledger.invest).length !== ledger.invest.length
  )
    return null;
  const active = rows(ledger.invest).filter((row) => row.archived !== true);
  if (active.length !== 1) return null;
  const row = active[0];
  return performance(
    rows(row.hist),
    row.historyComplete === true &&
      Array.isArray(row.hist) &&
      rows(row.hist).length === row.hist.length,
  ).annual;
}
/** Group exact decimal text without converting original monetary values to binary floats. */
export function displayDecimal(value: string | null) {
  if (value === null) return "待完善";
  const [whole, fraction] = value.split(".");
  return (
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
    (fraction ? "." + fraction : "")
  );
}
export const ledgerSection = (page: string, account = "") =>
  ["invest", "addInvest", "account", "summary", "addSummary"].includes(page) ||
  (page === "settings" && account)
    ? "invest"
    : ["family", "update", "addItem", "editItem"].includes(page)
      ? "family"
      : page === "cashflow"
        ? "cashflow"
        : "home";

/** Round presentation ratios only; source amounts and the derived precision remain unchanged. */
export function displayRatio(value: string | null, places = 2) {
  if (value === null) return "未知";
  const negative = value.startsWith("-"),
    [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const digits = fraction.padEnd(places + 1, "0"),
    scale = 10n ** BigInt(places);
  let rounded = BigInt(whole) * scale + BigInt(digits.slice(0, places) || "0");
  if (digits[places] >= "5") rounded++;
  const out = rounded.toString().padStart(places + 1, "0"),
    raw = places ? out.slice(0, -places) + "." + out.slice(-places) : out;
  return (
    "约 " +
    (negative && rounded ? "-" : "") +
    raw.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
  );
}

/** Owner observations use actual calendar days, independent of exchange trading calendars. */
export function ledgerMonthCells(month: string): (string | null)[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith("0000"))
    return [];
  const first = new Date(month + "-01T00:00:00Z"),
    next = new Date(first);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const days = Math.round((next.getTime() - first.getTime()) / 86400000),
    offset = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) =>
    i >= offset && i < offset + days
      ? month + "-" + String(i - offset + 1).padStart(2, "0")
      : null,
  );
}
export function shiftLedgerMonth(month: string, offset: number) {
  if (!ledgerMonthCells(month).length) return month;
  const value = new Date(month + "-01T00:00:00Z");
  value.setUTCMonth(value.getUTCMonth() + offset);
  const result = value.toISOString().slice(0, 7);
  return ledgerMonthCells(result).length ? result : month;
}
