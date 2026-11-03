import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { requestId } from "./request-id";

type Cache = {processId:string;revision:number;entries:number;scope:string;workerAffected:boolean;redisAffected:boolean};
type Head = {instanceId:string;cache:Cache;recovery:{state:string;completeRecoveryVerified:boolean|null;backups:{registered:number;verified:number;last_verified_at:string|null};taskCounts:{status:string;count:number}[];recentTasks:{id:string;kind:string;status:string;error_code:string|null}[];quarantine:{category:string;quarantinedAt:string}[];quarantined:boolean}};
type Receipt = {requestId:string;state:string;cache?:Cache};
const root='/admin/system-operations';
export function SystemOperationsPanel({session,active=true}:{session:Session;active?:boolean}) {
 return <Panel key={JSON.stringify([session.instance_id,session.user.id,session.user.role,session.receipt_scope,session.csrf,session.expires_at])} session={session} active={active}/>;
}
function Panel({session,active}:{session:Session;active:boolean}) {
 const storage=JSON.stringify(['system-registry-cache',session.instance_id,session.user.id,session.user.role,session.receipt_scope]);
 const [open,setOpen]=useState(false),[head,setHead]=useState<Head|null>(null),[pending,setPending]=useState<string|null>(null),[busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[message,setMessage]=useState('');
 const epoch=useRef(0),live=useRef(false); live.current=active&&open&&!locked;
 const current=(value:number)=>live.current&&!document.hidden&&epoch.current===value;
 function clear(){epoch.current++;setHead(null);setBusy(false);setMessage('');}
 useEffect(()=>{try{const id=sessionStorage.getItem(storage);if(id&&/^[0-9a-f-]{36}$/i.test(id))setPending(id);}catch{/* UUID only. */}return()=>{epoch.current++;live.current=false;};},[storage]);
 useEffect(()=>{if(!active||!open)clear();},[active,open]);
 useEffect(()=>{const hide=()=>{if(document.hidden)clear();};document.addEventListener('visibilitychange',hide);return()=>document.removeEventListener('visibilitychange',hide);},[]);
 function forget(){sessionStorage.removeItem(storage);setPending(null);}
 async function run(action:'read'|'clear'|'query') {
  if(!live.current||document.hidden||busy)return;
  const generation=epoch.current;setBusy(true);setMessage('');
  try {
   if(action==='read'){const value=await api<Head>(root,{},session.csrf);if(current(generation))setHead(value);return;}
   if(action==='query'){if(!pending)return;const value=await api<Receipt>(root+'/operations/'+pending,{},session.csrf);if(current(generation)){if(['completed','rejected'].includes(value.state)){forget();setHead(null);setMessage(value.state==='completed'?'本进程登记解析缓存已清除，请重新读取':'缓存版本已变化，未执行本次清除');}else setMessage('结果未知，仅核对原请求');}return;}
   if(pending||!head)return;
   const id=requestId();sessionStorage.setItem(storage,id);setPending(id);
   const value=await api<Receipt>(root+'/cache/clear',{method:'POST',body:JSON.stringify({requestId:id,processId:head.cache.processId,revision:head.cache.revision})},session.csrf);
   if(current(generation)){if(['completed','rejected'].includes(value.state)){forget();setHead(null);setMessage(value.state==='completed'?'本进程登记解析缓存已清除':'缓存版本已变化，未执行本次清除');}else setMessage('结果未知，仅核对原请求');}
  } catch(reason) {
   if(current(generation)){if(reason instanceof ApiError&&[401,403].includes(reason.status)){setLocked(true);setHead(null);}setMessage(reason instanceof Error?reason.message:'系统状态不可用');}
  } finally {if(current(generation))setBusy(false);}
 }
 if(session.user.role!=='admin')return null;
 return <details onToggle={event=>setOpen(event.currentTarget.open)}><summary>恢复与进程缓存</summary>{open&&<>
  <button type="button" disabled={busy||locked||!active} onClick={()=>void run('read')}>读取状态</button>
  {pending&&<button type="button" disabled={busy||locked} onClick={()=>void run('query')}>核对原请求 {pending}</button>}
  {message&&<p role="status">{message}</p>}
  {head&&<>
   <dl className="portfolio-proof"><div><dt>本实例已登记备份</dt><dd>{head.recovery.backups.registered}</dd></div><div><dt>有验证记录</dt><dd>{head.recovery.backups.verified}</dd></div><div><dt>完整恢复验收</dt><dd>{head.recovery.completeRecoveryVerified===true?'已有完整证明':'未证实'}</dd></div><div><dt>恢复隔离</dt><dd>{head.recovery.quarantined?'存在隔离项目':'当前无隔离登记'}</dd></div></dl>
   {head.recovery.quarantine.map(row=><p key={row.category}>{row.category} · {row.quarantinedAt}</p>)}
   {head.recovery.recentTasks.length>0&&<table><thead><tr><th>恢复任务</th><th>状态</th></tr></thead><tbody>{head.recovery.recentTasks.map(row=><tr key={row.id}><td>{row.kind} · {row.id}</td><td>{row.status}{row.error_code?' · '+row.error_code:''}</td></tr>)}</tbody></table>}
   <p>登记解析缓存 {head.cache.entries} 项 · 版本 {head.cache.revision}</p><p>仅当前 API 进程、当前实例；不影响 Worker、Redis、原件或金融数据。</p>
   <button type="button" disabled={busy||locked||!!pending} onClick={()=>void run('clear')}>清除此进程的登记解析缓存</button>
  </>}
 </>}</details>;
}
