import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { PasswordField } from "./password-fields";
import { requestId } from "./request-id";
type Config={enabled:boolean;intervalHours:number;keep:number};
type Head={revision:number;config:Config;state:string;prerequisites:{storageReady:boolean|null;toolsReady:boolean|null;keyReady:boolean|null;authorizationValid:boolean|null;instanceMatches:boolean|null;restoreQuarantined:boolean|null};nextRunAt:string|null;lastTask:{id:string;status:string}|null;retention:{state:string}};
type Receipt={requestId:string;state:string;revision?:number};
const root='/backups/schedule';
const state=(value:boolean|null|undefined)=>value===true?'已核对':value===false?'未满足':'未知';
export function BackupScheduleControls({session,active}:{session:Session;active:boolean}){return <Panel key={JSON.stringify([session.instance_id,session.user.id,session.user.role,session.receipt_scope,session.csrf,session.expires_at])} session={session} active={active}/>;}
function Panel({session,active}:{session:Session;active:boolean}){
 const storage=JSON.stringify(['backup-schedule',session.instance_id,session.user.id,session.user.role,session.receipt_scope]);
 const [open,setOpen]=useState(false),[head,setHead]=useState<Head|null>(null),[draft,setDraft]=useState<Config|null>(null);
 const [password,setPassword]=useState(''),[code,setCode]=useState(''),[pending,setPending]=useState<string|null>(null),[busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[message,setMessage]=useState('');
 const epoch=useRef(0),live=useRef(false);live.current=active&&open&&!locked;
 function clear(){epoch.current++;setPassword('');setCode('');setHead(null);setDraft(null);setBusy(false);setMessage('');}
 useEffect(()=>{try{const id=sessionStorage.getItem(storage);if(id&&/^[0-9a-f-]{36}$/i.test(id))setPending(id);}catch{/* Only UUID retained. */}return()=>{epoch.current++;};},[storage]);
 useEffect(()=>{if(!active||!open)clear();},[active,open]);
 useEffect(()=>{const hidden=()=>{if(document.hidden)clear();};document.addEventListener('visibilitychange',hidden);return()=>document.removeEventListener('visibilitychange',hidden);},[]);
 const current=(generation:number)=>live.current&&!document.hidden&&epoch.current===generation;
 function fail(reason:unknown){if(reason instanceof ApiError&&[401,403].includes(reason.status)&&reason.code!=='backup_schedule_proof_rejected'){setLocked(true);setHead(null);setDraft(null);setPassword('');setCode('');}setMessage(reason instanceof Error?reason.message:'备份计划不可用');}
 async function run(action:'read'|'save'|'query'){
  if(!live.current||document.hidden||busy)return;
  const generation=epoch.current;setBusy(true);setMessage('');
  try{
   if(action==='read'){const value=await api<Head>(root,{},session.csrf);if(current(generation)){setHead(value);setDraft(value.config);}return;}
   if(action==='query'){if(!pending)return;const value=await api<Receipt>(root+'/operations/'+pending,{},session.csrf);if(current(generation)){if(value.state==='completed'){sessionStorage.removeItem(storage);setPending(null);setHead(null);setDraft(null);setMessage('计划配置已保存，请重新读取当前状态');}else setMessage('结果未知，请继续核对原请求');}return;}
   if(pending||!head||!draft)return;
   const id=requestId();sessionStorage.setItem(storage,id);setPending(id);
   const body=JSON.stringify({requestId:id,expectedRevision:head.revision,...draft,...(password?{password}:{}),...(code?{code}:{})});setPassword('');setCode('');
   const value=await api<Receipt>(root,{method:'POST',body},session.csrf);
   if(current(generation)){if(value.state==='completed'){sessionStorage.removeItem(storage);setPending(null);setHead(null);setDraft(null);setMessage('计划配置已保存；任务状态需重新读取');}else setMessage('结果未知，只核对原请求');}
  }catch(reason){if(current(generation)){if(action==='save'&&reason instanceof ApiError&&([400,422,428,429].includes(reason.status)||reason.code==='backup_schedule_proof_rejected'||reason.status===409&&['备份计划已变化，请重新读取','恢复实例的备份委托尚未重新授权','请先核对现有私有备份存储与密钥'].includes(reason.message))){sessionStorage.removeItem(storage);setPending(null);setPassword('');setCode('');}fail(reason);}}
  finally{if(current(generation))setBusy(false);}
 }
 const blocked=busy||!!pending||locked||!active;
 return <details onToggle={event=>setOpen(event.currentTarget.open)}><summary>平台加密备份计划</summary>{open&&<>
  <button type="button" disabled={busy||locked||!active} onClick={()=>void run('read')}>读取计划状态</button>
  {pending&&<button type="button" disabled={busy||locked} onClick={()=>void run('query')}>核对原请求 {pending}</button>}
  {message&&<p role="status">{message}</p>}
  {head&&draft&&<><p>{({disabled:'已停用',enabled:'已启用',blocked:'当前被阻断'} as Record<string,string>)[head.state]??head.state} · 版本 {head.revision}</p>
   <dl className="portfolio-proof"><div><dt>存储</dt><dd>{state(head.prerequisites.storageReady)}</dd></div><div><dt>备份工具</dt><dd>{state(head.prerequisites.toolsReady)}</dd></div><div><dt>密钥</dt><dd>{state(head.prerequisites.keyReady)}</dd></div><div><dt>授权</dt><dd>{state(head.prerequisites.authorizationValid)}</dd></div><div><dt>实例身份</dt><dd>{state(head.prerequisites.instanceMatches)}</dd></div><div><dt>恢复隔离</dt><dd>{head.prerequisites.restoreQuarantined===true?'仍在隔离':head.prerequisites.restoreQuarantined===false?'未隔离':'未知'}</dd></div><div><dt>保留策略</dt><dd>{head.retention.state==='registered_verified_capsules_only'?'仅本实例已登记并验证的备份':head.retention.state}</dd></div></dl>
   <p>下次计划时间 {head.nextRunAt??'未安排或未知'}</p>
   {head.lastTask&&<p>最近任务 {head.lastTask.id} · {head.lastTask.status}</p>}
   <div className="form-grid"><label><input type="checkbox" disabled={blocked} checked={draft.enabled} onChange={event=>setDraft({...draft,enabled:event.target.checked})}/>启用定时加密备份</label><label>间隔（小时）<input type="number" disabled={blocked} value={draft.intervalHours} onChange={event=>setDraft({...draft,intervalHours:Number(event.target.value)})}/></label><label>保留数量<input type="number" disabled={blocked} value={draft.keep} onChange={event=>setDraft({...draft,keep:Number(event.target.value)})}/></label><label>当前管理员密码<PasswordField id="backup-schedule-password" value={password} disabled={blocked} autoComplete="current-password" onChange={event=>setPassword(event.target.value)}/></label><label>验证码或备用码<input value={code} disabled={blocked} autoComplete="one-time-code" onChange={event=>setCode(event.target.value)}/></label></div>
   <button type="button" disabled={blocked||draft.enabled&&!password} onClick={()=>void run('save')}>保存备份计划</button>
  </>}
 </>}</details>;
}
