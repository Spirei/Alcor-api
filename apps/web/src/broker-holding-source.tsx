import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { requestId } from "./request-id";

type Account = { id: string; name: string; revision: number; account_kind: string; holding_source: string };
type State = { accounts: Account[]; collectionRevision: number; recordCollectionRevision: number };
type Values = { qty: string | null; cost: string | null; price: string | null };
type Command = { kind: "holding-source"; accountId: string; data: { requestId: string; revision: number; accountKind: string; source: "manual" }; expectedCollectionRevision: number; expectedRecordCollectionRevision: number };
type Preview = { previewId: string; requestId: string; beforeSource: string; afterSource: string; expiresAt: string; records: { recordId: string; security: string; official: Values | null; manual: Values; historyState: string }[] };
type Receipt = { request_id: string; state: string; error?: { message: string } | null };
const root = "/account/broker-holding-source";
export function BrokerHoldingSourceSettings(props: { session: Session; accountId: string; onChanged: () => void }) {
  const s = props.session;
  return <Content key={JSON.stringify([s.instance_id,s.user.id,s.user.role,s.receipt_scope,s.csrf,s.expires_at,props.accountId])} {...props} />;
}
function Content({ session, accountId, onChanged }: { session: Session; accountId: string; onChanged: () => void }) {
  const key = "broker-holding-source:" + JSON.stringify([session.instance_id,session.user.id,session.user.role,session.receipt_scope]);
  const [state,setState] = useState<State | null>(null), [error,setError] = useState(""), [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false), [ack,setAck] = useState(false);
  const [proof,setProof] = useState<{ value: Preview; command: Command; epoch: number } | null>(null);
  const [pending,setPending] = useState<string | null>(() => { try { const id = sessionStorage.getItem(key); return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? id : null; } catch { return null; } });
  const epoch = useRef(0), alive = useRef(true);
  const invalidate = () => { epoch.current++; setProof(null); setAck(false); };
  const report = useCallback((failure: unknown) => { if (failure instanceof ApiError && [401,403].includes(failure.status)) { epoch.current++; setState(null); setProof(null); setAck(false); setPending(null); try { sessionStorage.removeItem(key); } catch { /* Retired in memory. */ } } setError(failure instanceof Error ? failure.message : "来源操作失败"); },[key]);
  const load = useCallback(async () => { const generation=epoch.current; try { const value=await api<State>(root); if (alive.current && generation===epoch.current) setState(value); } catch (failure) { if (alive.current && generation===epoch.current) report(failure); } },[report]);
  useEffect(() => { alive.current=true; void load(); const visibility=() => { epoch.current++; setProof(null); setAck(false); if (!document.hidden) void load(); }; document.addEventListener("visibilitychange",visibility); return () => { alive.current=false; epoch.current++; document.removeEventListener("visibilitychange",visibility); }; },[load]);
  useEffect(() => { if (!proof) return; const timer=window.setTimeout(() => { if (epoch.current===proof.epoch) { invalidate(); setError("来源预览已过期"); } },Math.max(0,Date.parse(proof.value.expiresAt)-Date.now())); return () => window.clearTimeout(timer); },[proof]);
  function remember(id: string | null) { try { if (id) sessionStorage.setItem(key,id); else sessionStorage.removeItem(key); setPending(id); return true; } catch { if (!id) setPending(null); else setError("无法保留原请求编号，未提交来源变更"); return !id; } }
  const account=state?.accounts.find(row=>row.id===accountId);
  async function prepare() {
    if (!account || !state || busy || pending || document.hidden) return;
    invalidate(); setError(""); setMessage(""); setBusy(true); const generation=epoch.current;
    const command: Command={kind:"holding-source",accountId,data:{requestId:requestId(),revision:account.revision,accountKind:account.account_kind,source:"manual"},expectedCollectionRevision:state.collectionRevision,expectedRecordCollectionRevision:state.recordCollectionRevision};
    try { const value=await api<Preview>(root+"/preview",{method:"POST",body:JSON.stringify(command)},session.csrf); if (alive.current && generation===epoch.current && Date.parse(value.expiresAt)>Date.now()) setProof({value,command,epoch:generation}); } catch (failure) { if (alive.current && generation===epoch.current) report(failure); } finally { setBusy(false); }
  }
  function accept(value: Receipt,id: string) { if (value.request_id!==id || !["completed","closed","failed"].includes(value.state)) throw new Error("原请求回执仍待核对"); remember(null); invalidate(); if (value.state==="failed") setError(value.error?.message || "来源未修改"); else setMessage(value.state==="closed" ? "原请求已关闭" : "已切换为手工登记"); if (value.state==="completed") { void load(); onChanged(); } }
  async function commit() {
    const current=proof; if (!current || current.epoch!==epoch.current || !ack || busy || pending || document.hidden || Date.parse(current.value.expiresAt)<=Date.now()) return;
    if (!remember(current.value.requestId)) return; setBusy(true); setError(""); const generation=epoch.current;
    try { const value=await api<Receipt>(root+"/operations",{method:"POST",body:JSON.stringify({previewId:current.value.previewId,command:current.command,acknowledgeProjectionChange:true})},session.csrf); if (alive.current && generation===epoch.current) accept(value,current.value.requestId); } catch (failure) { if (alive.current && generation===epoch.current) { report(failure); invalidate(); } } finally { setBusy(false); }
  }
  async function resolve(close=false) { if (!pending || busy || document.hidden) return; const id=pending,generation=epoch.current; setBusy(true); setError(""); try { const value=await api<Receipt>(root+"/operations/"+id+(close?"/close":""),close?{method:"POST",body:"{}"}:{},close?session.csrf:undefined); if (alive.current && generation===epoch.current) accept(value,id); } catch(failure) { if (alive.current && generation===epoch.current) report(failure); } finally { setBusy(false); } }
  const current=proof && proof.epoch===epoch.current ? proof : null;
  const values=(value: Values | null) => value ? `${value.qty ?? "未知"} / ${value.cost ?? "未知"} / ${value.price ?? "未知"}` : "未知";
  return <div className="form-grid">
    {error && <p role="alert" className="error">{error}</p>}{message && <p role="status">{message}</p>}
    {account && <p>{account.name} · {account.holding_source==="official"?"官方账单":account.holding_source==="manual"?"手工登记":"来源未核实"}</p>}
    <button disabled={busy || !!pending || !account || account.holding_source!=="official"} onClick={()=>void prepare()}>预览切换为手工登记</button>
    {current && <><table><thead><tr><th>证券</th><th>官方数量 / 成本 / 价格</th><th>手工数量 / 成本 / 价格</th></tr></thead><tbody>{current.value.records.map(row=><tr key={row.recordId}><td>{row.security}</td><td>{values(row.official)}</td><td>{values(row.manual)}</td></tr>)}</tbody></table><label><input type="checkbox" checked={ack} onChange={event=>setAck(event.target.checked)} disabled={busy || !!pending}/>确认按手工登记值显示；不复制官方金额、不改历史流水，保留来源配置并使原待生成任务失效</label><button disabled={!ack || busy || !!pending} onClick={()=>void commit()}>确认切换</button></>}
    {pending && <div><p role="status">结果待核对</p><code>{pending}</code><button disabled={busy} onClick={()=>void resolve()}>查询原请求</button><button disabled={busy} onClick={()=>void resolve(true)}>关闭未执行请求</button></div>}
  </div>;
}
