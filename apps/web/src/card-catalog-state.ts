type Store = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
export type CardOperation = {
  requestId: string;
  kind: "source_import" | "custom_create" | "custom_delete";
};
const prefix = "alcor.card-catalog-request:";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function readCardOperation(
  storage: Store,
  scope: string,
): CardOperation | null {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix) && key !== prefix + scope)
      storage.removeItem(key);
  }
  const text = storage.getItem(prefix + scope);
  if (text === null) return null;
  const value = JSON.parse(text) as CardOperation;
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).length !== 2 ||
    typeof value.requestId !== "string" ||
    !uuid.test(value.requestId) ||
    !["source_import", "custom_create", "custom_delete"].includes(value.kind)
  )
    throw new Error("原卡面请求编号无法读取");
  return { requestId: value.requestId, kind: value.kind };
}
export function retainCardOperation(
  storage: Store,
  scope: string,
  value: CardOperation,
) {
  const existing = readCardOperation(storage, scope);
  if (
    existing &&
    (existing.requestId !== value.requestId || existing.kind !== value.kind)
  )
    throw new Error("请先核对原卡面请求");
  storage.setItem(
    prefix + scope,
    JSON.stringify({ requestId: value.requestId, kind: value.kind }),
  );
}
export function releaseCardOperation(
  storage: Store,
  scope: string,
  id: string,
) {
  const existing = readCardOperation(storage, scope);
  if (existing?.requestId !== id) throw new Error("原卡面请求已变化");
  storage.removeItem(prefix + scope);
}
