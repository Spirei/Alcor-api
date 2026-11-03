import { apiSessionSnapshot } from "./api-session";
import { ApiError } from "./api";
import { groupIcon, type GroupIcon } from "./watch-group-icon-state";
export async function iconBlob(
  media: GroupIcon,
  original: boolean,
  context: { csrf: string; current: () => boolean },
  signal: AbortSignal,
) {
  groupIcon(media);
  const current = () =>
    !signal.aborted &&
    context.current() &&
    apiSessionSnapshot().csrf === context.csrf;
  if (!current()) throw new Error("登录身份已变化");
  const response = await fetch(
    original ? media.originalPath : media.contentPath,
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
        ? "图标读取权限已变化"
        : "图标原件读取失败",
    );
  const size = original ? media.originalSize : media.size,
    hash = original ? media.originalSha256 : media.sha256;
  if (
    response.headers.get("Content-Length") !== String(size) ||
    response.headers.get("ETag") !== '"' + hash + '"' ||
    !response.body
  )
    throw new Error("图标原件大小或摘要不符");
  const reader = response.body.getReader(),
    parts: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (!current()) throw new Error("登录身份已变化");
      if (done) break;
      received += value.length;
      if (received > size) throw new Error("图标原件超出大小");
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (received !== size) throw new Error("图标原件不完整");
  return new Blob(parts as BlobPart[], {
    type: original ? "application/octet-stream" : media.mediaType,
  });
}

export async function iconDataPreview(
  media: GroupIcon,
  context: { csrf: string; current: () => boolean },
  signal: AbortSignal,
) {
  const binding = apiSessionSnapshot();
  const current = () =>
    !signal.aborted &&
    context.current() &&
    binding.csrf === context.csrf &&
    apiSessionSnapshot().epoch === binding.epoch;
  if (!current()) throw new Error("登录身份已变化");
  // Fetch only the validated served version; raw originals never enter img/src.
  const blob = await iconBlob(
    media,
    false,
    { csrf: context.csrf, current },
    signal,
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!current() || bytes.length !== media.size)
    throw new Error("图标预览状态已变化");
  const chunks: string[] = [];
  for (let at = 0; at < bytes.length; at += 16384)
    chunks.push(String.fromCharCode(...bytes.subarray(at, at + 16384)));
  const result = "data:" + media.mediaType + ";base64," + btoa(chunks.join(""));
  if (!current()) throw new Error("登录身份已变化");
  return result;
}
