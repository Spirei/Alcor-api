export const brokerCurrencies = [
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
  "MOP",
  "INR",
  "BRL",
  "CHF",
] as const;
export const brokerProviders = [
  { value: "", label: "未指定机构" },
  { value: "longbridge", label: "长桥" },
  { value: "ibkr", label: "盈透" },
  { value: "futu", label: "富途" },
  { value: "tiger", label: "老虎" },
  { value: "trading212", label: "Trading 212" },
  { value: "moomoo", label: "Moomoo" },
  { value: "robinhood", label: "Robinhood" },
  { value: "huatai", label: "华泰" },
  { value: "schwab", label: "嘉信" },
  { value: "usmart", label: "盈立" },
  { value: "eastmoney", label: "东方财富" },
  { value: "ths", label: "同花顺" },
];
export type BrokerAccount = {
  id: string;
  name: string;
  account_kind: "real" | "simulated" | "unknown";
  provider_id: string | null;
  currency: string;
  currencies: string[];
  holding_source: string;
  icon_version?: string | null;
  revision: number;
  currency_usage: {
    complete: boolean;
    used_currencies: string[];
    reference_count: number;
  };
};
export type BrokerDraft = {
  name: string;
  account_kind: string;
  provider_id: string;
  currency: string;
  currencies: string[];
};
export const emptyBrokerDraft = (): BrokerDraft => ({
  name: "",
  account_kind: "",
  provider_id: "",
  currency: "",
  currencies: [],
});
export function brokerDraftFrom(row: BrokerAccount): BrokerDraft {
  if (
    row.holding_source !== "manual" ||
    !Number.isSafeInteger(row.revision) ||
    row.revision < 1 ||
    !Array.isArray(row.currencies) ||
    !row.currencies.includes(row.currency)
  )
    throw Error("账户来源、版本或币种尚未核实");
  return {
    name: row.name,
    account_kind: row.account_kind,
    provider_id: row.provider_id ?? "",
    currency: row.currency,
    currencies: [...row.currencies],
  };
}
export function brokerCommand(
  draft: BrokerDraft,
  id: string,
  existing: BrokerAccount | null,
) {
  const name = draft.name.trim();
  if (!name || name.length > 60 || /[\x00-\x1f\x7f]/.test(name))
    throw Error("请填写有效账户名称");
  if (
    !brokerCurrencies.includes(
      draft.currency as (typeof brokerCurrencies)[number],
    ) ||
    !draft.currencies.includes(draft.currency) ||
    new Set(draft.currencies).size !== draft.currencies.length ||
    draft.currencies.some(
      (value) =>
        !brokerCurrencies.includes(value as (typeof brokerCurrencies)[number]),
    )
  )
    throw Error("请选择默认币种及支持币种");
  const common = {
    request_id: id,
    name,
    currency: draft.currency,
    currencies: [...draft.currencies],
  };
  if (existing) {
    brokerDraftFrom(existing);
    return { ...common, revision: existing.revision };
  }
  if (
    !["real", "simulated"].includes(draft.account_kind) ||
    !brokerProviders.some((value) => value.value === draft.provider_id)
  )
    throw Error("请选择账户类型和机构");
  return {
    ...common,
    account_kind: draft.account_kind,
    provider_id: draft.provider_id || null,
  };
}
export function currencyRemovalBlocked(
  row: BrokerAccount | null,
  currency: string,
) {
  return (
    !!row &&
    (row.currency_usage.used_currencies.includes(currency) ||
      (!row.currency_usage.complete && row.currencies.includes(currency)))
  );
}
export function brokerCurrencyStatus(value: {
  complete: boolean;
  balance: string | null;
  opening?: unknown;
}) {
  return value.complete ? "已核实" : value.opening ? "待核实" : "期初未登记";
}
