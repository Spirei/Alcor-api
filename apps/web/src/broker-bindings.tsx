import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { requestId } from "./request-id";

type Account = { id: string; name: string; account_kind: string; holding_source: string; revision: number };
type Row = { id: string; name: string; code: string; market: string; brokerAccountId: string; qty: string | null; historyState: string; accountKindClaim: string | null; revision: number };
type State = { accounts: Account[]; records: Row[]; partial: boolean; collectionRevision: number; recordCollectionRevision: number };
type Command = { kind: "bind" | "unbind"; accountId: string; expectedCollectionRevision: number; expectedRecordCollectionRevision: number; data: { requestId: string; revision: number; accountKind: string; records: { id: string; revision: number }[]; allowReassign: boolean } };
type Preview = { previewId: string; requestId: string; kind: string; accountId: string; accountKind: string; expiresAt: string; records: { recordId: string; beforeAccountId: string | null; beforeAccountName?: string | null; data: { name: string; group: string; brokerAccountId: string } }[] };
type Receipt = { request_id: string; state: string; error?: { message?: string } | null };
const root = "/account/broker-bindings";
const kinds: Record<string,string> = { real: "真实账本", simulated: "模拟账本", unknown: "未核对" };
const emptyQuantity = (value: string | null) => value === null || /^-?0+(?:\.0+)?$/.test(value);

