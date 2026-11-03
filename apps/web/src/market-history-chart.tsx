import { useMemo, useState } from "react";
import { chartBars, observedWindow, type HistoryFact, type HistoryIndicators, type IndicatorPoint } from "./market-history-model";

type Props = { facts: HistoryFact[]; frame: string; instrument: string; market: string; code: string; adjust: string; session: string; sourceRevision: string; coverage: string; indicators?: HistoryIndicators };
const W=900,H=370,LEFT=65,RIGHT=18,TOP=20,PRICE_BOTTOM=265,VOLUME_TOP=295,BOTTOM=345;
const priceText=(value:number)=>Number.isFinite(value)?value.toLocaleString(undefined,{maximumSignificantDigits:8}):"未知";
export function MarketHistoryChart(props:Props) {
  return <Chart key={JSON.stringify([props.sourceRevision,props.frame,props.instrument,props.market,props.code,props.adjust,props.session,props.facts.map(row=>[row.factId,row.revision])])} {...props}/>;
}
function Chart({facts,frame,instrument,market,code,adjust,session,sourceRevision,coverage,indicators}:Props) {
  const prepared=useMemo(()=>chartBars(facts),[facts]);
  const [count,setCount]=useState(100),[end,setEnd]=useState(prepared.bars.length),[selected,setSelected]=useState<number|null>(null),[mode,setMode]=useState<'candles'|'close'>('candles');
  const [overlay,setOverlay]=useState('none'),[lowerIndicator,setLowerIndicator]=useState('none');
  const indicatorMap=useMemo(()=>new Map(indicators?.points.map(point=>[point.factId,point])||[]),[indicators]);
  const numeric=(value:string|null|undefined)=>value===null||value===undefined||!Number.isFinite(Number(value))?null:Number(value);
  const overlayValues=(point:IndicatorPoint|undefined):(string|null)[]=>!point?[]:overlay==='BOLL20'?[point.boll20.mid,point.boll20.upper,point.boll20.lower]:overlay==='EMA20'?[point.ema20]:overlay.startsWith('MA')?[point.ma[overlay.slice(2)]??null]:[];
  const window=observedWindow(prepared.bars,count,end),bars=window.items;
  if(!bars.length)return <p role="status">暂无可绘制的真实OHLC记录{prepared.excluded?`，${prepared.excluded}条无法核对`:''}</p>;
  const first=bars[0].timestamp,last=bars[bars.length-1].timestamp,timeSpan=Math.max(1,last-first);
  const overlayNumbers=bars.flatMap(row=>overlayValues(indicatorMap.get(row.fact.factId)).flatMap(value=>{const number=numeric(value);return number===null?[]:[number];}));
  const min=Math.min(...bars.map(row=>row.low),...overlayNumbers),max=Math.max(...bars.map(row=>row.high),...overlayNumbers),pad=(max-min||Math.abs(max)*0.01||1)*0.06,low=min-pad,high=max+pad;
  const x=(time:number)=>bars.length===1?(LEFT+W-RIGHT)/2:LEFT+(time-first)/timeSpan*(W-LEFT-RIGHT);
  const y=(price:number)=>TOP+(high-price)/(high-low)*(PRICE_BOTTOM-TOP);
  const knownVolumes=bars.flatMap(row=>row.volume===null?[]:[row.volume]),maxVolume=Math.max(...knownVolumes,1);
  const gaps=bars.slice(1).map((row,index)=>x(row.timestamp)-x(bars[index].timestamp));
  const candleWidth=Math.max(1,Math.min(12,(gaps.length?Math.min(...gaps):12)*0.65));
  const active=selected===null?bars[bars.length-1]:bars[Math.max(0,Math.min(bars.length-1,selected))];
  function selectAt(clientX:number,element:SVGSVGElement){const rect=element.getBoundingClientRect(),position=(clientX-rect.left)/rect.width*W;let best=0;for(let i=1;i<bars.length;i++)if(Math.abs(x(bars[i].timestamp)-position)<Math.abs(x(bars[best].timestamp)-position))best=i;setSelected(best);}
  const selectedIndicator=indicatorMap.get(active.fact.factId);
  function seriesPath(values:(number|null)[],scale:(value:number)=>number) { let connected=false;return values.map((value,index)=>{if(value===null){connected=false;return '';}const item=`${connected&&!bars[index].gapBefore&&(index===0||indicatorMap.get(bars[index-1].fact.factId)?.windowId===indicatorMap.get(bars[index].fact.factId)?.windowId)?'L':'M'}${x(bars[index].timestamp)},${scale(value)}`;connected=true;return item;}).join(' '); }
  const lowerValues=(point:IndicatorPoint|undefined):(string|null)[]=>!point?[]:lowerIndicator==='RSI14'?[point.rsi14]:lowerIndicator==='MACD'?[point.macd.dif,point.macd.dea,point.macd.hist]:[];
  const subNumbers=bars.flatMap(row=>lowerValues(indicatorMap.get(row.fact.factId)).flatMap(value=>{const number=numeric(value);return number===null?[]:[number];}));
  const subLow=lowerIndicator==='RSI14'?0:Math.min(0,...subNumbers),subHigh=lowerIndicator==='RSI14'?100:Math.max(0,...subNumbers),subSpan=subHigh-subLow||1;
  const subY=(value:number)=>10+(subHigh-value)/subSpan*90;
  const line=bars.map((bar,index)=>`${index&&!bar.gapBefore?'L':'M'}${x(bar.timestamp)},${y(bar.close)}`).join(' ');
  return <section aria-label={`${market} ${code}真实来源K线`}>
    <div className="portfolio-actions"><label>图形<select value={mode} onChange={event=>setMode(event.target.value as 'candles'|'close')}><option value="candles">OHLC蜡烛</option><option value="close">收盘线</option></select></label><label>观察记录<select value={count} onChange={event=>{setCount(Number(event.target.value));setSelected(null);}}>{[30,60,100,200,500,1000].map(value=><option key={value} value={value}>{value}条</option>)}</select></label><button disabled={window.start===0} onClick={()=>{setEnd(Math.max(1,end-Math.max(1,Math.floor(count/2))));setSelected(null);}}>更早</button><button disabled={end>=prepared.bars.length} onClick={()=>{setEnd(Math.min(prepared.bars.length,end+Math.max(1,Math.floor(count/2))));setSelected(null);}}>更晚</button><button onClick={()=>{setEnd(prepared.bars.length);setSelected(null);}}>最近记录</button></div>
    <div className="portfolio-actions"><label>主图指标<select value={overlay} onChange={event=>setOverlay(event.target.value)}>{['none','MA5','MA10','MA20','MA30','MA60','MA120','MA250','MA500','EMA20','BOLL20'].map(value=><option key={value} value={value}>{value==='none'?'无':value}</option>)}</select></label><label>副图指标<select value={lowerIndicator} onChange={event=>setLowerIndicator(event.target.value)}><option value="none">无</option><option value="MACD">MACD(12,26,9)</option><option value="RSI14">RSI14</option></select></label></div>
    <p>{market}:{code} · {{equity:"股票",index:"真实指数",asset:"加密资产"}[instrument as "equity"|"index"|"asset"] ?? instrument} · {frame} · {adjust} · {session}</p>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="来源时间横轴，真实OHLC及已知成交量；左右方向键选择观察点" tabIndex={0} style={{width:'100%',minHeight:220,maxHeight:470,touchAction:'pan-y'}} onPointerMove={event=>selectAt(event.clientX,event.currentTarget)} onPointerDown={event=>selectAt(event.clientX,event.currentTarget)} onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();setSelected(value=>Math.max(0,Math.min(bars.length-1,(value??bars.length-1)+(event.key==='ArrowLeft'?-1:1))));}}}>
      {[0,1,2,3,4].map(tick=>{const value=low+(high-low)*tick/4,at=y(value);return <g key={tick}><line x1={LEFT} x2={W-RIGHT} y1={at} y2={at} stroke="currentColor" opacity={0.1}/><text x={LEFT-6} y={at+4} textAnchor="end" fontSize={11} fill="currentColor">{priceText(value)}</text></g>;})}
      {mode==='close'?<path d={line} fill="none" stroke="currentColor" strokeWidth={1.5}/>:bars.map(bar=>{const color=bar.close>=bar.open?'#38866a':'#a65c5c',bodyTop=y(Math.max(bar.open,bar.close)),bodyHeight=Math.max(1,Math.abs(y(bar.open)-y(bar.close)));return <g key={bar.fact.factId}><line x1={x(bar.timestamp)} x2={x(bar.timestamp)} y1={y(bar.high)} y2={y(bar.low)} stroke={color}/><rect x={x(bar.timestamp)-candleWidth/2} y={bodyTop} width={candleWidth} height={bodyHeight} fill={color}/></g>;})}
      {(overlay==='BOLL20'?[0,1,2]:overlay==='none'?[]:[0]).map((lineIndex)=><path key={'indicator-'+lineIndex} d={seriesPath(bars.map(row=>numeric(overlayValues(indicatorMap.get(row.fact.factId))[lineIndex])),y)} fill="none" stroke={['#936eac','#ba9959','#668fa5'][lineIndex]} strokeWidth={1.25}/>)}
      {bars.map(bar=>bar.volume===null?null:<rect key={'v-'+bar.fact.factId} x={x(bar.timestamp)-candleWidth/2} y={BOTTOM-(bar.volume/maxVolume)*(BOTTOM-VOLUME_TOP)} width={candleWidth} height={(bar.volume/maxVolume)*(BOTTOM-VOLUME_TOP)} fill="currentColor" opacity={0.3}/>)}
      <line x1={x(active.timestamp)} x2={x(active.timestamp)} y1={TOP} y2={BOTTOM} stroke="currentColor" opacity={0.4} strokeDasharray="3 3"/>
      <text x={LEFT} y={H-6} fontSize={11} fill="currentColor">{bars[0].fact.at}</text><text x={W-RIGHT} y={H-6} textAnchor="end" fontSize={11} fill="currentColor">{bars[bars.length-1].fact.at}</text>
    </svg>
    {lowerIndicator!=='none'&&<svg viewBox={`0 0 ${W} 120`} role="img" aria-label={lowerIndicator} style={{width:'100%',maxHeight:150}}><text x={LEFT} y={115} fontSize={11} fill="currentColor">{priceText(subLow)}</text><text x={LEFT} y={10} fontSize={11} fill="currentColor">{priceText(subHigh)}</text>{(lowerIndicator==='MACD'?[0,1,2]:[0]).map(lineIndex=><path key={lineIndex} d={seriesPath(bars.map(row=>numeric(lowerValues(indicatorMap.get(row.fact.factId))[lineIndex])),subY)} fill="none" stroke={['#936eac','#ba9959','#668fa5'][lineIndex]} strokeWidth={1.25}/>)}</svg>}
    {(overlay!=='none'||lowerIndicator!=='none')&&<p role="status">{[...overlayValues(selectedIndicator),...lowerValues(selectedIndicator)].some(value=>value!==null)?[overlay!=='none'?`${overlay}: ${overlayValues(selectedIndicator).map(value=>value??'不足').join(' / ')}`:'',lowerIndicator!=='none'?`${lowerIndicator}: ${lowerValues(selectedIndicator).map(value=>value??'不足').join(' / ')}`:''].filter(Boolean).join(' · '):'指标观察窗口不足或该点尚无已计算指标'}</p>}
    <dl className="portfolio-proof">{[['来源时间',active.fact.at],['开',active.fact.o],['高',active.fact.h],['低',active.fact.l],['收',active.fact.c],['成交量',active.fact.v]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value??'未知'}</dd></div>)}</dl>
    {(active.fact.adjustmentMethod === "provider_adjusted_close_ratio" || active.fact.corporateAdjustment === "provider_reported") && <dl className="portfolio-proof"><div><dt>价格口径</dt><dd>{active.fact.adjustmentMethod === "provider_adjusted_close_ratio" ? "来源调整收盘比率" : "来源原报OHLC"}</dd></div>{active.fact.sourceClose && <div><dt>来源原收盘</dt><dd>{active.fact.sourceClose}</dd></div>}{active.fact.sourceAdjustedClose && <div><dt>来源调整收盘</dt><dd>{active.fact.sourceAdjustedClose}</dd></div>}{active.fact.adjustmentFactor && <div><dt>来源比率</dt><dd>{active.fact.adjustmentFactor}</dd></div>}{active.fact.volumeBasis === "provider_reported" && <div><dt>成交量口径</dt><dd>来源原报</dd></div>}</dl>}
    {knownVolumes.length!==bars.length&&<p role="status">部分成交量未知，未按零补齐</p>}{prepared.excluded>0&&<p role="status">{prepared.excluded}条来源记录无法绘图，原值保留在记录表</p>}
    <details><summary>图表来源</summary><p>来源版本 {sourceRevision}</p><p>覆盖状态 {coverage}</p><p>指标按每个返回页的观察窗口计算，分页边界不连接，未证明交易日历完整；MA/EMA/BOLL按旧图表公式，MACD与RSI为明确的新指标定义。</p><p>仅显示已观察记录；时间空白不代表零成交或已核实休市。</p></details>
  </section>;
}

export function MarketHistoryFactTable({facts}:{facts:HistoryFact[]}) {
  const [offset,setOffset]=useState(0),size=50;
  const page=facts.slice(offset,offset+size);
  return <details><summary>原始观察记录（{facts.length}条）</summary><div className="portfolio-actions"><button disabled={!offset} onClick={()=>setOffset(value=>Math.max(0,value-size))}>上一页</button><span>{offset+1}—{Math.min(offset+size,facts.length)}</span><button disabled={offset+size>=facts.length} onClick={()=>setOffset(value=>value+size)}>下一页</button></div><table><thead><tr><th>来源时间</th><th>开</th><th>高</th><th>低</th><th>收</th><th>成交量</th></tr></thead><tbody>{page.map(fact=><tr key={fact.factId}><td>{fact.at}</td>{(['o','h','l','c','v'] as const).map(field=><td key={field}>{fact[field]??'未知'}</td>)}</tr>)}</tbody></table></details>;
}
