import { financingConfirmation } from "./financing-state.ts";
export type CashReceiptLocator = {
  kind: "cash" | "trade" | "financial_import";
  requestId: string;
};
export function cashReceiptPath(value: CashReceiptLocator) {
  if (
    !["cash", "trade", "financial_import"].includes(value.kind) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value.requestId,
    )
  )
    throw Error("原请求回执标识无效");
  return `${{ cash: "/cash", trade: "/trading", financial_import: "/financial-import" }[value.kind]}/operations/${value.requestId}`;
}
export type CashEntry = {
  receipt?: CashReceiptLocator | null;
  id: string;
  requestId: string;
  kind: string;
  currency: string;
  registeredAmount: string;
  occurredAt: string;
  createdAt: string;
  note: string;
  affectsOwnerCash: boolean;
  sourceTradeId: string | null;
  feeAuthority: string | null;
  actualFeeKnown: boolean | null;
};
export type CashEntries = {
  accountId: string;
  accountKind: string;
  coverageScope: "platform_registered_entries_only";
  revision: number;
  total: number;
  nextOffset: number | null;
  items: CashEntry[];
};
export const cashKinds: Record<string, string> = {
  opening: "期初",
  allocation: "原资金分配",
  external_deposit: "外部入金",
  external_withdrawal: "外部出金",
  reconcile_balance: "余额核对",
  trade_buy: "买入结算",
  trade_sell: "卖出结算",
  trade_dividend: "股息结算",
  fee_correction: "费用更正",
  trade_correction: "成交更正",
};
export function entriesPath(
  account: string,
  currency: string,
  offset: number,
  revision: number,
) {
  if (
    !account ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  )
    throw Error("现金流水版本未知，请重新读取");
  return `/cash/accounts/${encodeURIComponent(account)}/entries?limit=25&offset=${offset}&revision=${revision}${currency ? `&currency=${encodeURIComponent(currency)}` : ""}`;
}
export function cashCommand(
  account:
    | {
        id: string;
        account_kind: string;
        holding_source: string;
        currencies?: string[];
        currency: string;
      }
    | undefined,
  draft: {
    action: string;
    openingBasis: string;
    amount: string;
    currency: string;
    occurredAt: string;
    note: string;
    evidenceReference?: string;
    evidenceObservedAt?: string;
    financingConfirmed?: boolean;
    financingStatement?: string;
  },
  requestId: string,
) {
  if (
    !account ||
    account.holding_source !== "manual" ||
    !["real", "simulated"].includes(account.account_kind)
  )
    throw Error("请选择来源已核实的手工账户");
  if (
    ![
      "opening",
      "external_deposit",
      "external_withdrawal",
      "reconcile_balance",
    ].includes(draft.action)
  )
    throw Error("请选择现金操作");
  if (!(account.currencies ?? [account.currency]).includes(draft.currency))
    throw Error("请选择本账户币种");
  if (!draft.amount.trim()) throw Error("请填写实际金额");
  if (
    draft.action === "reconcile_balance" &&
    draft.amount.trim().startsWith("-") &&
    !draft.financingConfirmed
  )
    throw Error("负余额须先明确核实实际融资或原余额依据");
  if (!draft.occurredAt || !Number.isFinite(Date.parse(draft.occurredAt)))
    throw Error("请填写实际发生时间");
  if (
    draft.action === "opening" &&
    ![
      "new_external_opening",
      "allocate_verified_unallocated_checkpoint",
    ].includes(draft.openingBasis)
  )
    throw Error("请明确期初来源");
  const evidenceReference = draft.evidenceReference?.trim() || "";
  const evidenceObservedAt = draft.evidenceObservedAt || "";
  if (draft.action === "reconcile_balance" && (evidenceReference || evidenceObservedAt) && (!evidenceReference || !evidenceObservedAt || !Number.isFinite(Date.parse(evidenceObservedAt))))
    throw Error("请完整填写本人余额核对依据与观察时间");
  return {
    requestId,
    accountId: account.id,
    accountKind: account.account_kind,
    currency: draft.currency,
    action: draft.action,
    amount: draft.amount,
    occurredAt: new Date(draft.occurredAt).toISOString(),
    note: draft.note,
    ...(draft.action === "reconcile_balance" && evidenceReference ? { evidence: { reference: evidenceReference, observedAt: new Date(evidenceObservedAt).toISOString() } } : {}),
    openingBasis: draft.action === "opening" ? draft.openingBasis : null,
    ...(draft.action === "reconcile_balance" && draft.financingConfirmed
      ? {
          allowNegativeBalance: true,
          financingConfirmation: financingConfirmation(
            true,
            draft.financingStatement ?? "",
          ),
        }
      : {}),
  };
}
