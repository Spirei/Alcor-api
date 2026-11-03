import { ApiError } from "./api";
import {
  apiSessionSnapshot,
  bindApiSession,
  isCurrentApiSession,
} from "./api-session";

export async function attachmentOriginal(
  item: { rel: string; size: number },
  binding: { csrf: string; current: () => boolean },
  signal: AbortSignal,
): Promise<Blob> {
  const snapshot = apiSessionSnapshot();
  const current = () =>
    binding.current() && isCurrentApiSession(snapshot) && !signal.aborted;
  const assertCurrent = () => {
    if (!current() || snapshot.csrf !== binding.csrf)
      throw new ApiError(
        409,
        "登录身份已变化，请重新读取",
        "",
        "session_changed",
      );
  };
  assertCurrent();
  if (
    !Number.isSafeInteger(item.size) ||
    item.size < 0 ||
    item.size > 50 * 1024 * 1024
  )
    throw new Error("原文件大小待核对");
  const response = await fetch(
    "/api/admin/attachments?" +
      new URLSearchParams({ action: "download", path: item.rel }),
    {
      credentials: "same-origin",
      headers: { "X-CSRF-Token": binding.csrf },
      signal,
    },
  );
  try {
    assertCurrent();
  } catch (reason) {
    await response.body?.cancel().catch(() => {});
    throw reason;
  }
  if (response.headers.get("X-Alcor-Session-Changed") === "true") {
    await response.body?.cancel().catch(() => {});
    bindApiSession(null);
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event("alcor:session-changed"));
    throw new ApiError(
      409,
      "登录身份已变化，请重新读取",
      "",
      "session_changed",
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 401 && typeof window !== "undefined")
      window.dispatchEvent(new Event("alcor:session-expired"));
    throw new ApiError(
      response.status,
      response.status === 403
        ? "需要管理员权限"
        : "原文件暂不可下载，请重新读取",
    );
  }
  if (
    response.status !== 200 ||
    response.headers.get("Content-Length") !== String(item.size) ||
    !/^"[a-f0-9]{64}"$/.test(response.headers.get("ETag") ?? "")
  ) {
    await response.body?.cancel().catch(() => {});
    throw new Error("文件已变化，请重新读取");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("原文件读取失败");
  const parts: ArrayBuffer[] = [];
  let total = 0,
    complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      assertCurrent();
      if (done) break;
      total += value.byteLength;
      if (total > item.size) throw new Error("文件已变化，请重新读取");
      parts.push(new Uint8Array(value).buffer);
    }
    if (total !== item.size) throw new Error("原文件不完整，请重新读取");
    complete = true;
    return new Blob(parts, { type: "application/octet-stream" });
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
