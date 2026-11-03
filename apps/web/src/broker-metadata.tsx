import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { requestId } from "./request-id";

type Account = { id: string; name: string; provider_id: string | null; account_kind: string; currency: string; currencies: string[]; revision: number };
type Snapshot = { accounts: Account[]; collectionRevision: number; recordCollectionRevision: number; presets: { id: string; name: string }[]; capabilities: { supported_currencies: string[] } };
type Command = { kind: "create" | "update" | "delete"; accountId: string; expectedCollectionRevision: number; expectedRecordCollectionRevision: number; data: Record<string, unknown> };
type Preview = { previewId: string; requestId: string; expiresAt: string; kind: string; before: Account | null; after: Record<string, unknown> | null };
type Receipt = { request_id: string; state: string; error: { message: string } | null };
type Draft = { id: string; name: string; provider: string; kind: string; currency: string; currencies: string[]; revision: number; collection: number; records: number };
const root = "/account/broker-metadata";
const empty: Draft = { id: "", name: "", provider: "", kind: "", currency: "USD", currencies: ["USD"], revision: 0, collection: 0, records: 0 };
const kinds: Record<string,string> = { real: "真实账本", simulated: "模拟账本", unknown: "未核对" };
export function BrokerMetadataSettings(props: { session: Session; active?: boolean; initialAccountId?: string; onChanged?: () => void }) {
  const s = props.session;
  return <Content key={JSON.stringify([s.instance_id,s.user.id,s.user.role,s.receipt_scope,s.csrf,s.expires_at,props.initialAccountId])} {...props} />;
}
function Content({ session, active = true, initialAccountId = "", onChanged }: { session: Session; active?: boolean; initialAccountId?: string; onChanged?: () => void }) {
  const storageKey = "broker-metadata:" + JSON.stringify([session.instance_id,session.user.id,session.user.role,session.receipt_scope]);
  const [snapshot,setSnapshot] = useState<Snapshot | null>(null);
  const [draft,setDraft] = useState<Draft>(empty);
  const [preview,setPreview] = useState<{ value: Preview; command: Command; epoch: number } | null>(null);
  const [pending,setPending] = useState<string | null>(() => { try { const id = sessionStorage.getItem(storageKey); if (id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return id; if (id) sessionStorage.removeItem(storageKey); return null; } catch { return null; } });
  const [error,setError] = useState(""); const [message,setMessage] = useState(""); const [busy,setBusy] = useState(false);
  const epoch = useRef(0), alive = useRef(active), initialized = useRef(false);
  if (alive.current !== active) { alive.current = active; epoch.current++; }
  const invalidate = () => { epoch.current++; setPreview(null); };
  const report = useCallback((failure: unknown) => {
    if (failure instanceof ApiError && [401,403].includes(failure.status)) {
      epoch.current++; setSnapshot(null); setPreview(null); setDraft(empty); setPending(null);
      try { sessionStorage.removeItem(storageKey); } catch { /* Memory state is already retired. */ }
    }
    setError(failure instanceof Error ? failure.message : "账户操作失败");
  },[storageKey]);
  const load = useCallback(async (reset = false, rebase = false) => {
    const generation = epoch.current;
    try {
      const data = await api<Snapshot>(root);
      if (!alive.current || generation !== epoch.current) return;
      setSnapshot(data);
      if (!initialized.current || reset) {
        initialized.current = true;
        const account = !reset ? data.accounts.find(item => item.id === initialAccountId) : undefined;
        setDraft(account ? { id: account.id,name: account.name,provider: account.provider_id || "",kind: account.account_kind,currency: account.currency,currencies: [...account.currencies],revision: account.revision,collection: data.collectionRevision,records: data.recordCollectionRevision } : { ...empty,id: reset ? "" : initialAccountId,collection: data.collectionRevision,records: data.recordCollectionRevision });
        if (!reset && initialAccountId && !account) setError("账户已不存在，请重新选择");
      }
      else if (rebase) setDraft(current => {
        const account = data.accounts.find(item => item.id === current.id);
        if (current.id && !account) return current;
        return { ...current,revision: account?.revision || 0,collection: data.collectionRevision,records: data.recordCollectionRevision };
      });
    } catch (failure) { if (alive.current && generation === epoch.current) report(failure); }
  },[report,initialAccountId]);
  useEffect(() => {
    if (!active) return;
    alive.current = true; epoch.current++; setPreview(null); void load();
    const visibility = () => { epoch.current++; setPreview(null); if (document.visibilityState === "visible" && alive.current) void load(); };
    document.addEventListener("visibilitychange",visibility);
    return () => { alive.current = false; epoch.current++; document.removeEventListener("visibilitychange",visibility); };
  },[active,load]);
  useEffect(() => {
    if (!preview) return;
    const timer = window.setTimeout(() => {
      if (epoch.current === preview.epoch) { epoch.current++; setPreview(null); setError("账户预览已过期"); }
    },Math.max(0,Date.parse(preview.value.expiresAt)-Date.now()));
    return () => window.clearTimeout(timer);
  },[preview]);
  function remember(id: string | null): boolean { try { if (id) sessionStorage.setItem(storageKey,id); else sessionStorage.removeItem(storageKey); setPending(id); return true; } catch { if (!id) { setPending(null); return true; } setError("无法保留原请求编号，未提交账户变更"); return false; } }
  function edit(patch: Partial<Draft>) { invalidate(); setDraft(current => ({ ...current,...patch })); setMessage(""); }
  function select(id: string) {
    if (!snapshot) return; invalidate(); setError(""); setMessage("");
    const account = snapshot.accounts.find(item => item.id === id);
    setDraft(account ? { id: account.id,name: account.name,provider: account.provider_id || "",kind: account.account_kind,currency: account.currency,currencies: [...account.currencies],revision: account.revision,collection: snapshot.collectionRevision,records: snapshot.recordCollectionRevision } : { ...empty,collection: snapshot.collectionRevision,records: snapshot.recordCollectionRevision });
  }
  async function prepare(deleting = false) {
    if (!snapshot || busy || pending || !alive.current || document.hidden) return;
    invalidate(); setBusy(true); setError(""); setMessage(""); const generation = epoch.current;
    const id = requestId();
    const data: Record<string,unknown> = deleting ? { request_id: id,revision: draft.revision } : { request_id: id,name: draft.name,currency: draft.currency,currencies: draft.currencies,...(draft.id ? { revision: draft.revision } : { provider_id: draft.provider || null,account_kind: draft.kind }) };
    const command: Command = { kind: deleting ? "delete" : draft.id ? "update" : "create",accountId: draft.id,data,expectedCollectionRevision: draft.collection,expectedRecordCollectionRevision: draft.records };
    try {
      const value = await api<Preview>(root + "/preview",{ method: "POST",body: JSON.stringify(command) },session.csrf);
      if (alive.current && generation === epoch.current && Date.parse(value.expiresAt) > Date.now()) setPreview({ value,command,epoch: generation });
    } catch (failure) { if (alive.current && generation === epoch.current) report(failure); }
    finally { setBusy(false); }
  }
  function accept(result: Receipt, id: string) {
    if (result.request_id !== id || !["completed","failed","closed"].includes(result.state)) throw new Error("原请求回执仍待核对");
    remember(null); invalidate();
    if (result.state === "failed") setError(result.error?.message || "账户未保存");
    else setMessage(result.state === "closed" ? "请求已关闭" : "已保存");
    void load(result.state === "completed"); if (result.state === "completed") onChanged?.();
  }
  async function commit() {
    const proof = preview;
    if (!alive.current || document.hidden || !proof || proof.epoch !== epoch.current || busy || pending || Date.parse(proof.value.expiresAt) <= Date.now()) { invalidate(); return; }
    const generation = epoch.current; if (!remember(proof.value.requestId)) return; setBusy(true); setError("");
    try {
      const result = await api<Receipt>(root + "/operations",{ method: "POST",body: JSON.stringify({ previewId: proof.value.previewId,command: proof.command }) },session.csrf);
      if (alive.current && generation === epoch.current) accept(result,proof.value.requestId);
    } catch (failure) {
      if (alive.current && generation === epoch.current) {

        report(failure); invalidate();
      }
    } finally { setBusy(false); }
  }
  async function resolve(close = false) {
    if (!pending || busy || document.hidden) return; const id = pending,generation = epoch.current; setBusy(true); setError("");
    try {
      const result = await api<Receipt>(root + "/operations/" + id + (close ? "/close" : ""),close ? { method: "POST",body: "{}" } : {},close ? session.csrf : undefined);
      if (alive.current && generation === epoch.current) accept(result,id);
    } catch (failure) { if (alive.current && generation === epoch.current) report(failure); }
    finally { setBusy(false); }
  }
  const proof = preview && preview.epoch === epoch.current ? preview : null;
  const afterCurrencies = proof?.value.after?.currencies;
  return <div className="form-grid">
    {error && <p role="alert" className="error">{error}</p>}{message && <p role="status">{message}</p>}
    <label>账户<select value={draft.id} onChange={event => select(event.target.value)} disabled={busy || !!pending}><option value="">新账户</option>{draft.id && snapshot && !snapshot.accounts.some(account => account.id === draft.id) && <option value={draft.id} disabled>账户已不存在</option>}{snapshot?.accounts.map(account => <option key={account.id} value={account.id}>{account.name} · {kinds[account.account_kind] || "未核对"}</option>)}</select></label>
    <label>名称<input value={draft.name} onChange={event => edit({ name: event.target.value })} disabled={busy || !!pending} maxLength={60} /></label>
    {!draft.id && <><label>账本类型<select value={draft.kind} onChange={event => edit({ kind: event.target.value })} disabled={busy || !!pending}><option value="">请选择</option><option value="real">真实账本</option><option value="simulated">模拟账本</option></select></label><label>机构<select value={draft.provider} onChange={event => edit({ provider: event.target.value })} disabled={busy || !!pending}><option value="">其他</option>{snapshot?.presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label></>}
    <label>默认币种<select value={draft.currency} onChange={event => edit({ currency: event.target.value,currencies: [...new Set([...draft.currencies,event.target.value])] })} disabled={busy || !!pending}>{snapshot?.capabilities.supported_currencies.map(currency => <option key={currency} value={currency}>{currency}</option>)}</select></label>
    <fieldset disabled={busy || !!pending}><legend>账户币种</legend>{snapshot?.capabilities.supported_currencies.map(currency => <label key={currency}><input type="checkbox" checked={draft.currencies.includes(currency)} disabled={currency === draft.currency} onChange={event => edit({ currencies: event.target.checked ? [...draft.currencies,currency] : draft.currencies.filter(value => value !== currency) })} />{currency}</label>)}</fieldset>
    <div className="actions"><button disabled={busy || !!pending || !snapshot || !draft.name.trim() || (!draft.id && !draft.kind)} onClick={() => void prepare()}>预览{draft.id ? "修改" : "创建"}</button>{draft.id && <button disabled={busy || !!pending} onClick={() => void prepare(true)}>预览删除</button>}<button disabled={busy} onClick={() => { invalidate(); void load(false,true); }}>重新核对</button></div>
    {proof && <div><p>{proof.value.kind === "delete" ? "删除账户" : "账户变更"}</p><p>{proof.value.before?.name || "—"} → {proof.value.after?.name as string || "—"}</p><p>{kinds[(proof.value.after?.account_kind as string) || proof.value.before?.account_kind || "unknown"] || "未核对"}</p><p>{proof.value.before?.currencies.join("、") || "—"} → {Array.isArray(afterCurrencies) ? afterCurrencies.join("、") : "—"}</p><button disabled={busy || !!pending} onClick={() => void commit()}>确认{proof.value.kind === "delete" ? "删除" : "保存"}</button></div>}
    {pending && <div><p role="status">结果待核对</p><code>{pending}</code><div className="actions"><button disabled={busy} onClick={() => void resolve()}>查询原请求</button><button disabled={busy} onClick={() => void resolve(true)}>关闭未执行请求</button></div></div>}
  </div>;
}
