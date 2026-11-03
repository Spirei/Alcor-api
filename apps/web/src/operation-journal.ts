export type PendingOperation = {
  id: string;
  kind:
    | "record"
    | "broker"
    | "cash"
    | "trade"
    | "financing_policy"
    | "trade_amendment"
    | "order"
    | "fee_plan"
    | "fee_repair"
    | "fee_confirmation"
    | "native_fee_confirmation"
    | "fee_estimate"
    | "fee_baseline";
  submissionStatus?: number;
};
type StorageLike = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
const prefix = "alcor.pending-operation:";
export function clearOperationJournal(storage: StorageLike): void {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const key of keys) if (key?.startsWith(prefix)) storage.removeItem(key);
}
export function restoreOperation(
  storage: StorageLike,
  scope: string,
): PendingOperation | null {
  const key = prefix + scope;
  const raw = storage.getItem(key);
  // Clear other identities without first deleting the only copy of this receipt.
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const other of keys)
    if (other?.startsWith(prefix) && other !== key) storage.removeItem(other);
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("操作编号无法读取，请先核对原请求。");
  }
  if (!value || typeof value !== "object")
    throw new Error("操作编号无法读取，请先核对原请求。");
  const candidate = value as Record<string, unknown>;
  if (
    ![
      "record",
      "broker",
      "cash",
      "trade",
      "financing_policy",
      "trade_amendment",
      "order",
      "fee_plan",
      "fee_repair",
      "fee_confirmation",
      "native_fee_confirmation",
      "fee_estimate",
      "fee_baseline",
    ].includes(String(candidate.kind)) ||
    typeof candidate.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      candidate.id,
    )
  )
    throw new Error("操作编号无法读取，请先核对原请求。");
  const result: PendingOperation = {
    id: candidate.id,
    kind: candidate.kind as PendingOperation["kind"],
  };
  if (
    typeof candidate.submissionStatus === "number" &&
    Number.isInteger(candidate.submissionStatus) &&
    candidate.submissionStatus >= 0 &&
    candidate.submissionStatus <= 599
  )
    result.submissionStatus = candidate.submissionStatus;
  saveOperation(storage, scope, result);
  return result;
}

/** A late response cannot resurrect a receipt cleared by logout or replace a newer request. */
export function updateOperation(
  storage: StorageLike,
  scope: string,
  id: string,
  value: PendingOperation | null,
): boolean {
  const raw = storage.getItem(prefix + scope);
  if (!raw) return false;
  const current = JSON.parse(raw) as PendingOperation;
  if (current.id !== id) return false;
  if (value && value.id !== id) throw new Error("操作编号不匹配");
  saveOperation(storage, scope, value);
  return true;
}

export function saveOperation(
  storage: StorageLike,
  scope: string,
  value: PendingOperation | null,
): void {
  const key = prefix + scope;
  if (!value) {
    storage.removeItem(key);
    return;
  }
  const prior = storage.getItem(key);
  if (prior) {
    let existing: unknown;
    try {
      existing = JSON.parse(prior);
    } catch {
      throw new Error("原操作编号无法读取，请先核对原请求。");
    }
    if (
      !existing ||
      typeof existing !== "object" ||
      (existing as PendingOperation).id !== value.id ||
      (existing as PendingOperation).kind !== value.kind
    )
      throw new Error("另有操作尚未核对，请先查询原回执。");
  }
  // Persist only a receipt locator; never amounts, draft fields, tokens or preview proofs.
  storage.setItem(
    key,
    JSON.stringify({
      id: value.id,
      kind: value.kind,
      submissionStatus: value.submissionStatus,
    }),
  );
}

export function operationPath(kind: PendingOperation["kind"]): string {
  return {
    record: "/portfolio/records",
    broker: "/broker-accounts",
    cash: "/cash",
    trade: "/trading",
    trade_amendment: "/trading/corrections",
    financing_policy: "/financing/policy",
    order: "/trading/orders",
    fee_plan: "/fees/plans",
    fee_repair: "/fees/repairs",
    fee_confirmation: "/fees/confirmations",
    native_fee_confirmation: "/fees/confirmations/native",
    fee_estimate: "/fees/estimates",
    fee_baseline: "/fees/baselines",
  }[kind];
}
