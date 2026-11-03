export type Receipt = {
  id: string;
  state: "queued" | "running" | "completed" | "failed" | "interrupted";
  error_code: string | null;
  observation_id?: string | null;
};
export const pending = (state: Receipt["state"] | undefined) =>
  state === "queued" || state === "running";
export function rateLabel(rates: Record<string, string>, code: string): string {
  return Object.hasOwn(rates, code) ? rates[code] : "—";
}
export function dayLabel(status: string): string {
  return (
    (
      {
        trading: "交易日",
        weekend: "周末休市",
        holiday: "休市",
        half_day: "半日市",
        unknown: "未确认",
      } as Record<string, string>
    )[status] ?? "未确认"
  );
}
export function receiptKey(scope: string): string {
  return "alcor.reference-request:" + scope;
}
export function restoreRequest(storage: Storage, scope: string): string | null {
  const key = receiptKey(scope);
  for (const other of Object.keys(storage))
    if (other.startsWith("alcor.reference-request:") && other !== key)
      storage.removeItem(other);
  const id = storage.getItem(key);
  if (
    id !== null &&
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
  )
    throw new Error("原请求编号无法读取");
  return id;
}
export function mayPoll(
  active: boolean,
  visible: boolean,
  id: string | null,
  receipt: Receipt | null,
): boolean {
  return (
    active &&
    visible &&
    id !== null &&
    (receipt === null || pending(receipt.state))
  );
}
export function clearReferenceRequests(storage: Storage): void {
  for (const key of Object.keys(storage))
    if (key.startsWith("alcor.reference-request:")) storage.removeItem(key);
}

export function terminal(state: unknown): boolean {
  return state === "completed" || state === "failed" || state === "interrupted";
}
export function releaseRejectedRequest(
  storage: Pick<Storage, "getItem" | "removeItem">,
  scope: string,
  id: string,
  status: number | undefined,
): boolean {
  if (
    ![400, 404, 405, 413, 415, 422, 429].includes(status ?? -1) ||
    storage.getItem(receiptKey(scope)) !== id
  )
    return false;
  storage.removeItem(receiptKey(scope));
  return true;
}
export function validReceipt(value: Receipt): boolean {
  return (
    typeof value?.id === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value.id,
    ) &&
    (pending(value.state) || terminal(value.state))
  );
}

/** A late response belongs to its original UUID, never to a newly selected request. */
export async function readOriginalReceipt(
  read: () => Promise<Receipt>,
  current: () => boolean,
  commit: (value: Receipt) => void,
  fail: (reason: unknown) => void,
): Promise<void> {
  try {
    const value = await read();
    if (!current()) return;
    if (!validReceipt(value))
      throw new Error("未收到有效回执，请继续查询原请求");
    commit(value);
  } catch (reason) {
    if (current()) fail(reason);
  }
}
