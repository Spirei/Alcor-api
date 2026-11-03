type Store = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
const prefix = "alcor.resource-import-request:";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function clearResourceImportRequests(storage: Store) {
  for (const key of Array.from({ length: storage.length }, (_, i) =>
    storage.key(i),
  ))
    if (key?.startsWith(prefix)) storage.removeItem(key);
}
export function readResourceImportRequest(storage: Store, scope: string) {
  for (const key of Array.from({ length: storage.length }, (_, i) =>
    storage.key(i),
  ))
    if (key?.startsWith(prefix) && key !== prefix + scope)
      storage.removeItem(key);
  const value = storage.getItem(prefix + scope);
  if (value !== null && !uuid.test(value))
    throw new Error("资源原操作编号无法读取");
  return value;
}
export function retainResourceImportRequest(
  storage: Store,
  scope: string,
  id: string,
) {
  if (!uuid.test(id)) throw new Error("资源原操作编号无效");
  const prior = readResourceImportRequest(storage, scope);
  if (prior && prior !== id) throw new Error("请先查询资源原操作");
  storage.setItem(prefix + scope, id);
}
export function releaseResourceImportRequest(
  storage: Store,
  scope: string,
  id: string,
) {
  if (storage.getItem(prefix + scope) === id)
    storage.removeItem(prefix + scope);
}
export function resourceImportPhase(
  state: string,
  complete: unknown,
  remaining: unknown,
) {
  if (state === "failed") return "来源捕获失败";
  if (state === "capturing" || state === "pending") return "来源捕获未确认";
  if (state !== "sealed") return "来源状态待核对";
  if (complete === true && remaining === 0) return "本清单已全部应用";
  return typeof remaining === "number" &&
    Number.isSafeInteger(remaining) &&
    remaining >= 0
    ? `本清单尚余 ${remaining} 条`
    : "本清单应用结果待核对";
}
export type ResourceImportProof = {
  manifestId: string;
  preview: string;
  revision: number;
};
export function resourceSegment(
  id: string,
  manifest: string,
  revision: number,
  proof: ResourceImportProof | null,
  count: number,
  retry: boolean,
) {
  if (
    !uuid.test(id) ||
    !uuid.test(manifest) ||
    !proof ||
    proof.manifestId !== manifest ||
    proof.revision !== revision ||
    !/^[a-f0-9]{64}$/.test(proof.preview) ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 32
  )
    throw new Error("请重新预览当前资源清单");
  return {
    requestId: id,
    revision,
    preview: proof.preview,
    maxItems: count,
    retryBlocked: retry,
  };
}
