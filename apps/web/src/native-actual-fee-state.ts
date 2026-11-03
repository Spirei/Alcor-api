import type { ActualFeeDraft } from "./actual-fee-state";
export type NativeActualFeeItem = {
  tradeId: string; recordId: string; recordRevision: number;
  registrationRequestId: string; registrationSha256: string;
  currency: string; registeredFees: string; estimatedFees: string;
  actualFee: string | null; actualFeeKnown: boolean; authority: "owner_recorded" | null;
  canConfirm: boolean; occurredAt: string; code: string; side: string;
};
export type NativeActualFeeSnapshot = {
  targetUserId: string; brokerAccountId: string; brokerRevision: number; snapshotRevision: string;
  coverageScope: "completed_native_calculated_fee_registrations_only"; items: NativeActualFeeItem[];
};
export function nativeActualFeeCommand(snapshot: NativeActualFeeSnapshot, item: NativeActualFeeItem, draft: ActualFeeDraft, owner: string, requestId: string) {
  if (snapshot.targetUserId !== owner || snapshot.coverageScope !== "completed_native_calculated_fee_registrations_only" || !snapshot.items.some(value => value.tradeId === item.tradeId && value.registrationSha256 === item.registrationSha256 && value.recordRevision === item.recordRevision)) throw Error("原完成登记已变化，请重新读取");
  if (item.actualFeeKnown || !item.canConfirm) throw Error("此费用已有确认或更正，须保留原回执");
  if (!draft.amount.trim() || draft.currency !== item.currency || !draft.statement.trim() || !draft.actualConfirmed || !draft.cashConfirmed) throw Error("请填写实际支付费用、原结算币种及核对依据，并逐项确认");
  return {
    requestId, targetUserId: owner, brokerAccountId: snapshot.brokerAccountId, brokerRevision: snapshot.brokerRevision, snapshotRevision: snapshot.snapshotRevision,
    confirmations: [{tradeId:item.tradeId,registrationRequestId:item.registrationRequestId,registrationSha256:item.registrationSha256,recordRevision:item.recordRevision,
      actualFee:draft.amount.trim(),currency:draft.currency,authority:"owner_recorded",actualPaidConfirmed:true,historicalCashAttributionConfirmed:true,
      evidence:{kind:"owner_statement",statement:draft.statement}}],
  };
}
