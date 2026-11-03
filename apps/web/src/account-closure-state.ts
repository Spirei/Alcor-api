import { requestId } from "./request-id.ts";

export const closureStorageKey = "alcor.account-closure.pending.v1";
export type ClosurePending = {
  instanceId: string;
  userId: string;
  sessionScope: string;
  requestId: string;
  revision: string;
  receiptToken: string;
};
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export function closurePending(value: unknown): ClosurePending {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("原注销请求记录不可用");
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join() !==
      [
        "instanceId",
        "userId",
        "sessionScope",
        "requestId",
        "revision",
        "receiptToken",
      ]
        .sort()
        .join() ||
    !uuid(row.instanceId) ||
    !uuid(row.requestId) ||
    !uuid(row.revision) ||
    typeof row.userId !== "string" ||
    !row.userId ||
    typeof row.sessionScope !== "string" ||
    !row.sessionScope ||
    typeof row.receiptToken !== "string" ||
    !/^acr_[A-Za-z0-9_-]{43}$/.test(row.receiptToken)
  )
    throw Error("原注销请求记录不可用，请保留原编号");
  return row as unknown as ClosurePending;
}
export function readClosurePendings(store: Store): ClosurePending[] {
  const raw = store.getItem(closureStorageKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const rows = (Array.isArray(parsed) ? parsed : [parsed]).map(
      closurePending,
    );
    const owners = rows.map((row) =>
      JSON.stringify([row.instanceId, row.userId]),
    );
    if (rows.length > 20 || new Set(owners).size !== rows.length) throw Error();
    return rows;
  } catch {
    throw Error("原注销请求记录不可用，请保留原编号");
  }
}
export function readClosurePending(
  store: Store,
  scope?: Pick<ClosurePending, "instanceId" | "userId">,
): ClosurePending | null {
  return (
    readClosurePendings(store).find(
      (row) =>
        !scope ||
        (row.instanceId === scope.instanceId && row.userId === scope.userId),
    ) ?? null
  );
}
export function retainClosurePending(store: Store, pending: ClosurePending) {
  closurePending(pending);
  const rows = readClosurePendings(store);
  const previous = rows.find(
    (row) =>
      row.instanceId === pending.instanceId && row.userId === pending.userId,
  );
  if (
    previous &&
    Object.keys(pending).some(
      (key) =>
        previous[key as keyof ClosurePending] !==
        pending[key as keyof ClosurePending],
    )
  )
    throw Error("请先核对或关闭该账号的原注销请求");
  if (!previous && rows.length >= 20) throw Error("请先核对已有注销请求");
  const serialized = JSON.stringify(previous ? rows : [...rows, pending]);
  store.setItem(closureStorageKey, serialized);
  if (store.getItem(closureStorageKey) !== serialized)
    throw Error("无法可靠保存原注销请求，请不要继续");
}
export function releaseClosurePending(store: Store, pending: ClosurePending) {
  const rows = readClosurePendings(store);
  const remaining = rows.filter(
    (row) =>
      !(
        row.instanceId === pending.instanceId &&
        row.userId === pending.userId &&
        row.requestId === pending.requestId &&
        row.receiptToken === pending.receiptToken
      ),
  );
  if (remaining.length === rows.length) return;
  if (remaining.length)
    store.setItem(closureStorageKey, JSON.stringify(remaining));
  else store.removeItem(closureStorageKey);
  const expected = remaining.length ? JSON.stringify(remaining) : null;
  if (store.getItem(closureStorageKey) !== expected)
    throw Error("已核对的本地注销记录无法更新");
}
export function newClosurePending(
  scope: Omit<ClosurePending, "requestId" | "receiptToken">,
  random = globalThis.crypto,
): ClosurePending {
  const bytes = random.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return closurePending({
    ...scope,
    requestId: requestId(random),
    receiptToken: "acr_" + token,
  });
}
export type ClosureObservation = {
  request_id: string;
  scope: "account-closure-only";
  state: "prepared" | "completed" | "closed";
  revision?: string;
  prepared_until?: string;
  expires_at?: string;
  deleted?: true;
  closed?: true;
  executed?: false;
};
export function closureObservation(
  raw: unknown,
  pending: ClosurePending,
): ClosureObservation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("原注销回执待核对");
  const value = raw as Record<string, unknown>;
  if (
    value.request_id !== pending.requestId ||
    value.scope !== "account-closure-only"
  )
    throw Error("注销回执与原编号不符");
  if (value.state === "prepared") {
    if (
      value.revision !== pending.revision ||
      typeof value.prepared_until !== "string" ||
      !Number.isFinite(Date.parse(value.prepared_until)) ||
      typeof value.expires_at !== "string" ||
      !Number.isFinite(Date.parse(value.expires_at)) ||
      value.deleted !== undefined ||
      value.closed !== undefined ||
      value.executed !== undefined
    )
      throw Error("原注销准备待核对");
  } else if (value.state === "completed") {
    if (
      value.deleted !== true ||
      value.closed !== undefined ||
      value.executed !== undefined
    )
      throw Error("注销完成回执待核对");
  } else if (value.state === "closed") {
    if (
      value.closed !== true ||
      value.executed !== false ||
      value.deleted !== undefined
    )
      throw Error("注销关闭回执待核对");
  } else throw Error("原注销请求状态未知");
  return value as unknown as ClosureObservation;
}
export function sameClosureOwner(
  pending: ClosurePending,
  session: { instance_id: string; user: { id: string } },
) {
  return (
    pending.instanceId === session.instance_id &&
    pending.userId === session.user.id
  );
}
export function sameClosureSession(
  pending: ClosurePending,
  session: { instance_id: string; user: { id: string }; receipt_scope: string },
) {
  return (
    sameClosureOwner(pending, session) &&
    pending.sessionScope === session.receipt_scope
  );
}
