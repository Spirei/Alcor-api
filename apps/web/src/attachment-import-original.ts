import { requestResponse } from "./api-response.ts";
import { ApiError } from "./api";
import { apiSessionSnapshot } from "./api-session";
import {
  attachmentImportUuid,
  type ArchiveItem,
} from "./attachment-import-state";
export async function attachmentArchiveOriginal(
  id: string,
  item: ArchiveItem,
  context: { csrf: string; current: () => boolean },
  signal: AbortSignal,
) {
  const e = item.evidence,
    binding = apiSessionSnapshot(),
    current = () =>
      !signal.aborted &&
      context.current() &&
      binding.csrf === context.csrf &&
      binding.epoch === apiSessionSnapshot().epoch;
  if (
    !attachmentImportUuid(id) ||
    !Number.isSafeInteger(item.ordinal) ||
    item.ordinal < 0 ||
    e.kind !== "file" ||
    typeof e.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(e.sha256) ||
    !Number.isSafeInteger(e.size) ||
    Number(e.size) < 0 ||
    Number(e.size) > 52428800
  )
    throw new Error("该项尚无已归档原件");
  if (!current()) throw new Error("登录身份已变化");
  const response = await requestResponse(
    "/api/admin/attachment-import/snapshots/" +
      id +
      "/items/" +
      item.ordinal +
      "/original",
    {
      credentials: "same-origin",
      headers: { "X-CSRF-Token": context.csrf },
      signal,
    },
  );
  if (!current()) throw new Error("登录身份已变化");
  if (!response.ok)
    throw new ApiError(
      response.status,
      response.status === 401 || response.status === 403
        ? "附件原件读取权限已变化"
        : "该项原件不可用",
    );
  if (
    response.headers.get("Content-Length") !== String(e.size) ||
    response.headers.get("ETag") !== '"' + e.sha256 + '"'
  )
    throw new Error("原件大小或摘要不符");
  const parts: Uint8Array[] = [];
  let received = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (!current()) throw new Error("登录身份已变化");
        if (done) break;
        received += value.length;
        if (received > Number(e.size)) throw new Error("原件超过声明大小");
        parts.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  if (!current()) throw new Error("登录身份已变化");
  if (received !== e.size) throw new Error("原件不完整");
  return new Blob(parts as BlobPart[], { type: "application/octet-stream" });
}
