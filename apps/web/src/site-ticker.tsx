import { useEffect, useRef, useState } from "react";
type Snapshot = { state?: string; items: { key: string; label: string; market: string; price: number | null; change: number | null; changePct: number | null; priceExact?:string|null;changePctExact?:string|null }[]; coverage?: unknown };
export function SiteTicker() {
  const [open, setOpen] = useState(false), [snapshot, setSnapshot] = useState<Snapshot | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const clear = () => { if (document.hidden) { controller.current?.abort(); setSnapshot(null); setError(""); setBusy(false); } };
    document.addEventListener("visibilitychange", clear);
    return () => { controller.current?.abort(); document.removeEventListener("visibilitychange", clear); };
  }, []);
  async function read() {
    if (busy || document.hidden) return;
    const request = new AbortController(); controller.current = request; setBusy(true); setError("");
    try {
      const response = await fetch("/api/ticker", { credentials: "same-origin", cache: "no-store", signal: request.signal });
      if (!response.ok) throw new Error(response.status === 503 ? "指数栏暂无已授权来源" : "指数栏暂不可读取");
      const value: Snapshot = await response.json();
      if (!Array.isArray(value.items)) throw new Error("指数栏返回无效");
      if (!request.signal.aborted && !document.hidden) setSnapshot(value);
    } catch (reason) { if (!request.signal.aborted) { setSnapshot(null); setError(reason instanceof Error ? reason.message : "读取失败"); } }
    finally { if (controller.current === request) { controller.current = null; setBusy(false); } }
  }
  return <details onToggle={event => { setOpen(event.currentTarget.open); if (!event.currentTarget.open) { controller.current?.abort(); setSnapshot(null); setError(""); setBusy(false); } }}>
    <summary>指数栏</summary>
    {open && <><button disabled={busy} onClick={() => void read()}>读取已保存观察</button>{error && <p role="status">{error}</p>}{snapshot && <><p>{snapshot.state === "observed" ? "已保存观察" : "来源观察不完整或未知"}</p><ul>{snapshot.items.map(item => <li key={item.key}>{item.label} · {item.market} · {item.priceExact ?? item.price ?? "未知"} · {item.changePct == null ? "涨跌幅未知" : (item.changePctExact ?? item.changePct) + "%"}</li>)}</ul></>}</>}
  </details>;
}
