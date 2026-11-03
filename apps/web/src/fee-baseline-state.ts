export type StoredCell = { text?: string; null?: boolean };
type RawRow = Record<string, StoredCell>;
export type RawFinancialSnapshot = {
  tables: Record<string, { present: boolean; rows: RawRow[] }>;
};
export type SourceOrder = {
  id: string | null;
  code: string | null;
  market: string | null;
  quantity: string | null;
  registeredFee: string | null;
  status: string | null;
  occurredAt: string | null;
  actualFeeKnown: boolean | null;
};
export type BaselineSource = {
  manifestId: string;
  manifestSha256: string;
  sourceOwner: string;
  timezone: string | null;
  ordersKnown: boolean;
  orders: SourceOrder[];
};
export type EstimateHead = {
  brokerAccountId: string;
  revision: number;
  requestId: string | null;
};
export type BaselineTarget = {
  orderId: string;
  recordId: string;
  code: string | null;
  qty: string | null;
  recordRevision: number | null;
  actualFeeKnown?: boolean;
  status?: string;
};
export type BaselineDraft = {
  originalId: string;
  targetId: string;
  instrumentKind: string;
  registeredConfirmed: boolean;
  estimatedOnly: boolean;
};
export const emptyBaselineDraft = (): BaselineDraft => ({
  originalId: "",
  targetId: "",
  instrumentKind: "unknown",
  registeredConfirmed: false,
  estimatedOnly: false,
});
function text(row: RawRow, key: string) {
  return row[key]?.null ? null : (row[key]?.text ?? null);
}
export function baselineSource(
  manifestId: string,
  manifestSha256: string,
  manifest: {
    source: { owner: string; timezone: string | null };
    orderFacts: Record<
      string,
      { registeredFee?: string | null; actualFeeKnown?: boolean }
    >;
  },
  raw: RawFinancialSnapshot,
): BaselineSource {
  const orders = raw.tables.trade_orders;
  return {
    manifestId,
    manifestSha256,
    sourceOwner: manifest.source.owner,
    timezone: manifest.source.timezone,
    ordersKnown: orders?.present === true,
    orders: (orders?.rows ?? []).map((row) => {
      const id = text(row, "id"),
        fact = id ? manifest.orderFacts[id] : undefined;
      return {
        id,
        code: text(row, "code"),
        market: text(row, "market"),
        quantity: text(row, "qty"),
        registeredFee: fact?.registeredFee ?? null,
        status: text(row, "status"),
        occurredAt: text(row, "traded_at"),
        actualFeeKnown: fact?.actualFeeKnown ?? null,
      };
    }),
  };
}
export function originalBlocker(order: SourceOrder): string | null {
  if (!order.id) return "原订单标识未知";
  if (order.status !== "filled") return "非成交意图";
  if (order.actualFeeKnown === true) return "实际费用已有来源";
  if (order.actualFeeKnown !== false || order.registeredFee === null)
    return "原登记费用或来源未知";
  if (!/^[+-]?0+(?:\.0+)?(?:[eE][+-]?\d+)?$/.test(order.registeredFee))
    return "原登记费用非零";
  return null;
}
export function estimateBaselineCommand(
  source: BaselineSource,
  head: EstimateHead,
  targets: BaselineTarget[],
  draft: BaselineDraft,
  owner: string,
  account: string,
  ruleVersion: string,
  period: {
    from: string;
    through: string;
    confirmed: boolean;
    commissionIncludesExchangeFees?: boolean;
  },
  requestId: string,
) {
  const original = source.orders.find((value) => value.id === draft.originalId),
    target = targets.find((value) => value.orderId === draft.targetId);
  if (
    !source.ordersKnown ||
    !original ||
    originalBlocker(original) ||
    !target ||
    target.actualFeeKnown !== false ||
    target.recordRevision === null ||
    target.status !== "filled"
  )
    throw Error("请选择可核对的原订单与已有本人成交");
  if (
    head.brokerAccountId !== account ||
    !Number.isSafeInteger(head.revision) ||
    head.revision < 0
  )
    throw Error("基线版本未知，请重新读取");
  if (
    !draft.registeredConfirmed ||
    !draft.estimatedOnly ||
    !period.from ||
    !period.through ||
    !period.confirmed ||
    draft.instrumentKind === "unknown"
  )
    throw Error("请确认原登记、现金期初、证券类型及历史费率期间");
  return {
    requestId,
    manifestId: source.manifestId,
    targetUserId: owner,
    brokerAccountId: account,
    expectedRevision: head.revision,
    ruleVersion,
    plan: {
      effectiveFrom: period.from,
      effectiveThrough: period.through,
      confirmed: true,
      ...(period.commissionIncludesExchangeFees !== undefined
        ? {
            commissionIncludesExchangeFees:
              period.commissionIncludesExchangeFees,
          }
        : {}),
    },
    selections: [
      {
        originalOrderId: original.id,
        tradeId: target.orderId,
        instrumentKind: draft.instrumentKind,
        wholeOrderConfirmed: true,
      },
    ],
    registeredBaselineConfirmed: true,
    estimatedOnlyConfirmed: true,
  };
}

export function baselineCommand(
  source: BaselineSource,
  head: EstimateHead,
  targets: BaselineTarget[],
  draft: BaselineDraft,
  owner: string,
  account: string,
  requestId: string,
) {
  const original = source.orders.find((value) => value.id === draft.originalId),
    target = targets.find((value) => value.orderId === draft.targetId);
  if (
    !source.ordersKnown ||
    !original ||
    originalBlocker(original) ||
    !target ||
    target.actualFeeKnown !== false ||
    target.recordRevision === null ||
    target.status !== "filled"
  )
    throw Error("请选择可核对的原订单与已有本人成交");
  if (
    head.brokerAccountId !== account ||
    !Number.isSafeInteger(head.revision) ||
    head.revision < 0
  )
    throw Error("基线版本未知，请重新读取");
  if (!draft.registeredConfirmed)
    throw Error("请确认原登记、现金期初与完整订单范围");
  return {
    requestId,
    manifestId: source.manifestId,
    targetUserId: owner,
    brokerAccountId: account,
    expectedRevision: head.revision,
    selections: [
      {
        originalOrderId: original.id,
        tradeId: target.orderId,
        wholeOrderConfirmed: true,
      },
    ],
    registeredBaselineConfirmed: true,
  };
}
