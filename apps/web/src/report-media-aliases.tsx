import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { requestId } from "./request-id";
type Alias = { legacyPath: string; scope: string; targetKind: string; targetId: string; revision: number; sha256: string; deleted: boolean };
type Receipt = { requestId: string; state: string; alias: Alias };
export function ReportMediaAliases({ session, reports, onDenied }: { session: Session; reports: { id: string; fileName: string }[]; onDenied: (reason: unknown) => void }) {
  const key = JSON.stringify(["report-media-alias", session.instance_id, session.user.id, session.user.role, session.receipt_scope]);
  const [open, setOpen] = useState(false), [rows, setRows] = useState<Alias[] | null>(null);
  const [path, setPath] = useState(""), [target, setTarget] = useState("");
  const [pending, setPending] = useState<string | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const epoch = useRef(0);
  useEffect(() => {
    try { const id = sessionStorage.getItem(key); if (id && /^[0-9a-f-]{36}$/i.test(id)) setPending(id); } catch { /* Only UUID is retained. */ }
    const hidden = () => { if (document.hidden) { epoch.current++; setRows(null); setPath(""); setTarget(""); setMessage(""); setBusy(false); } };
    document.addEventListener("visibilitychange", hidden);
    return () => { epoch.current++; document.removeEventListener("visibilitychange", hidden); };
  }, [key]);
  function fail(reason: unknown) {
    if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
      setRows(null); setPath(""); setTarget(""); setPending(null);
      try { sessionStorage.removeItem(key); } catch { /* Retire local locator. */ }
      onDenied(reason);
    }
    setMessage(reason instanceof Error ? reason.message : "映射操作失败");
  }
  function accept(value: Receipt) {
    if (value.state !== "completed") { setMessage("结果未知，请核对原请求"); return; }
    setRows(previous => [...(previous ?? []).filter(row => !(row.legacyPath === value.alias.legacyPath && row.scope === value.alias.scope)), value.alias]);
    sessionStorage.removeItem(key); setPending(null);
    setMessage(value.alias.deleted ? "映射已撤销；原文件保留" : "映射已登记");
  }
  async function run(action: "load" | "query" | "register" | "remove") {
    if (busy || document.hidden) return;
    const generation = epoch.current; setBusy(true); setMessage("");
    const current = () => generation === epoch.current && !document.hidden;
    try {
      if (action === "load") {
        const value = await api<{ aliases: Alias[] }>("/media-aliases", {}, session.csrf);
        if (current()) setRows(value.aliases.filter(row => row.targetKind === "report" && row.scope === "admin"));
      } else if (action === "query") {
        if (!pending) return;
        const value = await api<Receipt>("/media-aliases/operations/" + pending, {}, session.csrf);
        if (current()) accept(value);
      } else {
        if (pending || rows === null) return;
        const previous = rows.find(row => row.legacyPath === path && row.scope === "admin");
        if (!path.startsWith("/uploads/reports/") || !target) throw new Error("请填写旧报告路径并选择已登记文件");
        const id = requestId(); sessionStorage.setItem(key, id); setPending(id);
        const value = await api<Receipt>("/media-aliases", { method: "POST", body: JSON.stringify({ requestId: id, expectedRevision: previous?.revision ?? 0, legacyPath: path, targetKind: "report", targetId: target, scope: "admin", action }) }, session.csrf);
        if (current()) accept(value);
      }
    } catch (reason) { if (current()) fail(reason); }
    finally { if (current()) setBusy(false); }
  }
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>旧报告路径映射</summary>
    {open && <>
      <button disabled={busy} onClick={() => void run("load")}>读取已登记映射</button>
      {pending && <button disabled={busy} onClick={() => void run("query")}>核对原请求 {pending}</button>}
      {rows !== null && <>
        <ul>{rows.map(row => <li key={row.legacyPath}><button disabled={busy || !!pending} onClick={() => { setPath(row.legacyPath); setTarget(row.targetId); }}>{row.legacyPath} · {row.deleted ? "已撤销" : "已登记"}</button><span> {row.sha256}</span></li>)}</ul>
        <label>旧报告路径<input value={path} disabled={busy || !!pending} placeholder="/uploads/reports/" onChange={event => setPath(event.target.value)} /></label>
        <label>已登记报告<select value={target} disabled={busy || !!pending} onChange={event => setTarget(event.target.value)}><option value="">选择文件</option>{reports.map(report => <option key={report.id} value={report.id}>{report.fileName} · {report.id}</option>)}</select></label>
        <button disabled={busy || !!pending || !target || !reports.some(report => report.id === target)} onClick={() => void run("register")}>登记私有报告映射</button>
        <button disabled={busy || !!pending || !rows.some(row => row.legacyPath === path && !row.deleted && row.targetId === target)} onClick={() => void run("remove")}>撤销映射</button>
      </>}
      {message && <p role="status">{message}</p>}
    </>}
  </details>;
}
