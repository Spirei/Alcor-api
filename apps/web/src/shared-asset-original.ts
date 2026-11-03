import { ApiError } from "./api";
import {
  apiSessionSnapshot,
  bindApiSession,
  isCurrentApiSession,
} from "./api-session";
import { sharedAssetReceipt, type AssetReceipt } from "./shared-assets-state";
export async function sharedAssetOriginal(
  value: AssetReceipt,
  binding: { csrf: string; current: () => boolean },
  signal: AbortSignal,
): Promise<Blob> {
  const receipt = sharedAssetReceipt(value, value.requestId);
  if (receipt.state !== "completed") throw new Error("原素材操作未完成");
  const snapshot = apiSessionSnapshot(),
    current = () =>
      binding.current() && isCurrentApiSession(snapshot) && !signal.aborted;
  const check = () => {
    if (!current() || snapshot.csrf !== binding.csrf)
      throw new ApiError(
        409,
        "登录身份已变化，请重新读取",
        "",
        "session_changed",
      );
  };
  check();
  const response = await fetch(
    "/api/admin/shared-assets/versions/" + receipt.version + "/original",
    {
      credentials: "same-origin",
      headers: { "X-CSRF-Token": binding.csrf },
      signal,
    },
  );
  try {
    check();
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
      response.status === 403 ? "需要管理员权限" : "原件暂不可下载",
    );
  }
  if (
    response.status !== 200 ||
    response.headers.get("Content-Length") !== String(receipt.originalSize) ||
    response.headers.get("ETag") !== '"' + receipt.originalSha256 + '"'
  ) {
    await response.body?.cancel().catch(() => {});
    throw new Error("原件大小或摘要不符");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("原件读取失败");
  const parts: ArrayBuffer[] = [];
  let size = 0,
    complete = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      check();
      if (done) break;
      size += value.byteLength;
      if (size > receipt.originalSize!) throw new Error("原件大小不符");
      parts.push(new Uint8Array(value).buffer);
    }
    if (size !== receipt.originalSize) throw new Error("原件不完整");
    complete = true;
    return new Blob(parts, { type: "application/octet-stream" });
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
