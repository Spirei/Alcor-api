import { PrivateAmount } from "./financial-display";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";

type Currency={currency:string;ownerBalance:string|null;registeredOwnerBalance:string|null;unallocatedBalance:string|null;registeredUnallocatedBalance:string|null;reservedBuyCash:string|null;availableOwnerBalance:string|null;ledgerAsOf:string|null;complete:boolean;reservationsComplete:boolean};
type Snapshot={revision:number;snapshotRevision:string;books:{accountKind:string;currencies:Currency[]}[]};
export function CashOverviewPanel({session,generation,onDenied}:{session:Session;generation:string;onDenied:(failure:unknown)=>void}) {
  const scope=JSON.stringify([session.instance_id,session.user.id,session.user.role,session.receipt_scope,session.csrf,session.expires_at]);
  return <Content key={scope} generation={generation} onDenied={onDenied}/>;
}
function Content({generation,onDenied}:{generation:string;onDenied:(failure:unknown)=>void}) {
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState(""),[kind,setKind]=useState("real"),[refresh,setRefresh]=useState(0);
  const epoch=useRef(0),denied=useRef(onDenied);denied.current=onDenied;
  useEffect(()=>{
    if(document.hidden)return;const run=++epoch.current,controller=new AbortController();setSnapshot(null);setError("");
    void api<Snapshot>('/account/cash-overview',{signal:controller.signal}).then(value=>{if(!controller.signal.aborted&&run===epoch.current&&!document.hidden)setSnapshot(value);}).catch(failure=>{if(controller.signal.aborted||run!==epoch.current)return;setError(failure instanceof Error?failure.message:"资金总览读取失败");if(failure instanceof ApiError&&[401,403].includes(failure.status)){setSnapshot(null);denied.current(failure);}});
    const visibility=()=>{epoch.current++;controller.abort();setSnapshot(null);if(!document.hidden)setRefresh(value=>value+1);};document.addEventListener('visibilitychange',visibility);return()=>{epoch.current++;controller.abort();document.removeEventListener('visibilitychange',visibility);};
  },[generation,refresh]);
  const rows=snapshot?.books.find(book=>book.accountKind===kind)?.currencies;
  return <div className="cash-overview">
    <div className="portfolio-actions"><label>资金账本<select value={kind} onChange={event=>setKind(event.target.value)}><option value="real">真实账本</option><option value="simulated">模拟账本</option></select></label><button onClick={()=>setRefresh(value=>value+1)}>重新读取</button></div>
    {error&&<p role="alert" className="error">{error}</p>}
    {!snapshot&&!error&&<p role="status">正在读取资金…</p>}
    {rows&&rows.length===0&&<p>暂无本账本原币资金记录</p>}
    {!!rows?.length&&<div className="portfolio-table"><table><thead><tr><th>原币</th><th>总登记资金</th><th>已核实账本余额</th><th>未分配</th><th>买单预留</th><th>可用内部账本额</th><th>最近流水时间</th></tr></thead><tbody>{rows?.map(row=><tr key={row.currency}><td>{row.currency}</td><td><PrivateAmount>{row.registeredOwnerBalance??'未知'}</PrivateAmount></td><td><PrivateAmount>{row.ownerBalance??'未知'}</PrivateAmount></td><td><PrivateAmount>{row.unallocatedBalance??'未知'}</PrivateAmount>{row.unallocatedBalance===null&&row.registeredUnallocatedBalance!==null&&<small>登记值 <PrivateAmount>{row.registeredUnallocatedBalance}</PrivateAmount></small>}</td><td><PrivateAmount>{row.reservedBuyCash??'未知'}</PrivateAmount></td><td><PrivateAmount>{row.availableOwnerBalance??'未知'}</PrivateAmount></td><td>{row.ledgerAsOf??'未知'}</td></tr>)}</tbody></table></div>}
  </div>;
}
