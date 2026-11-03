type Store = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
const prefix = "alcor.admin-attachment-request:";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export type AttachmentReceipt = {
  requestId: string;
  namespace: "admin_shared";
  state: "completed" | "failed";
  revision: number;
  httpStatus: number;
  result: { ok: boolean; path?: string; size?: number } | null;
  error?: unknown;
  message: string;
};
export function validAttachmentId(id: string) {
  return uuid.test(id);
}
export function clearAttachmentRequests(storage: Store, keep?: string) {
  for (const key of Array.from({ length: storage.length }, (_, i) =>
    storage.key(i),
  ))
    if (key?.startsWith(prefix) && key !== prefix + keep)
      storage.removeItem(key);
}
export function readAttachmentRequest(storage: Store, scope: string) {
  clearAttachmentRequests(storage, scope);
  const id = storage.getItem(prefix + scope);
  if (id !== null && !validAttachmentId(id))
    throw new Error("原操作编号无法读取，请先核对");
  return id;
}
export function retainAttachmentRequest(
  storage: Store,
  scope: string,
  id: string,
) {
  if (!validAttachmentId(id)) throw new Error("操作编号无效");
  const prior = readAttachmentRequest(storage, scope);
  if (prior && prior !== id) throw new Error("请先核对原操作");
  storage.setItem(prefix + scope, id);
}
export function releaseAttachmentRequest(
  storage: Store,
  scope: string,
  id: string,
) {
  if (storage.getItem(prefix + scope) === id)
    storage.removeItem(prefix + scope);
}
export function attachmentReceipt(
  value: unknown,
  id: string,
): AttachmentReceipt {
  const v = value as Partial<AttachmentReceipt> | null;
  if (
    !v ||
    v.requestId !== id ||
    v.namespace !== "admin_shared" ||
    typeof v.message !== "string" ||
    !["completed", "failed"].includes(v.state ?? "") ||
    !Number.isSafeInteger(v.revision) ||
    Number(v.revision) < 1 ||
    (v.state === "completed"
      ? v.httpStatus !== 200 || v.result?.ok !== true
      : !Number.isInteger(v.httpStatus) ||
        Number(v.httpStatus) < 400 ||
        Number(v.httpStatus) > 599)
  )
    throw new Error("原回执编号、范围或状态不符，请继续核对");
  return v as AttachmentReceipt;
}
export function attachmentCommand(
  action: string,
  fields: Record<string, unknown>,
  revision: number,
  id: string,
) {
  if (!validAttachmentId(id) || !Number.isSafeInteger(revision) || revision < 1)
    throw new Error("请先重新读取附件目录");
  const expected = { expectedRevision: revision, requestId: id };
  if (action === "delete")
    return {
      path:
        "/admin/attachments?" +
        new URLSearchParams({
          path: String(fields.path),
          force: fields.force ? "1" : "0",
        }),
      method: "DELETE",
      body: JSON.stringify(expected),
    };
  return {
    path: "/admin/attachments",
    method: "POST",
    body: JSON.stringify({ ...fields, action, ...expected }),
  };
}
