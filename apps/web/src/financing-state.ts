export const financingCurrencies = [
  "USD",
  "EUR",
  "HKD",
  "MOP",
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
export type FinancingPolicy = {
  currency: string;
  limit: string | null;
  initialMargin: string | null;
  maintenanceMargin: string | null;
};
export type FinancingHead = {
  targetUserId: string;
  accountKind: string;
  revision: string;
  policyKnown: boolean;
  sourcePolicyPending: boolean;
  policy: FinancingPolicy | null;
  exceedsLimit: boolean | null;
  debt: {
    debtKnown: boolean;
    debt: string | null;
    currency: string | null;
    basisLabel: string;
    blockers: string[];
    fx: { observationId: string | null };
  };
};
export type FinancingDraft = {
  currency: string;
  limit: string;
  initialMargin: string;
  maintenanceMargin: string;
};
export const emptyFinancingDraft = (): FinancingDraft => ({
  currency: "",
  limit: "",
  initialMargin: "",
  maintenanceMargin: "",
});
export function financingCommand(
  head: FinancingHead,
  draft: FinancingDraft,
  owner: string,
  id: string,
) {
  if (
    head.targetUserId !== owner ||
    !["real", "simulated"].includes(head.accountKind) ||
    !financingCurrencies.includes(draft.currency)
  )
    throw Error("请选择本人账本和融资币种");
  return {
    requestId: id,
    targetUserId: owner,
    accountKind: head.accountKind,
    revision: head.revision,
    policy: {
      currency: draft.currency,
      limit: draft.limit.trim() || null,
      initialMargin: draft.initialMargin.trim() || null,
      maintenanceMargin: draft.maintenanceMargin.trim() || null,
    },
  };
}
export function financingConfirmation(confirmed: boolean, statement: string) {
  if (!confirmed || !statement.trim())
    throw Error("请明确核实实际负现金并填写本人依据");
  return {
    kind: "owner_statement",
    statement,
    actualBorrowingConfirmed: true,
    ledgerOnlyConfirmed: true,
  };
}
