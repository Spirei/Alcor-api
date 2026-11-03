import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { requestId } from "./request-id";
import type { BrokerAccount } from "./broker-account-state";

const root = "/account/broker-icons";
type Receipt = { request_id: string; state: string; error?: { message: string } | null; data?: { accountId: string; revision: number; iconVersion: string | null } };
export function BrokerIconSettings(props: { session: Session; account: BrokerAccount; onChanged: () => void }) {
  const s=props.session;
  return <Content key={JSON.stringify([s.instance_id,s.user.id,s.user.role,s.receipt_scope,s.csrf,s.expires_at,props.account.id,props.account.revision])} {...props}/>;
}
function Content({session,account,onChanged}: {session: Session; account: BrokerAccount; onChanged:()=>void}) {
  const key="broker-icon:"+JSON.stringify([session.instance_id,session.user.id,session.user.role,session.receipt_scope]);
  const [pending,setPending]=useState<string|null>(()=>{try { const id=sessionStorage.getItem(key); return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)?id:null; } catch {return null;}});
  const [file,setFile]=useState<File|null>(null),[url,setUrl]=useState<string|null>(null),[error,setError]=useState(""),[message,setMessage]=useState("");
  const [busy,setBusy]=useState(false),[remove,setRemove]=useState(false),[refreshImage,setRefreshImage]=useState(0);
  const input=useRef<HTMLInputElement>(null),epoch=useRef(0),alive=useRef(true),blob=useRef<string|null>(null);
  function clearImage(){if(blob.current) URL.revokeObjectURL(blob.current); blob.current=null;setUrl(null);}
  function clearFile(){setFile(null);setRemove(false);if(input.current)input.current.value="";}
  function report(failure:unknown){if(failure instanceof ApiError && [401,403].includes(failure.status)){epoch.current++;clearFile();clearImage();setPending(null);try{sessionStorage.removeItem(key);}catch{/* Retire local view. */}}setError(failure instanceof Error?failure.message:"图标操作失败");}
  useEffect(()=>{
    alive.current=true; const controller=new AbortController();const generation=epoch.current;
    if(account.icon_version) void fetch('/api'+root+'/'+encodeURIComponent(account.id)+'/content',{credentials:'same-origin',headers:{'X-CSRF-Token':session.csrf},signal:controller.signal}).then(async response=>{if(!response.ok)throw new ApiError(response.status,"图标暂时无法读取");const data=await response.blob();if(alive.current && generation===epoch.current && !document.hidden){const next=URL.createObjectURL(data);blob.current=next;setUrl(next);}}).catch(failure=>{if(alive.current && generation===epoch.current && !controller.signal.aborted)report(failure);});
    const hide=()=>{epoch.current++;clearFile();clearImage();controller.abort();if(!document.hidden)setRefreshImage(value=>value+1);};document.addEventListener('visibilitychange',hide);
    return()=>{alive.current=false;epoch.current++;controller.abort();if(blob.current)URL.revokeObjectURL(blob.current);blob.current=null;document.removeEventListener('visibilitychange',hide);};
  },[account.id,account.icon_version,session.csrf,refreshImage]);
  function remember(id:string|null){try{if(id)sessionStorage.setItem(key,id);else sessionStorage.removeItem(key);setPending(id);return true;}catch{if(!id)setPending(null);else setError("无法保留原请求编号，未提交图标变更");return !id;}}
  function accept(value:Receipt,id:string){if(value.request_id!==id || !['completed','failed','closed'].includes(value.state))throw new Error("原请求回执仍待核对");remember(null);clearFile();if(value.state==='failed')setError(value.error?.message||"图标未修改");else setMessage(value.state==='closed'?"原请求已关闭":"图标已保存");if(value.state==='completed')onChanged();}
  async function submit(deleting=false){if(busy||pending||document.hidden||(!deleting&&!file))return;const id=requestId();if(!remember(id))return;const generation=epoch.current;setBusy(true);setError("");setMessage("");try{let body:FormData|string;if(deleting)body=JSON.stringify({requestId:id,revision:account.revision});else{const form=new FormData();form.set('requestId',id);form.set('revision',String(account.revision));form.set('file',file!);body=form;}const value=await api<Receipt>(root+'/'+encodeURIComponent(account.id),{method:deleting?'DELETE':'POST',body},session.csrf);if(alive.current&&generation===epoch.current)accept(value,id);}catch(failure){if(alive.current&&generation===epoch.current)report(failure);}finally{setBusy(false);}}
  async function resolve(close=false){if(!pending||busy||document.hidden)return;const id=pending,generation=epoch.current;setBusy(true);setError("");try{const value=await api<Receipt>(root+'/operations/'+id+(close?'/close':''),close?{method:'POST',body:'{}'}:{},close?session.csrf:undefined);if(alive.current&&generation===epoch.current)accept(value,id);}catch(failure){if(alive.current&&generation===epoch.current)report(failure);}finally{setBusy(false);}}
  return <div className="form-grid">
    {error&&<p role="alert" className="error">{error}</p>}{message&&<p role="status">{message}</p>}
    {url&&<img src={url} alt={`${account.name}图标`} width={64} height={64}/>}
    <label>图标<input ref={input} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||!!pending} onChange={event=>{const next=event.target.files?.[0];setError("");setRemove(false);if(!next){setFile(null);return;}if(next.size>2*1024*1024||!['image/png','image/jpeg','image/webp'].includes(next.type)){setError("请选择不超过2MiB的PNG、JPEG或WebP图标");clearFile();return;}setFile(next);}}/></label>
    <button disabled={busy||!!pending||!file} onClick={()=>void submit()}>保存图标</button>
    {account.icon_version&&<><label><input type="checkbox" checked={remove} disabled={busy||!!pending} onChange={event=>setRemove(event.target.checked)}/>删除此账户图标</label><button disabled={busy||!!pending||!remove} onClick={()=>void submit(true)}>确认删除图标</button></>}
    {pending&&<div><p role="status">结果待核对</p><code>{pending}</code><button disabled={busy} onClick={()=>void resolve()}>查询原请求</button><button disabled={busy} onClick={()=>void resolve(true)}>关闭未执行请求</button></div>}
  </div>;
}
