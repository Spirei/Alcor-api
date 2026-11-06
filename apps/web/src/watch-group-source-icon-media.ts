import { requestResponse } from "./api-response.ts";
import { ApiError } from "./api";
import { apiSessionSnapshot } from "./api-session";
import {
  sourceIconReceipt,
  type SourceIconCapture,
} from "./watch-group-source-icon-state";
export async function sourceIconOriginal(
  captured: SourceIconCapture,
  context: { csrf: string; current: () => boolean },
  signal: AbortSignal,
) {
  sourceIconReceipt(captured, captured.requestId);
  if (
    captured.captureState !== "captured" ||
    !captured.originalSha256 ||
    !captured.originalSize ||
    !captured.originalPath
  )
    throw Error("该项尚无已归档原图");
  const binding = apiSessionSnapshot(),
    current = () =>
      !signal.aborted &&
      context.current() &&
      binding.csrf === context.csrf &&
      apiSessionSnapshot().epoch === binding.epoch;
  if (!current()) throw Error("登录身份已变化");
  const response = await requestResponse(captured.originalPath, {
    credentials: "same-origin",
    headers: { "X-CSRF-Token": context.csrf },
    signal,
  });
  if (!current()) throw Error("登录身份已变化");
  if (!response.ok)
    throw new ApiError(
      response.status,
      [401, 403].includes(response.status)
        ? "原图读取权限已变化"
        : "原图暂不可用",
    );
  if (
    response.headers.get("Content-Length") !== String(captured.originalSize) ||
    response.headers.get("ETag") !== '"' + captured.originalSha256 + '"' ||
    response.headers.get("Content-Type")?.split(";")[0] !==
      "application/octet-stream" ||
    response.headers.get("Content-Disposition") !== "attachment" ||
    !response.body
  )
    throw Error("原图大小、摘要或下载类型不符");
  const reader = response.body.getReader(),
    parts: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (!current()) throw Error("登录身份已变化");
      if (done) break;
      received += value.length;
      if (received > captured.originalSize) throw Error("原图超过声明大小");
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!current() || received !== captured.originalSize)
    throw Error("原图不完整或身份已变化");
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.length;
  }
  const actual = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  if (!current() || actual !== captured.originalSha256)
    throw Error("原图内容摘要不符或身份已变化");
  return new Blob([bytes], { type: "application/octet-stream" });
}
