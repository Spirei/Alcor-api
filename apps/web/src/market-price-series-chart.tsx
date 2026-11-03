import { useMemo, useState } from "react";
import { observedWindow, priceSeriesPoints, type PriceSeriesFact, type HistoryIndicators } from "./market-history-model";

type Props={facts:PriceSeriesFact[];market:string;code:string;sourceRevision:string;session:string;coverage:string;indicators?:HistoryIndicators};
const W=900,H=360,L=65,R=18,T=20,B=260,VB=330;
export function MarketPriceSeriesChart(props:Props){return <Chart key={JSON.stringify([props.sourceRevision,props.session,props.market,props.code,props.facts.map(row=>[row.factId,row.revision])])} {...props}/>;}
function Chart({facts,market,code,sourceRevision,session,coverage,indicators}:Props){
 const prepared=useMemo(()=>priceSeriesPoints(facts),[facts]),[count,setCount]=useState(300),[end,setEnd]=useState(prepared.points.length),[index,setIndex]=useState<number|null>(null),[showAverage,setShowAverage]=useState(true),[showMA,setShowMA]=useState(false);
 const indicatorMap=useMemo(()=>new Map(indicators?.points.map(row=>[row.factId,row])||[]),[indicators]);
 const window=observedWindow(prepared.points,count,end),points=window.items;
 if(!points.length)return <p role="status">暂无可绘制的真实分时价格观察</p>;
 const numeric=(value:string|null|undefined)=>value===undefined||value===null||!Number.isFinite(Number(value))?null:Number(value);
 const extras=points.flatMap(row=>[...(showAverage&&row.avgPrice!==null?[row.avgPrice]:[]),...(showMA&&numeric(indicatorMap.get(row.fact.factId)?.ma['20'])!==null?[numeric(indicatorMap.get(row.fact.factId)?.ma['20'])!]:[])]);
 const minimum=Math.min(...points.map(row=>row.price),...extras),maximum=Math.max(...points.map(row=>row.price),...extras),padding=(maximum-minimum||Math.abs(maximum)*0.01||1)*0.08;
 const low=minimum-padding,high=maximum+padding,first=points[0].timestamp,last=points[points.length-1].timestamp,span=Math.max(1,last-first);
 const x=(timestamp:number)=>points.length===1?(L+W-R)/2:L+(timestamp-first)/span*(W-L-R),y=(price:number)=>T+(high-price)/(high-low)*(B-T);
 const volumeMax=Math.max(1,...points.flatMap(row=>row.volume===null?[]:[row.volume]));
 const selected=points[index===null?points.length-1:Math.max(0,Math.min(points.length-1,index))];
 function path(field:'price'|'avgPrice'|'ma20'){let connected=false;return points.map((row,i)=>{const value=field==='ma20'?numeric(indicatorMap.get(row.fact.factId)?.ma['20']):row[field];if(value===null){connected=false;return '';}const sameWindow=field!=='ma20'||i===0||indicatorMap.get(points[i-1].fact.factId)?.windowId===indicatorMap.get(row.fact.factId)?.windowId;const piece=`${connected&&!row.gapBefore&&sameWindow?'L':'M'}${x(row.timestamp)},${y(value)}`;connected=true;return piece;}).join(' ');}
 function select(clientX:number,element:SVGSVGElement){const rect=element.getBoundingClientRect(),position=(clientX-rect.left)/rect.width*W;let best=0;for(let i=1;i<points.length;i++)if(Math.abs(x(points[i].timestamp)-position)<Math.abs(x(points[best].timestamp)-position))best=i;setIndex(best);}
 return <section aria-label="真实分时价格与来源均价">
  <div className="portfolio-actions"><label>观察窗口<select value={count} onChange={event=>{setCount(Number(event.target.value));setIndex(null);}}>{[30,100,300,1000,3000,12000].map(value=><option key={value} value={value}>{value}条</option>)}</select></label><button disabled={!window.start} onClick={()=>{setEnd(Math.max(1,end-Math.floor(count/2)));setIndex(null);}}>更早</button><button disabled={end>=prepared.points.length} onClick={()=>{setEnd(Math.min(prepared.points.length,end+Math.floor(count/2)));setIndex(null);}}>更晚</button><button onClick={()=>{setEnd(prepared.points.length);setIndex(null);}}>最近观察</button><label><input type="checkbox" checked={showAverage} onChange={event=>setShowAverage(event.target.checked)}/>来源均价</label><label><input type="checkbox" checked={showMA} onChange={event=>setShowMA(event.target.checked)}/>观察MA20</label></div>
  <p>{market}:{code} · 真实分时价格 · {session}</p>
  <svg viewBox={`0 0 ${W} ${H}`} role="img" tabIndex={0} aria-label="真实分时价格线及来源均价；方向键选择观察点" style={{width:'100%',minHeight:220,maxHeight:450,touchAction:'pan-y'}} onPointerMove={event=>select(event.clientX,event.currentTarget)} onPointerDown={event=>select(event.clientX,event.currentTarget)} onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();setIndex(value=>Math.max(0,Math.min(points.length-1,(value??points.length-1)+(event.key==='ArrowLeft'?-1:1))));}}}>
    {[0,1,2,3,4].map(tick=>{const price=low+(high-low)*tick/4;return <g key={tick}><line x1={L} x2={W-R} y1={y(price)} y2={y(price)} stroke="currentColor" opacity={0.1}/><text x={L-5} y={y(price)+4} fontSize={11} textAnchor="end" fill="currentColor">{price.toPrecision(7)}</text></g>;})}
    <path d={path('price')} fill="none" stroke="currentColor" strokeWidth={1.4}/>{showAverage&&<path d={path('avgPrice')} fill="none" stroke="#ba9959" strokeWidth={1.25}/>} {showMA&&<path d={path('ma20')} fill="none" stroke="#936eac" strokeWidth={1.25}/>}
    {points.map(row=>row.volume===null?null:<rect key={row.fact.factId} x={x(row.timestamp)-1} y={VB-row.volume/volumeMax*45} width={2} height={row.volume/volumeMax*45} fill="currentColor" opacity={0.3}/>)}
    <line x1={x(selected.timestamp)} x2={x(selected.timestamp)} y1={T} y2={VB} stroke="currentColor" opacity={0.4} strokeDasharray="3 3"/><text x={L} y={H-6} fontSize={11} fill="currentColor">{points[0].fact.at}</text><text x={W-R} y={H-6} fontSize={11} textAnchor="end" fill="currentColor">{points[points.length-1].fact.at}</text>
  </svg>
  <dl className="portfolio-proof">{[['来源时间',selected.fact.at],['真实价格',selected.fact.price],['来源均价',selected.fact.avgPrice],['来源昨收',selected.fact.prevClose],['来源成交量',selected.fact.volume],['来源成交额',selected.fact.amount]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value??'未知'}</dd></div>)}</dl>
  {showMA&&<p role="status">观察MA20 {indicatorMap.get(selected.fact.factId)?.ma['20']??'观察窗口不足'}</p>}
  {prepared.excluded>0&&<p role="status">{prepared.excluded}条观察无法绘图，未按零补齐</p>}
  <details><summary>分时来源</summary><p>{sourceRevision} · {coverage}</p><p>均价和成交量仅显示来源原值；近5日指已有观察日，不代表5个完整交易日。</p></details>
 </section>;
}
export function PriceSeriesFactTable({facts}:{facts:PriceSeriesFact[]}){const [offset,setOffset]=useState(0),size=50;return <details><summary>原始分时观察（{facts.length}条）</summary><div className="portfolio-actions"><button disabled={!offset} onClick={()=>setOffset(value=>Math.max(0,value-size))}>上一页</button><span>{offset+1}—{Math.min(offset+size,facts.length)}</span><button disabled={offset+size>=facts.length} onClick={()=>setOffset(value=>value+size)}>下一页</button></div><table><thead><tr>{['来源时间','价格','来源均价','来源昨收','成交量','成交额'].map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{facts.slice(offset,offset+size).map(row=><tr key={row.factId}>{(['at','price','avgPrice','prevClose','volume','amount'] as const).map(field=><td key={field}>{row[field]??'未知'}</td>)}</tr>)}</tbody></table></details>;}