export function BrokerBindingsSettings(props: { session: Session; initialAccountId: string; active?: boolean; onChanged?: () => void }) {
  const s = props.session;
  return <Content key={JSON.stringify([s.instance_id,s.user.id,s.user.role,s.receipt_scope,s.csrf,s.expires_at,props.initialAccountId])} {...props} />;
}
function Content({ session,initialAccountId,active = true,onChanged }: { session: Session; initialAccountId: string; active?: boolean; onChanged?: () => void }) {
  const key = "broker-bindings:" + JSON.stringify([session.instance_id,session.user.id,session.user.role,session.receipt_scope]);
  const [state,setState] = useState<State | null>(null), [accountId,setAccountId] = useState(initialAccountId);
  const [mode,setMode] = useState<"bind" | "unbind">("bind"), [selected,setSelected] = useState<string[]>([]), [allowReassign,setAllowReassign] = useState(false), [search,setSearch] = useState("");
  const [proof,setProof] = useState<{ value: Preview; command: Command; epoch: number } | null>(null);
  const [busy,setBusy] = useState(false), [error,setError] = useState(""), [message,setMessage] = useState("");
  const [pending,setPending] = useState<string | null>(() => { try { const id = sessionStorage.getItem(key); if (id && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) return id; if (id) sessionStorage.removeItem(key); } catch { /* No body is recovered or resent. */ } return null; });
  const epoch = useRef(0), visible = useRef(active);
  if (visible.current !== active) { visible.current = active; epoch.current++; }
  function invalidate() { epoch.current++; setProof(null); }
  const report = useCallback((failure: unknown) => {
    if (failure instanceof ApiError && [401,403].includes(failure.status)) {
      epoch.current++; setState(null); setSelected([]); setProof(null); setPending(null); setSearch("");
      try { sessionStorage.removeItem(key); } catch { /* Context has been retired in memory. */ }
    }
    setError(failure instanceof Error ? failure.message : "归属操作失败");
  },[key]);
  const load = useCallback(async () => {
    const generation = epoch.current;
    try { const result = await api<State>(root); if (visible.current && generation === epoch.current) setState(result); }
    catch (failure) { if (visible.current && generation === epoch.current) report(failure); }
  },[report]);
  useEffect(() => {
    if (!active) return; visible.current = true; epoch.current++; setProof(null); void load();
    const hide = () => { epoch.current++; setProof(null); if (document.visibilityState === "visible" && visible.current) void load(); };
    document.addEventListener("visibilitychange",hide);
    return () => { visible.current = false; epoch.current++; document.removeEventListener("visibilitychange",hide); };
  },[active,load]);
  useEffect(() => {
    if (!proof) return;
    const timer = window.setTimeout(() => { if (epoch.current === proof.epoch) { epoch.current++; setProof(null); setError("归属预览已过期"); } },Math.max(0,Date.parse(proof.value.expiresAt)-Date.now()));
    return () => window.clearTimeout(timer);
  },[proof]);
  const account = state?.accounts.find(row => row.id === accountId);
  const eligible = (row: Row) => !!account && ["real","simulated"].includes(account.account_kind) && account.holding_source === "manual" && row.historyState === "empty" && emptyQuantity(row.qty) && (!row.accountKindClaim || row.accountKindClaim === account.account_kind);
  const rows = state?.records.filter(row => (mode === "bind" ? row.brokerAccountId !== accountId : row.brokerAccountId === accountId) && (row.name + " " + row.market + " " + row.code).toLowerCase().includes(search.toLowerCase())) || [];
  function remember(id: string | null): boolean { try { if (id) sessionStorage.setItem(key,id); else sessionStorage.removeItem(key); setPending(id); return true; } catch { if (!id) { setPending(null); return true; } setError("无法保留原请求编号"); return false; } }
  function accept(result: Receipt,id: string) {
    if (result.request_id !== id || !["completed","failed","closed"].includes(result.state)) throw new Error("原请求回执仍待核对");
    remember(null); invalidate();
    if (result.state === "failed") setError(result.error?.message || "归属未修改");
    else setMessage(result.state === "closed" ? "请求已关闭" : "归属已保存");
    if (result.state === "completed") { setSelected([]); void load(); onChanged?.(); }
  }
  async function prepare() {
    if (!visible.current || document.hidden || !state || !account || busy || pending || !selected.length) return;
    const picked = state.records.filter(row => selected.includes(row.id));
    if (picked.length !== selected.length || picked.some(row => !eligible(row))) { setError("所选记录需先核对历史或账本归属"); return; }
    invalidate(); const generation = epoch.current; setBusy(true); setError(""); setMessage("");
    const command: Command = { kind: mode,accountId,expectedCollectionRevision: state.collectionRevision,expectedRecordCollectionRevision: state.recordCollectionRevision,data: { requestId: requestId(),revision: account.revision,accountKind: account.account_kind,records: picked.map(row => ({ id: row.id,revision: row.revision })),allowReassign } };
    try { const value = await api<Preview>(root + "/preview",{ method: "POST",body: JSON.stringify(command) },session.csrf); if (visible.current && generation === epoch.current) setProof({ value,command,epoch: generation }); }
    catch (failure) { if (visible.current && generation === epoch.current) report(failure); }
    finally { setBusy(false); }
  }
  async function commit() {
    if (!visible.current || document.hidden || !proof || busy || pending || proof.epoch !== epoch.current || Date.parse(proof.value.expiresAt) <= Date.now()) { invalidate(); return; }
    const prepared = proof, generation = epoch.current; if (!remember(prepared.value.requestId)) return;
    setBusy(true); setError("");
    try { const result = await api<Receipt>(root + "/operations",{ method: "POST",body: JSON.stringify({ previewId: prepared.value.previewId,command: prepared.command }) },session.csrf); if (visible.current && generation === epoch.current) accept(result,prepared.value.requestId); }
    catch (failure) { if (visible.current && generation === epoch.current) {  report(failure); invalidate(); } }
    finally { setBusy(false); }
  }
  async function resolve(close = false) {
    if (!pending || busy || document.hidden) return; const id = pending,generation = epoch.current; setBusy(true); setError("");
    try { const result = await api<Receipt>(root + "/operations/" + id + (close ? "/close" : ""),close ? { method: "POST",body: "{}" } : {},close ? session.csrf : undefined); if (visible.current && generation === epoch.current) accept(result,id); }
    catch (failure) { if (visible.current && generation === epoch.current) report(failure); }
    finally { setBusy(false); }
  }
  const current = proof && proof.epoch === epoch.current ? proof : null;
  return <div className="portfolio-form">
    {error && <p className="error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <label>账户<select value={accountId} disabled={busy || !!pending} onChange={event => { invalidate(); setAccountId(event.target.value); setSelected([]); setAllowReassign(false); }}><option value="">请选择</option>{state?.accounts.map(row => <option key={row.id} value={row.id}>{row.name} · {kinds[row.account_kind] || "未核对"}</option>)}</select></label>
    <label>操作<select value={mode} disabled={busy || !!pending} onChange={event => { invalidate(); setMode(event.target.value as "bind" | "unbind"); setSelected([]); }}><option value="bind">关联记录</option><option value="unbind">移出记录</option></select></label>
    <label>筛选<input value={search} onChange={event => setSearch(event.target.value)} /></label>
    {state?.partial && <p role="status">目录仅部分显示</p>}
    <fieldset disabled={busy || !!pending}><legend>记录</legend>{rows.map(row => <label key={row.id}><input type="checkbox" checked={selected.includes(row.id)} disabled={!eligible(row)} onChange={event => { invalidate(); setSelected(ids => event.target.checked ? [...ids,row.id] : ids.filter(id => id !== row.id)); }} />{row.name} · {row.market}/{row.code} · {row.qty === null ? "数量未登记" : "数量 " + row.qty}{row.historyState !== "empty" ? " · 历史待核对" : !emptyQuantity(row.qty) ? " · 需单独转仓" : row.accountKindClaim && row.accountKindClaim !== account?.account_kind ? " · 其他账本" : ""}</label>)}</fieldset>
    {mode === "bind" && <label><input type="checkbox" checked={allowReassign} disabled={busy || !!pending} onChange={event => { invalidate(); setAllowReassign(event.target.checked); }} />确认调整已有账户归属</label>}
    <div className="portfolio-actions"><button disabled={busy || !!pending || !account || !selected.length || selected.length > 200} onClick={() => void prepare()}>预览归属</button><button disabled={busy} onClick={() => { invalidate(); void load(); }}>重新核对</button></div>
    {current && <div><p>{kinds[current.value.accountKind]} · {current.value.records.length} 条记录</p>{current.value.records.map(row => <p key={row.recordId}>{row.data.name} · {row.beforeAccountId ? row.beforeAccountName || "账户待核对" : "未归属"} → {row.data.brokerAccountId ? row.data.group : "未归属"}</p>)}<button disabled={busy || !!pending} onClick={() => void commit()}>确认{current.value.kind === "bind" ? "关联" : "移出"}</button></div>}
    {pending && <div><p role="status">结果待核对</p><code>{pending}</code><div className="portfolio-actions"><button disabled={busy} onClick={() => void resolve()}>查询原请求</button><button disabled={busy} onClick={() => void resolve(true)}>关闭未执行请求</button></div></div>}
  </div>;
}
