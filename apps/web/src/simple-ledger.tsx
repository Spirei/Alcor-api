import { requestResponse } from "./api-response.ts";
import { useEffect, useRef, useState } from "react";
import { ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { requestId } from "./request-id";
const root='/api/account/simple-ledger';
// Locate a root field without reserializing arbitrary financial JSON numbers.
function rawField(raw:string,wanted:string):string {
 JSON.parse(raw);let i=0;const space=()=>{while(/\s/.test(raw[i]??'')&&i<raw.length)i++;};
 const stringEnd=()=>{i++;while(i<raw.length){if(raw[i]==='\\'){i+=2;continue;}if(raw[i++]==='"')return;}throw new Error('JSON 字符串不完整');};
 space();if(raw[i++]!=='{')throw new Error('返回须为对象');
 while(i<raw.length){space();if(raw[i]==='}')break;const keyStart=i;stringEnd();const key=JSON.parse(raw.slice(keyStart,i));space();if(raw[i++]!==':')throw new Error('JSON 字段无效');space();const start=i;
  if(raw[i]==='"')stringEnd();else if(raw[i]==='{'||raw[i]==='['){let depth=0;do{if(raw[i]==='"'){stringEnd();continue;}if(raw[i]==='{'||raw[i]==='[')depth++;if(raw[i]==='}'||raw[i]===']')depth--;i++;}while(depth&&i<raw.length);}else while(i<raw.length&&raw[i]!==','&&raw[i]!=='}')i++;
  if(key===wanted)return raw.slice(start,i).trim();space();if(raw[i]===','){i++;continue;}break;
 }throw new Error('返回缺少 '+wanted);
}
export function SimpleLedger({session,active}:{session:Session;active:boolean}){return <Editor key={JSON.stringify([session.instance_id,session.user.id,session.user.role,session.receipt_scope,session.csrf,session.expires_at])} session={session} active={active}/>;}
function Editor({session,active}:{session:Session;active:boolean}){
 const storage=JSON.stringify(['simple-ledger',session.instance_id,session.user.id,session.user.role,session.receipt_scope]);
 const [revision,setRevision]=useState<number|null>(null),[draft,setDraft]=useState(''),[candidate,setCandidate]=useState(''),[source,setSource]=useState('');
 const [file,setFile]=useState<File|null>(null),[pending,setPending]=useState<string|null>(null),[busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[message,setMessage]=useState(''),[ack,setAck]=useState(false);
 const input=useRef<HTMLInputElement>(null),epoch=useRef(0),controller=useRef<AbortController|null>(null),live=useRef(active);live.current=active&&!locked;
 function clear(){epoch.current++;controller.current?.abort();controller.current=null;setDraft('');setRevision(null);setCandidate('');setSource('');setFile(null);setMessage('');setBusy(false);setAck(false);if(input.current)input.current.value='';}
 useEffect(()=>{try{const id=sessionStorage.getItem(storage);if(id&&/^[0-9a-f-]{36}$/i.test(id))setPending(id);}catch{/* Only UUID retained. */}return()=>{epoch.current++;controller.current?.abort();};},[storage]);
 useEffect(()=>{if(!active)clear();else if(!document.hidden&&!locked)void run('read');},[active,locked]);
 useEffect(()=>{const hidden=()=>{if(document.hidden)clear();else if(live.current)void run('read');};document.addEventListener('visibilitychange',hidden);return()=>document.removeEventListener('visibilitychange',hidden);},[]);
 function remember(id:string|null){if(id)sessionStorage.setItem(storage,id);else sessionStorage.removeItem(storage);setPending(id);}
 const current=(run:number)=>live.current&&!document.hidden&&epoch.current===run;
 async function response(path:string,init:RequestInit,signal:AbortSignal){
  if(apiSessionSnapshot().csrf!==session.csrf)throw new ApiError(409,'当前登录身份已变化','','session_changed');
  const headers=new Headers(init.headers);headers.set('X-CSRF-Token',session.csrf);headers.set('X-Simple-Ledger-User',session.user.id);if(typeof init.body==='string')headers.set('Content-Type','application/json');
  const result=await requestResponse(root+path,{...init,headers,credentials:'same-origin',cache:'no-store',signal});
  if(apiSessionSnapshot().csrf!==session.csrf||result.headers.get('X-Alcor-Session-Changed')==='true')throw new ApiError(409,'当前登录身份已变化','','session_changed');
  if(!result.ok){const value=await result.clone().json().catch(()=>null);if(value?.state==='rejected'&&typeof value?.requestId==='string')return result;throw new ApiError(result.status,typeof value?.detail==='string'?value.detail:typeof value?.error==='string'?value.error:value?.error?.message||value?.message||'独立账本操作失败');}
  return result;
 }
 function accept(raw:string,expected:string){const value=JSON.parse(raw);if(value.requestId!==expected)throw new Error('返回的操作编号不匹配，请只核对原编号');if(value.state==='parsed'){setCandidate(rawField(raw,'invest'));setSource(value.requestId);remember(null);setMessage('XLSX 已解析为独立候选，未写入账本');}else if(value.state==='completed'){setRevision(value.revision);setDraft(rawField(raw,'ledger'));setAck(false);remember(null);setMessage('独立账本已保存');}else if(value.state==='rejected'){setCandidate('');setSource(value.requestId);remember(null);setMessage((value.error||'文件未能解析')+'；上传原件已保留，未应用账本');}else if(value.state==='closed'){remember(null);setAck(false);setMessage('原编号已关闭，未执行保存或解析');}else setMessage('结果未知，仅核对原 UUID');}
 function fail(reason:unknown){if(reason instanceof ApiError&&([401,403].includes(reason.status)||reason.code==='session_changed')){clear();setLocked(true);}setMessage(reason instanceof Error?reason.message:'操作失败');}
 function download(blob:Blob,name:string){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function run(action:'read'|'save'|'query'|'close'|'parse'|'xlsx'){
  if(!live.current||busy||document.hidden)return;const run=epoch.current,request=new AbortController();controller.current=request;setBusy(true);setMessage('');
  try{
   if(action==='xlsx'){const result=await response('/tool/export',{method:'POST',body:'{}'},request.signal),blob=await result.blob();if(current(run))download(blob,'independent-investments.xlsx');return;}
   if(action==='read'){const result=await response('',{},request.signal),raw=await result.text();if(current(run)){const value=JSON.parse(raw);setRevision(value.revision);setDraft(rawField(raw,'ledger'));setAck(false);}return;}
   if(action==='query'||action==='close'){if(!pending)return;const result=await response('/operations/'+pending+(action==='close'?'/close':''),action==='close'?{method:'POST',body:'{}'}:{},request.signal),raw=await result.text();if(current(run))accept(raw,pending);return;}
   if(pending)return;
   if(action==='save'){
    if(revision===null||!draft||!ack)throw new Error('请读取账本并明确确认保存');if(new TextEncoder().encode(draft).length>2*1024*1024)throw new Error('账本 JSON 超过 2 MiB');const parsed=JSON.parse(draft);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('账本须为 JSON 对象');
    const id=requestId();remember(id);const body='{"requestId":'+JSON.stringify(id)+',"expectedRevision":'+revision+',"ledger":'+draft+'}';const result=await response('',{method:'PUT',body},request.signal),raw=await result.text();if(current(run))accept(raw,id);
   }else{
    if(!file||!file.name.toLowerCase().endsWith('.xlsx')||file.size>10*1024*1024)throw new Error('请选择不超过 10 MiB 的 XLSX 文件');const id=requestId(),form=new FormData();form.set('requestId',id);form.set('file',file);remember(id);setFile(null);if(input.current)input.current.value='';const result=await response('/tool/import',{method:'POST',body:form},request.signal),raw=await result.text();if(current(run))accept(raw,id);
   }
  }catch(reason){if(current(run)){if(reason instanceof ApiError&&([400,413,422,429].includes(reason.status)||reason.status===409&&reason.message==='账本已变化，请重新读取'))remember(null);fail(reason);}}
  finally{if(current(run)){setBusy(false);controller.current=null;}}
 }
 const disabled=busy||locked||!!pending||!active;
 return <section className="panel"><h2>独立轻量账本</h2><p>与券商账户及实际交易账本分离；汇率与历史均为此账本的本人登记值。</p>
  <div className="module-actions"><button disabled={busy||locked||!active} onClick={()=>void run('read')}>读取已保存账本</button>{pending&&<><button disabled={busy||locked||!active} onClick={()=>void run('query')}>核对原请求 {pending}</button><button disabled={busy||locked||!active} onClick={()=>void run('close')}>关闭原编号（不重发）</button></>}</div>{message&&<p role="status">{message}</p>}
  {revision!==null&&<><p>账本版本 {revision}</p><label>完整独立账本 JSON<textarea disabled={disabled} value={draft} rows={20} spellCheck={false} onChange={event=>{setDraft(event.target.value);setAck(false);setMessage('');}}/></label><label><input type="checkbox" disabled={disabled} checked={ack} onChange={event=>setAck(event.target.checked)}/>明确保存此独立账本，不写入券商账本</label><div className="module-actions"><button disabled={disabled||!ack} onClick={()=>void run('save')}>按当前版本保存</button><button disabled={disabled} onClick={()=>download(new Blob([draft],{type:'application/json'}),'independent-ledger.json')}>下载当前 JSON</button><button disabled={disabled} onClick={()=>void run('xlsx')}>导出已保存独立投资 XLSX</button></div></>}
  <details><summary>XLSX 候选解析</summary><label>选择 XLSX<input ref={input} disabled={disabled} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event=>{setFile(event.target.files?.[0]??null);setCandidate('');setSource('');}}/></label><button disabled={disabled||!file} onClick={()=>void run('parse')}>仅解析候选</button>{candidate&&<><label>解析候选（未应用）<textarea rows={12} readOnly value={candidate}/></label><button disabled={busy||!active} onClick={()=>download(new Blob([candidate],{type:'application/json'}),'independent-investment-candidates.json')}>下载候选 JSON</button></>}{source&&<a href={root+'/originals/'+source} download rel="noreferrer">下载上传的 XLSX 原件</a>}</details>
 </section>;
}
