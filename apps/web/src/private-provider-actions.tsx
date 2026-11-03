import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type Session } from './api';
import { PasswordField } from './password-fields';
import { requestId } from './request-id';
type Model={id:string;name:string;models:string[];selectedModel:string};
type Result={requestId?:string;state?:string;status?:string;ok?:boolean;latencyMs?:number;error?:string;cookie?:string;kind?:string;sourcePageId?:string;deliveryAuthority?:string};
const root='/admin/provider-operations';
export function PrivateProviderActions({session,active,revision,models,onDenied}:{session:Session;active:boolean;revision:number;models:Model[];onDenied:(reason:unknown)=>void}){
 const storage=JSON.stringify(['private-provider-action',session.instance_id,session.user.id,session.user.role,session.receipt_scope]);
 const [password,setPassword]=useState(''),[code,setCode]=useState(''),[service,setService]=useState(''),[model,setModel]=useState('');
 const [original,setOriginal]=useState('');
 const [tests,setTests]=useState<Record<string,{ok:boolean;latencyMs?:number;error?:string;requestId?:string;checkedAt?:string}>>({});
 const [file,setFile]=useState<File|null>(null),[pending,setPending]=useState<string|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[cookie,setCookie]=useState('');
 const input=useRef<HTMLInputElement>(null),epoch=useRef(0),live=useRef(active);live.current=active;
 const clear=()=>{setPassword('');setCode('');setFile(null);setCookie('');setTests({});setOriginal('');if(input.current)input.current.value='';};
 useEffect(()=>{try{const id=sessionStorage.getItem(storage);if(id&&/^[0-9a-f-]{36}$/i.test(id))setPending(id);}catch{/* Only operation UUID is retained. */}return()=>{epoch.current++;};},[storage]);
 useEffect(()=>{epoch.current++;clear();setBusy(false);setMessage('');},[active,revision]);
 useEffect(()=>{const hidden=()=>{if(document.hidden){epoch.current++;clear();setBusy(false);setMessage('');}};document.addEventListener('visibilitychange',hidden);return()=>document.removeEventListener('visibilitychange',hidden);},[]);
 const selected=models.find(value=>value.id===service);
 const current=(generation:number)=>live.current&&!document.hidden&&generation===epoch.current;
 function accept(value:Result,reveal=false){if(value.sourcePageId&&/^[0-9a-f-]{36}$/i.test(value.sourcePageId))setOriginal(value.sourcePageId);if(value.cookie&&reveal)setCookie(value.cookie);setMessage(value.state==='unknown'||value.status==='unknown'?'结果未知，只能核对原请求':value.ok===false?'测试未通过':value.deliveryAuthority==='smtp_accepted_not_inbox_delivery_confirmed'?'SMTP 已接受，收件箱送达尚未确认':value.kind==='model-icon'?'图标已更新，请重新读取私有配置':value.error||[value.state,value.status,value.latencyMs===undefined?'':value.latencyMs+' ms'].filter(Boolean).join(' · ')||'操作已返回');if(['completed','rejected','failed','unavailable'].includes(value.state??'')||['completed','succeeded','failed','unavailable'].includes(value.status??'')){sessionStorage.removeItem(storage);setPending(null);}}
 async function run(kind:'query'|'read-tests'|'mail-test'|'model-test'|'model-icon'|'xueqiu-cookie'){
  if(busy||!active||document.hidden||!['query','read-tests'].includes(kind)&&(!password||pending))return;
  const generation=epoch.current;setBusy(true);setMessage('');setCookie('');
  try{
   if(kind==='read-tests'){const result=await api<{tests:Record<string,{ok:boolean;latencyMs?:number;error?:string;requestId?:string;checkedAt?:string}>}>(root+'/model-test',{},session.csrf);if(current(generation))setTests(result.tests);return;}
   if(kind==='query'){if(!pending)return;const result=await api<Result>(root+'/operations/'+pending,{},session.csrf);if(current(generation))accept(result);return;}
   if((kind==='model-test'||kind==='model-icon')&&!selected)throw new Error('请选择已保存的模型服务');
   if(kind==='model-test'&&(!model||!selected?.models.includes(model)))throw new Error('请选择已登记模型');
   if(kind==='model-icon'&&(!file||file.size>2*1024*1024))throw new Error('请选择不超过 2 MiB 的图标文件');
   const id=requestId();sessionStorage.setItem(storage,id);setPending(id);
   let body:string|FormData;
   if(kind==='model-icon'){const form=new FormData();form.set('requestId',id);form.set('expectedRevision',String(revision));form.set('serviceId',service);form.set('file',file!);form.set('password',password);if(code)form.set('code',code);body=form;}
   else body=JSON.stringify({requestId:id,expectedRevision:revision,password,...(code?{code}:{}),...(kind==='model-test'?{serviceId:service,model}:{})});
   clear();const result=await api<Result>(root+'/'+kind,{method:'POST',body},session.csrf,60000);if(current(generation))accept(result,kind==='xueqiu-cookie');
  }catch(reason){if(current(generation)){if(reason instanceof ApiError&&([400,422,428,429].includes(reason.status)||reason.code==='provider_proof_rejected')){sessionStorage.removeItem(storage);setPending(null);clear();}if(reason instanceof ApiError&&[401,403].includes(reason.status)&&reason.code!=='provider_proof_rejected'){clear();onDenied(reason);}setMessage(reason instanceof Error?reason.message:'操作失败；如已发送，请核对原请求');}}
  finally{if(current(generation))setBusy(false);}
 }
 const disabled=busy||!!pending||!active;
 return <details onToggle={event=>{if(!event.currentTarget.open){epoch.current++;clear();setBusy(false);setMessage('');}}}><summary>显式连接测试与秘密查看</summary>
 <p>邮件测试仅发送至当前管理员已验证邮箱；模型测试会调用已批准的服务。</p>
 <button type="button" disabled={busy||!active} onClick={()=>void run('read-tests')}>读取当前配置的测试记录</button>
 {Object.entries(tests).map(([key,value])=><p key={key}>{key} · {value.ok?'已通过':'未通过'} · {value.latencyMs===undefined?'':value.latencyMs+' ms'} · {value.checkedAt??''} · {value.error??''}</p>)}
 {pending&&<button type="button" disabled={busy||!active} onClick={()=>void run('query')}>核对原请求 {pending}</button>}
 <div className="form-grid"><label>已保存模型服务<select disabled={disabled} value={service} onChange={event=>{setService(event.target.value);setModel('');setCookie('');}}><option value="">选择服务</option>{models.map(value=><option key={value.id} value={value.id}>{value.name||value.id}</option>)}</select></label>
 <label>模型<select disabled={disabled} value={model} onChange={event=>setModel(event.target.value)}><option value="">选择已登记模型</option>{(selected?.models??[]).map(value=><option key={value} value={value}>{value}</option>)}</select></label>
 <label>当前密码<PasswordField id="private-provider-password" value={password} disabled={disabled} autoComplete="current-password" onChange={event=>setPassword(event.target.value)}/></label><label>验证码或备用码<input disabled={disabled} autoComplete="one-time-code" value={code} onChange={event=>setCode(event.target.value)}/></label>
 </div><button type="button" disabled={disabled||!password} onClick={()=>void run('mail-test')}>发送测试邮件</button><button type="button" disabled={disabled||!password||!selected||!model} onClick={()=>void run('model-test')}>测试已保存模型</button>
 <label>模型图标<input ref={input} disabled={disabled} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" onChange={event=>setFile(event.target.files?.[0]??null)}/></label><button type="button" disabled={disabled||!password||!file||!selected} onClick={()=>void run('model-icon')}>更新该服务图标</button>
 <button type="button" disabled={disabled||!password} onClick={()=>void run('xueqiu-cookie')}>获取雪球 Cookie</button>
 {cookie&&<label>本次返回的秘密<PasswordField id="private-xueqiu-cookie" value={cookie} readOnly autoComplete="off" onChange={()=>{}}/></label>}
 {original&&<a href={'/api/admin/provider-operations/originals/'+original} download rel="noreferrer">下载本次提供商响应原件</a>}
 {message&&<p role="status">{message}</p>}
 </details>;
}
