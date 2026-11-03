import { financingConfirmation } from "./financing-state.ts";
export type AmendmentItem = {
  tradeId: string;
  registrationRequestId: string;
  currentAmendmentId: string | null;
  actualFeeKnown: boolean;
  canAmend: boolean;
  blocker: string | null;
  sourceAuthority?: null | {
    lane: string;
    sourceOrderId: string;
    manifestId: string;
    manifestSha256: string;
    originalRequestId: string | null;
    registrationRequestId: string;
    sourceRevision: number;
  };
  event: null | {
    id: string;
    side: string;
    quantity: string;
    price: string;
    fees: string;
    occurred_at: string;
    currency: string;
  };
};
export type AmendmentHead = {
  targetUserId: string;
  brokerAccountId: string;
  brokerRevision: number;
  recordId: string;
  recordRevision: number;
  snapshotRevision: string;
  scope:
    | "manual_actual_correction_actions"
    | "native_manual_actual_single_amendment"
    | "native_manual_actual_correction_actions";
  mergeReady?: boolean;
  deleteReady?: boolean;
  items: AmendmentItem[];
};
export type AmendmentDraft = {
  quantity: string;
  price: string;
  fees: string;
  occurredAt: string;
  statement: string;
  actual: boolean;
  ledger: boolean;
  financing?: boolean;
  financingStatement?: string;
};
export const emptyAmendmentDraft = (): AmendmentDraft => ({
  quantity: "",
  price: "",
  fees: "",
  occurredAt: "",
  statement: "",
  actual: false,
  ledger: false,
  financing: false,
  financingStatement: "",
});
export function amendmentCommand(
  head: AmendmentHead,
  selected: string,
  draft: AmendmentDraft,
  owner: string,
  requestId: string,
  options: { action: "amend" | "merge" | "delete"; members: string[] } = {
    action: "amend",
    members: [],
  },
) {
  const item = head.items.find((row) => row.tradeId === selected);
  if (
    head.targetUserId !== owner ||
    ![
      "manual_actual_correction_actions",
      "native_manual_actual_single_amendment",
      "native_manual_actual_correction_actions",
    ].includes(head.scope) ||
    !item?.event ||
    !item?.canAmend ||
    !item.actualFeeKnown
  )
    throw Error("原成交范围或依据尚未核对");
  if (
    (options.action !== "delete" &&
      (!draft.quantity.trim() ||
        !draft.price.trim() ||
        !draft.fees.trim() ||
        !draft.occurredAt.trim())) ||
    !draft.statement.trim() ||
    !draft.actual ||
    !draft.ledger
  )
    throw Error("请核实数量、价格、实付费用、时间及更正依据");
  if (
    (options.action === "merge" && !head.mergeReady) ||
    (options.action === "delete" && !head.deleteReady)
  )
    throw Error("此动作尚未可用");
  const members =
    options.action === "merge"
      ? [...new Set([selected, ...options.members])]
      : [selected];
  if (
    options.action === "merge" &&
    (members.length < 2 ||
      members.length > 100 ||
      members.some((id) => {
        const other = head.items.find((row) => row.tradeId === id);
        return (
          !other?.event ||
          !other.canAmend ||
          !other.actualFeeKnown ||
          other.event.side !== item.event?.side ||
          other.event.currency !== item.event?.currency
        );
      }))
  )
    throw Error("请选择同方向同币种的有效已核实原单");
  return {
    ...(draft.financing ? { financingConfirmation: financingConfirmation(true,draft.financingStatement ?? "") } : {}),
    requestId,
    targetUserId: owner,
    brokerAccountId: head.brokerAccountId,
    brokerRevision: head.brokerRevision,
    snapshotRevision: head.snapshotRevision,
    recordId: head.recordId,
    recordRevision: head.recordRevision,
    tradeId: selected,
    expectedAmendmentId: item.currentAmendmentId,
    action: options.action,
    ...(options.action === "merge"
      ? {
          members: members.map((id) => ({
            tradeId: id,
            expectedAmendmentId: head.items.find((row) => row.tradeId === id)!
              .currentAmendmentId,
          })),
        }
      : {}),
    replacement:
      options.action === "delete"
        ? null
        : {
            quantity: draft.quantity.trim(),
            price: draft.price.trim(),
            fees: draft.fees.trim(),
            occurredAt: draft.occurredAt.trim(),
          },
    evidence: {
      authority: "owner_recorded",
      kind: "owner_statement",
      statement: draft.statement,
      actualPaidConfirmed: true,
      ledgerCorrectionConfirmed: true,
    },
  };
}
