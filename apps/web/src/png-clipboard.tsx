import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { requestId } from "./request-id";

// Only an already displayed, same-origin image is rasterized; no remote URLs.
export async function displayedImagePng(image: HTMLImageElement): Promise<Blob> {
  if (!image.complete || !image.naturalWidth || !image.naturalHeight)
    throw new Error("图片尚未加载");
  const source = new URL(image.currentSrc || image.src, location.href);
  if (source.origin !== location.origin) throw new Error("只能复制本站已登记图片");
  const width = image.naturalWidth, height = image.naturalHeight;
  if (width > 4096 || height > 4096 || width * height > 16000000)
    throw new Error("图片尺寸超出复制范围，请下载原件");
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法生成 PNG");
    context.drawImage(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      value => value ? resolve(value) : reject(new Error("PNG 生成失败")), "image/png",
    ));
    if (blob.size > 8 * 1024 * 1024) throw new Error("PNG 超出 8 MiB，请下载原件");
    return blob;
  } finally { canvas.width = 0; canvas.height = 0; }
}

type Receipt = { requestId: string; state: string; ok?: boolean; clientClipboardConfirmed?: boolean };
type Capabilities = { host: { available: boolean; state: string } };
export function PngClipboardActions({ session, active, image, version, onDenied }: {
  session: Session; active: boolean; image: { current: HTMLImageElement | null }; version: string; onDenied: (reason: unknown) => void;
}) {
  const storageKey = JSON.stringify(["png-clipboard", session.instance_id, session.user.id, session.user.role, session.receipt_scope]);
  const [pending, setPending] = useState<string | null>(null);
  const [host, setHost] = useState<Capabilities["host"] | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const epoch = useRef(0), live = useRef(active);
  live.current = active;
  useEffect(() => {
    epoch.current++; setHost(null); setMessage(""); setBusy(false);
    try {
      const saved = sessionStorage.getItem(storageKey);
      setPending(saved && /^[0-9a-f-]{36}$/i.test(saved) ? saved : null);
    } catch { setPending(null); }
    return () => { epoch.current++; };
  }, [storageKey, session.csrf, version, active]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) { epoch.current++; setHost(null); setMessage(""); setBusy(false); } };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);
  const current = (generation: number) => live.current && !document.hidden && generation === epoch.current;
  function failure(reason: unknown) {
    if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
      setHost(null); setPending(null); onDenied(reason);
      try { sessionStorage.removeItem(storageKey); } catch { /* No payload is retained. */ }
    }
    setMessage(reason instanceof Error ? reason.message : "操作失败");
  }
  function showReceipt(value: Receipt) {
    if (value.state === "completed" && value.ok === true) {
      setMessage("已复制到配置的 Mac 主机；当前设备剪贴板未确认");
    } else setMessage(value.state === "unknown" ? "主机复制结果未知，请核对原请求" : "配置的主机当前无法复制");
    if (["completed", "unavailable"].includes(value.state)) {
      sessionStorage.removeItem(storageKey); setPending(null);
    }
  }
  async function run(action: "browser" | "download" | "capabilities" | "host" | "query") {
    if (busy || !active || document.hidden) return;
    const generation = epoch.current; setBusy(true); setMessage("");
    try {
      if (action === "capabilities") {
        const value = await api<Capabilities>("/clipboard/capabilities", {}, session.csrf);
        if (current(generation)) { setHost(value.host); if (!value.host.available) setMessage("主机剪贴板未授权或不可用，请下载 PNG"); }
        return;
      }
      if (action === "query") {
        if (!pending) return;
        const value = await api<Receipt>("/clipboard/operations/" + pending, {}, session.csrf);
        if (current(generation)) showReceipt(value);
        return;
      }
      if (!image.current) throw new Error("图片尚未加载");
      if (action === "browser") {
        if (!window.isSecureContext || !navigator.clipboard?.write || typeof ClipboardItem === "undefined")
          throw new Error("当前浏览器无法复制图片，请下载 PNG");
        // Invoke write in the original click gesture; browsers may defer PNG encoding.
        await navigator.clipboard.write([new ClipboardItem({ "image/png": displayedImagePng(image.current) })]);
        if (current(generation)) setMessage("已复制到当前设备剪贴板");
        return;
      }
      const blob = await displayedImagePng(image.current);
      if (!current(generation)) return;
      if (action === "download") {
        const url = URL.createObjectURL(blob), link = document.createElement("a");
        link.href = url; link.download = "image-" + version + ".png"; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage("已提供 PNG 下载"); return;
      }
      if (!host?.available || pending) return;
      const encoded = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("PNG 读取失败")); reader.readAsDataURL(blob);
      });
      if (!current(generation)) return;
      const id = requestId();
      sessionStorage.setItem(storageKey, id); setPending(id);
      const value = await api<Receipt>("/clipboard", { method: "POST", body: JSON.stringify({ requestId: id, image: encoded }) }, session.csrf);
      if (current(generation)) showReceipt(value);
    } catch (reason) { if (current(generation)) failure(reason); }
    finally { if (current(generation)) setBusy(false); }
  }
  return <div className="shared-asset-actions">
    <button className="button secondary" disabled={busy || !active} onClick={() => void run("browser")}>复制 PNG</button>
    <button className="button secondary" disabled={busy || !active} onClick={() => void run("download")}>下载 PNG</button>
    {!host && <button className="button secondary" disabled={busy || !active} onClick={() => void run("capabilities")}>查看主机复制能力</button>}
    {host?.available && !pending && <button className="button secondary" disabled={busy || !active} onClick={() => void run("host")}>复制到配置的 Mac 主机</button>}
    {pending && <button className="button secondary" disabled={busy || !active} onClick={() => void run("query")}>核对主机复制原请求 {pending}</button>}
    {message && <p role="status">{message}</p>}
  </div>;
}
