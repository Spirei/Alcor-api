import { ApiError } from "./api";
import { apiSessionSnapshot, bindApiSession } from "./api-session";
import { personalFont, type PersonalFont } from "./personal-font-state";
import { personalFontFamily } from "./personal-font-id";
import { fontDigest } from "./personal-font-digest";
export type FontContext = { csrf: string; current: () => boolean };
export async function personalFontBytes(
  font: PersonalFont,
  context: FontContext,
  signal: AbortSignal,
) {
  personalFont(font);
  const binding = apiSessionSnapshot(),
    current = () =>
      !signal.aborted &&
      context.current() &&
      binding.csrf === context.csrf &&
      apiSessionSnapshot().epoch === binding.epoch;
  if (!current()) throw new Error("登录身份已变化");
  const controller = new AbortController(),
    abort = () => controller.abort(),
    timer = setTimeout(abort, 15000);
  signal.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(font.originalPath, {
      credentials: "same-origin",
      headers: { "X-CSRF-Token": context.csrf },
      signal: controller.signal,
    });
    if (!current()) throw new Error("登录身份已变化");
    if (response.headers.get("X-Alcor-Session-Changed") === "true") {
      bindApiSession(null);
      if (typeof window !== "undefined")
        window.dispatchEvent(new Event("alcor:session-changed"));
      throw new ApiError(
        409,
        "登录身份已变化，请重新核对",
        "",
        "session_changed",
      );
    }
    if (response.status === 401 && typeof window !== "undefined")
      window.dispatchEvent(new Event("alcor:session-expired"));
    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      throw new ApiError(
        response.status,
        (typeof failure?.detail === "string"
          ? failure.detail
          : typeof failure?.error === "string"
            ? failure.error
            : failure?.error?.message) ||
          `字体原件读取失败（HTTP ${response.status}）`,
      );
    }
    if (
      response.headers.get("Content-Length") !== String(font.size) ||
      response.headers.get("ETag") !== '"' + font.sha256 + '"' ||
      !response.body
    )
      throw new Error("字体原件大小或摘要不符");
    const parts: Uint8Array[] = [];
    let count = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (!current() || controller.signal.aborted)
          throw new Error("字体读取已停止");
        if (done) break;
        count += value.length;
        if (count > font.size) throw new Error("字体原件超过声明大小");
        parts.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (count !== font.size) throw new Error("字体原件不完整");
    const bytes = new Uint8Array(count);
    let at = 0;
    for (const p of parts) {
      bytes.set(p, at);
      at += p.length;
    }
    const ext = font.id.split(".").pop()!,
      magic = Array.from(bytes.subarray(0, 4))
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
    if (
      magic !==
      (
        {
          woff: "774f4646",
          woff2: "774f4632",
          ttf: "00010000",
          otf: "4f54544f",
        } as Record<string, string>
      )[ext]
    )
      throw new Error("字体原件类型不符");
    if (!current() || controller.signal.aborted)
      throw new Error("登录身份已变化");
    if (
      (await fontDigest(
        bytes,
        () => current() && !controller.signal.aborted,
      )) !== font.sha256
    )
      throw new Error("字体原件内容摘要不符");
    return bytes.buffer;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
export async function preparePersonalFont(
  font: PersonalFont,
  context: FontContext,
  signal: AbortSignal,
  preview = false,
) {
  const binding = apiSessionSnapshot(),
    current = () =>
      !signal.aborted &&
      context.current() &&
      binding.csrf === context.csrf &&
      apiSessionSnapshot().epoch === binding.epoch;
  if (!current()) throw new Error("登录身份已变化");
  const bytes = await personalFontBytes(font, { ...context, current }, signal);
  if (!current()) throw new Error("字体加载已停止");
  if (typeof FontFace === "undefined")
    throw new Error("当前浏览器无法加载自定义字体");
  const face = new FontFace(personalFontFamily(font.id, preview), bytes, {
    weight: "100 900",
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped: () => void = () => {};
  const canceled = new Promise<never>((_, reject) => {
    stopped = () => reject(new Error("字体加载已停止"));
    signal.addEventListener("abort", stopped, { once: true });
    timer = setTimeout(() => reject(new Error("字体加载超时")), 15000);
  });
  try {
    await Promise.race([face.load(), canceled]);
    if (!current() || face.status !== "loaded")
      throw new Error("字体尚未完成加载");
    return face;
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener("abort", stopped);
  }
}
