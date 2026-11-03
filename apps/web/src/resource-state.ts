type Store = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
const prefix = "alcor.resource-request:";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const kinds = [
  "upload",
  "delete",
  "folder_create",
  "folder_delete",
  "folder_update",
  "file_update",
] as const;
export type ResourceKind = (typeof kinds)[number];
export type ResourceRequest = { id: string; kind: ResourceKind | null };
function decode(raw: string): ResourceRequest {
  // The unpublished early prototype kept only the UUID. It remains queryable;
  // cancellation cannot guess its original kind.
  if (uuid.test(raw)) return { id: raw, kind: null };
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.id !== "string" ||
      !uuid.test(value.id) ||
      !kinds.includes(value.kind as ResourceKind)
    )
      throw new Error();
    return { id: value.id, kind: value.kind as ResourceKind };
  } catch {
    throw new Error("原操作编号无法读取，请先核对");
  }
}
export function clearResourceRequests(storage: Store, keep?: string) {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const key of keys)
    if (key?.startsWith(prefix) && key !== prefix + keep)
      storage.removeItem(key);
}
export function readResourceRequest(
  storage: Store,
  scope: string,
): ResourceRequest | null {
  clearResourceRequests(storage, scope);
  const raw = storage.getItem(prefix + scope);
  return raw === null ? null : decode(raw);
}
export function retainResourceRequest(
  storage: Store,
  scope: string,
  value: ResourceRequest,
) {
  if (!uuid.test(value.id) || !kinds.includes(value.kind as ResourceKind))
    throw new Error("原操作编号或类型无效");
  const prior = readResourceRequest(storage, scope);
  if (prior && (prior.id !== value.id || prior.kind !== value.kind))
    throw new Error("请先核对原操作");
  storage.setItem(
    prefix + scope,
    JSON.stringify({ id: value.id, kind: value.kind }),
  );
}
export function releaseResourceRequest(
  storage: Store,
  scope: string,
  id: string,
) {
  const raw = storage.getItem(prefix + scope);
  // A late old-scope completion must not prune a new identity's pending request.
  if (raw !== null && decode(raw).id === id) storage.removeItem(prefix + scope);
}
export function resourceSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "未知";
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes,
    unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return (
    new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value) +
    " " +
    units[unit]
  );
}
