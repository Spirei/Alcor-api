export type ActualFeeItem = {
  originalOrderId: string;
  tradeId: string;
  recordId: string;
  recordRevision: number;
  manifestId: string;
  manifestSha256: string;
  registeredFees: string;
  actualFee: string | null;
  actualFeeKnown: boolean;
  authority: "owner_recorded" | null;
};
export type ActualFeeSnapshot = {
  targetUserId: string;
  brokerAccountId: string;
  brokerRevision: number;
  snapshotRevision: string;
  coverageScope: "verified_existing_registered_baselines_only";
  wholeLegacyFinancialComplete: false;
  items: ActualFeeItem[];
};
export type ActualFeeDraft = {
  amount: string;
  currency: string;
  statement: string;
  actualConfirmed: boolean;
  cashConfirmed: boolean;
};
export function emptyActualFeeDraft(): ActualFeeDraft {
  return { amount: "", currency: "", statement: "", actualConfirmed: false, cashConfirmed: false };
}
export function actualFeeCommand(snapshot: ActualFeeSnapshot, item: ActualFeeItem, draft: ActualFeeDraft, owner: string, requestId: string) {
  if (snapshot.targetUserId !== owner || snapshot.coverageScope !== "verified_existing_registered_baselines_only" || !snapshot.items.some(value => value.tradeId === item.tradeId && value.manifestId === item.manifestId && value.recordRevision === item.recordRevision)) throw Error("原订单基线已变化，请重新读取");
  if (item.actualFeeKnown) throw Error("原费用已核实，不能覆盖");
  if (!draft.amount.trim() || !["USD", "HKD", "CNY"].includes(draft.currency) || !draft.statement.trim() || !draft.actualConfirmed || !draft.cashConfirmed) throw Error("请填写实付费用、币种和核对依据，并逐项确认");
  return {
    requestId, targetUserId: owner, manifestId: item.manifestId, manifestSha256: item.manifestSha256,
    brokerAccountId: snapshot.brokerAccountId, brokerRevision: snapshot.brokerRevision, snapshotRevision: snapshot.snapshotRevision,
    confirmations: [{ tradeId: item.tradeId, originalOrderId: item.originalOrderId, recordRevision: item.recordRevision,
      actualFee: draft.amount.trim(), currency: draft.currency, authority: "owner_recorded",
      actualPaidConfirmed: true, historicalCashAttributionConfirmed: true,
      evidence: { kind: "owner_statement", statement: draft.statement } }],
  };
}
