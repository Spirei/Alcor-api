import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { requestId } from "./request-id";

type Account = { id: string; name: string; revision: number; account_kind: string; holding_source: string };
type Row = { id: string; name: string; code: string; market: string; brokerAccountId: string; revision: number; qty: string | null; cost: string | null; actualKnown: boolean; blockedReason: string | null };
type State = { accounts: Account[]; records: Row[]; recordCollectionRevision: number; partial: boolean };
type Command = { requestId: string; sourceRecordId: string; sourceRecordRevision: number; sourceAccountId: string; sourceAccountRevision: number; targetAccountId: string; targetAccountRevision: number; accountKind: string; quantity: string; expectedRecordCollectionRevision: number; evidence: { kind: "owner_recorded_transfer"; reference: string; occurredAt: string } };
type Preview = { previewId: string; requestId: string; targetRecordId: string; sourceBefore: Row; sourceAfter: Row; targetAfter: Row; transferQuantity: string; unitCost: string; cashEffect: "none"; expiresAt: string };
type Receipt = { requestId: string; state: string; message?: string };
const root = "/account/broker-position-transfers";
export function BrokerPositionTransferSettings(props: { session: Session; accountId: string; onChanged: () => void }) {
  const s=props.session;return <Content key={JSON.stringify([s.instance_id,s.user.id,s.user.role,s.receipt_scope,s.csrf,s.expires_at,props.accountId])} {...props}/>;
}
function Content({session,accountId,onChanged}: {session: Session;accountId:string;onChanged:()=>void}) {
  const key="broker-position-transfer:"+JSON.stringify([session.instance_id,session.user.id,session.user.role,session.receipt_scope]);
  const [state,setState]=useState<State|null>(null),[selected,setSelected]=useState(""),[target,setTarget]=useState(""),[reference,setReference]=useState(""),[occurredAt,setOccurredAt]=useState("");
  const [proof,setProof]=useState<{value:Preview;command:Command;epoch:number}|null>(null),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const [pending,setPending]=useState<string|null>(()=>{try{const id=sessionStorage.getItem(key);return id&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)?id:null;}catch{return null;}});
  const epoch=useRef(0),alive=useRef(true);
  function invalidate(){epoch.current++;setProof(null);setAck(false);}
  const report=useCallback((failure:unknown)=>{if(failure instanceof ApiError&&[401,403].includes(failure.status)){epoch.current++;setState(null);setProof(null);setAck(false);setSelected("");setTarget("");setReference("");setOccurredAt("");setPending(null);try{sessionStorage.removeItem(key);}catch{/* Retired locally. */}}setError(failure instanceof Error?failure.message:"转仓操作失败");},[key]);
  const load=useCallback(async()=>{const generation=epoch.current;try{const value=await api<State>(root);if(alive.current&&generation===epoch.current)setState(value);}catch(failure){if(alive.current&&generation===epoch.current)report(failure);}},[report]);
  useEffect(()=>{alive.current=true;void load();const visibility=()=>{epoch.current++;setProof(null);setAck(false);if(!document.hidden)void load();};document.addEventListener('visibilitychange',visibility);return()=>{alive.current=false;epoch.current++;document.removeEventListener('visibilitychange',visibility);};},[load]);
  useEffect(()=>{if(!proof)return;const timer=window.setTimeout(()=>{if(epoch.current===proof.epoch){invalidate();setError("转仓预览已过期");}},Math.max(0,Date.parse(proof.value.expiresAt)-Date.now()));return()=>window.clearTimeout(timer);},[proof]);
  const source=state?.accounts.find(row=>row.id===accountId),record=state?.records.find(row=>row.id===selected),destination=state?.accounts.find(row=>row.id===target);
  const targets=state?.accounts.filter(row=>row.id!==accountId&&row.holding_source==='manual'&&row.account_kind===source?.account_kind)||[];
  function remember(id:string|null){try{if(id)sessionStorage.setItem(key,id);else sessionStorage.removeItem(key);setPending(id);return true;}catch{if(!id)setPending(null);else setError("无法保留原请求编号，未提交转仓");return !id;}}
  async function prepare(){if(!state||!source||!destination||!record||!record.actualKnown||record.qty===null||record.cost===null||busy||pending||document.hidden)return;
    if(!reference.trim()||!/(?:Z|[+-]\d{2}:\d{2})$/i.test(occurredAt)||!Number.isFinite(Date.parse(occurredAt))){setError("请填写转仓依据和带时区的实际转仓时间");return;}
    invalidate();setError("");setMessage("");setBusy(true);const generation=epoch.current;
    const command:Command={requestId:requestId(),sourceRecordId:record.id,sourceRecordRevision:record.revision,sourceAccountId:source.id,sourceAccountRevision:source.revision,targetAccountId:destination.id,targetAccountRevision:destination.revision,accountKind:source.account_kind,quantity:record.qty,expectedRecordCollectionRevision:state.recordCollectionRevision,evidence:{kind:'owner_recorded_transfer',reference:reference.trim(),occurredAt}};
    try{const value=await api<Preview>(root+'/preview',{method:'POST',body:JSON.stringify(command)},session.csrf);if(alive.current&&generation===epoch.current&&Date.parse(value.expiresAt)>Date.now())setProof({value,command,epoch:generation});}catch(failure){if(alive.current&&generation===epoch.current)report(failure);}finally{setBusy(false);}}
  function accept(value:Receipt,id:string){if(value.requestId!==id||!['completed','closed'].includes(value.state))throw new Error("原转仓请求仍待核对");remember(null);invalidate();setMessage(value.state==='closed'?"原转仓请求已关闭":"转仓已登记");if(value.state==='completed'){void load();onChanged();}}
  async function commit(){const current=proof;if(!current||!ack||busy||pending||document.hidden||current.epoch!==epoch.current||Date.parse(current.value.expiresAt)<=Date.now())return;if(!remember(current.value.requestId))return;const generation=epoch.current;setBusy(true);setError("");try{const value=await api<Receipt>(root+'/operations',{method:'POST',body:JSON.stringify({previewId:current.value.previewId,command:current.command,confirmTransfer:true})},session.csrf);if(alive.current&&generation===epoch.current)accept(value,current.value.requestId);}catch(failure){if(alive.current&&generation===epoch.current){report(failure);invalidate();}}finally{setBusy(false);}}
  async function resolve(close=false){if(!pending||busy||document.hidden)return;const id=pending,generation=epoch.current;setBusy(true);setError("");try{const value=await api<Receipt>(root+'/operations/'+id+(close?'/close':''),close?{method:'POST',body:'{}'}:{},close?session.csrf:undefined);if(alive.current&&generation===epoch.current)accept(value,id);}catch(failure){if(alive.current&&generation===epoch.current)report(failure);}finally{setBusy(false);}}
  const current=proof&&proof.epoch===epoch.current?proof:null;
  return <div className="form-grid">
    {error&&<p role="alert" className="error">{error}</p>}{message&&<p role="status">{message}</p>}{state?.partial&&<p role="status">当前候选目录不完整，请先核对完整账户记录</p>}
    <label>转出持仓<select disabled={busy||!!pending} value={selected} onChange={event=>{invalidate();setSelected(event.target.value);}}><option value="">请选择</option>{state?.records.filter(row=>row.brokerAccountId===accountId).map(row=><option key={row.id} value={row.id} disabled={!row.actualKnown}>{row.name} · {row.market}:{row.code}{row.blockedReason?` · ${row.blockedReason}`:''}</option>)}</select></label>
    {record&&<p>全量数量 {record.qty??'未知'} · 登记单位成本 {record.cost??'未知'}</p>}
    <label>转入账户<select value={target} disabled={busy||!!pending} onChange={event=>{invalidate();setTarget(event.target.value);}}><option value="">请选择</option>{targets.map(row=><option key={row.id} value={row.id}>{row.name} · {row.account_kind==='real'?'真实':'模拟'}</option>)}</select></label>
    <label>转仓依据<input value={reference} maxLength={300} disabled={busy||!!pending} onChange={event=>{invalidate();setReference(event.target.value);}}/></label>
    <label>实际转仓时间（含时区）<input value={occurredAt} placeholder="2026-11-02T12:00:00+08:00" disabled={busy||!!pending} onChange={event=>{invalidate();setOccurredAt(event.target.value);}}/></label>
    <button disabled={busy||!!pending||!record?.actualKnown||!destination||!reference.trim()||!occurredAt||state?.partial} onClick={()=>void prepare()}>预览全量转仓</button>
    {current&&<><p>{source?.name} → {destination?.name}</p><p>转出数量 {current.value.transferQuantity} · 登记单位成本 {current.value.unitCost}</p><p>原记录余量 {current.value.sourceAfter.qty??'未知'} · 新记录数量 {current.value.targetAfter.qty??'未知'}</p><p>新记录 {current.value.targetRecordId}</p><label><input type="checkbox" disabled={busy||!!pending} checked={ack} onChange={event=>setAck(event.target.checked)}/>确认本人登记的实际转仓；原历史留在原账户，不移动现金</label><button disabled={busy||!!pending||!ack} onClick={()=>void commit()}>确认转仓</button></>}
    {pending&&<div><p role="status">转仓结果待核对</p><code>{pending}</code><button disabled={busy} onClick={()=>void resolve()}>查询原请求</button><button disabled={busy} onClick={()=>void resolve(true)}>关闭未执行请求</button></div>}
  </div>;
}
