import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { api, ApiError } from "./api";
import { dayLabel } from "./reference-state";
import { SelectMenu } from "./select-menu";
import { PageHeader } from "./workspace-ui";
import { MaterialFlag, useMaterialFlags } from "./material-flag";
import { calendarCells, calendarFill, calendarMarkets, calendarMarketNames, calendarSourceUrl, calendarTone, matchesCalendarFilter, readCalendarBatch, type CalendarFilter } from "./market-calendar-state";
import type { Calendar } from "./reference";
import "./market-calendar.css";

type Batch={calendarVersion:string;year:number;calendars:Record<string,Calendar>};
function describe(day:Calendar["days"][number]) {
  return dayLabel(day.status)+(day.name?` · ${day.name}`:"")+(day.close?` · 连续交易至 ${day.close.continuous}${day.close.auction?`，收市竞价 ${day.close.auction.earliest}–${day.close.auction.latest}`:""}`:"");
}
export function CalendarMonth({calendars,year,month,filter="all",selected="",today="",flags={},onSelect=()=>{}}:{calendars:Calendar[];year:number;month:number;filter?:CalendarFilter;selected?:string;today?:string;flags?:Record<string,string>;onSelect?:(date:string)=>void}) {
  const cells=useMemo(()=>calendarCells(calendars,year,month),[calendars,year,month]);
  const grid=useRef<HTMLDivElement>(null),[focused,setFocused]=useState("");
  if(!cells.length)return null;
  const enabled=cells.filter(cell=>cell.markets.some(item=>matchesCalendarFilter(item.day.status,filter)));
  const focusDate=[focused,selected,today].find(date=>enabled.some(cell=>cell.date===date))||enabled[0]?.date;
  const leading=(cells[0].weekday+6)%7;
  return <div className="market-calendar-grid" aria-label={`${year}/${month} 交易安排`} ref={grid}>
    <div className="market-calendar-weekdays" aria-hidden="true">{["周一","周二","周三","周四","周五","周六","周日"].map(label=><span key={label}>{label}</span>)}</div>
    <div className="market-calendar-days">
      {Array.from({length:leading},(_,i)=><span key={`before-${i}`} aria-hidden="true"/>)}
      {cells.map(cell=>{
        const visible=enabled.includes(cell),tone=calendarTone(cell);
        const quiet=(cell.weekday===0||cell.weekday===6)&&cell.markets.every(item=>["weekend","holiday"].includes(item.day.status));
        const marked=cell.markets.filter(item=>["holiday","half_day"].includes(item.day.status));
        return <button type="button" key={cell.date} className="market-calendar-day" data-date={cell.date} data-tone={visible?tone:"neutral"} style={visible&&tone==="mixed"?{backgroundImage:calendarFill(cell)}:undefined} data-filtered={!visible||undefined} aria-pressed={selected===cell.date} aria-current={today===cell.date?"date":undefined} disabled={!visible} tabIndex={cell.date===focusDate?0:-1}
          aria-label={`${year}/${month}/${cell.day} · ${cell.markets.map(item=>`${calendarMarketNames[item.market]||item.market}：${describe(item.day)}`).join("；")}`}
          onClick={()=>onSelect(selected===cell.date?"":cell.date)} onFocus={()=>setFocused(cell.date)}
          onKeyDown={event=>{const delta=({ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7} as Record<string,number>)[event.key];if(!delta)return;event.preventDefault();let i=cell.day-1+delta;while(i>=0&&i<cells.length){if(enabled.includes(cells[i])){grid.current?.querySelector<HTMLElement>(`[data-date="${cells[i].date}"]`)?.focus();break;}i+=delta;}}}>
          <time dateTime={cell.date}>{cell.day}</time>
          {!quiet&&tone==="holiday"&&<svg className="market-calendar-watermark" viewBox="0 0 100 60" aria-hidden="true"><text x="50" y="35" textAnchor="middle" fill="none" stroke="currentColor" strokeWidth=".8" strokeDasharray="1.5 1.4" fontSize="40">休市</text></svg>}
          {!quiet&&<span className="market-calendar-marks" aria-hidden="true">{marked.map(item=><span key={item.market}><MaterialFlag country={item.market} icons={flags}/>{item.day.status==="half_day"&&<i data-tone="half_day"/>}</span>)}{tone==="unknown"&&<i data-tone="unknown"/>}</span>}
          {!quiet&&marked.some(item=>item.day.name)&&<span className="market-calendar-reasons">{marked.filter(item=>item.day.name).map(item=><span key={item.market} title={item.day.name||""}>{calendars.length>1?`${calendarMarketNames[item.market]}：`:""}{item.day.name}</span>)}</span>}
        </button>;
      })}
      {Array.from({length:42-leading-cells.length},(_,i)=><span key={`after-${i}`} aria-hidden="true"/>)}
    </div>
  </div>;
}
export function MarketCalendar({active,onDenied}:{active:boolean;onDenied:(reason:unknown)=>void}) {
  const [params,setParams]=useSearchParams();
  const now=new Date(),currentYear=now.getFullYear(),currentMonth=now.getMonth()+1;
  const requested=params.get("market"),market=requested==="ALL"||calendarMarkets.some(code=>code===requested)?requested!:"US";
  const date=params.get("month")||"",compact=/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(date);
  const y=Number(compact?date.slice(0,4):params.get("calYear")),m=Number(compact?date.slice(5):params.get("calMonth"));
  const year=Number.isInteger(y)&&y>=2000&&y<=2100?y:currentYear,month=Number.isInteger(m)&&m>=1&&m<=12?m:currentMonth;
  const requestedFilter=params.get("status"),filter:CalendarFilter=requestedFilter==="closed"||requestedFilter==="half_day"||requestedFilter==="unknown"?requestedFilter:"all";
  const monthKey=`${year}-${String(month).padStart(2,"0")}`,day=params.get("day")||"",selected=/^([1-9]|[12]\d|3[01])$/.test(day)?`${monthKey}-${day.padStart(2,"0")}`:"";
  const [snapshot,setSnapshot]=useState<Batch|null>(null),[error,setError]=useState(""),[refresh,setRefresh]=useState(0),[loading,setLoading]=useState(false);
  const failure=useRef(onDenied);failure.current=onDenied;
  const flags=useMaterialFlags([...calendarMarkets],active);
  useEffect(()=>{
    if(!active)return;
    const controller=new AbortController();setError("");setLoading(true);setSnapshot(null);
    void api<{data:Batch}>(`/reference/calendar/batch?year=${year}`,{signal:controller.signal}).then(result=>{if(!controller.signal.aborted)setSnapshot(readCalendarBatch(result.data,year));}).catch(reason=>{if(!controller.signal.aborted){setError(reason instanceof Error?reason.message:"日历读取失败");if(reason instanceof ApiError&&[401,403].includes(reason.status))failure.current(reason);}}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[active,year,refresh]);
  const calendars=snapshot?calendarMarkets.filter(code=>market==="ALL"||code===market).flatMap(code=>snapshot.calendars[code]?[snapshot.calendars[code]]:[]):[];
  const cells=calendarCells(calendars,year,month),chosen=cells.find(cell=>cell.date===selected),verified=calendars.length>0&&calendars.every(calendar=>calendar.coverage.status==="verified");
  const timezone=calendars.length===1?calendars[0].timeZone:"Asia/Shanghai";
  let today="";try {const parts=new Intl.DateTimeFormat("en-CA",{timeZone:timezone||"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);today=["year","month","day"].map(part=>parts.find(value=>value.type===part)?.value).join("-");}catch{/* Invalid source timezone stays unknown. */}
  function update(patch:Record<string,string>){if(!active)return;setParams(previous=>{const next=new URLSearchParams(previous);next.set("view","calendar");next.set("market",market);next.set("month",monthKey);for(const [key,value]of Object.entries(patch)){if(value)next.set(key,value);else next.delete(key);}return next;},{replace:true});}
  function moveMonth(delta:number){const value=new Date(Date.UTC(year,month-1+delta,1));if(value.getUTCFullYear()>=2000&&value.getUTCFullYear()<=2100)update({month:`${value.getUTCFullYear()}-${String(value.getUTCMonth()+1).padStart(2,"0")}`,day:""});}
  const sources=Array.from(new Map(calendars.flatMap(calendar=>calendar.sources).map(source=>[source.id,source])).values());
  return <section className="market-calendar" aria-label="休市日历">
    <PageHeader title="休市日历" actions={<><SelectMenu label="日历年份" value={String(year)} onChange={value=>update({month:`${value}-${String(month).padStart(2,"0")}`,day:""})} options={Array.from({length:101},(_,i)=>({value:String(2000+i),label:`${2000+i} 年${calendars.length&&calendars.every(calendar=>calendar.coverage.verifiedYears?.includes(2000+i))?" · 已核实":""}`}))}/><button className="icon-button" type="button" aria-label="重新读取日历" disabled={loading} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={17}/></button></>}/>
    <p className="market-calendar-description">{market==="ALL"?"全部市场":calendarMarketNames[market]} · 按交易所当地日期显示{calendars.length===1&&calendars[0].timeZone?`（${calendars[0].timeZone}）`:""}</p>
    <div className="market-calendar-filters">
      <div role="group" aria-label="日历市场">{["ALL",...calendarMarkets].map(code=><button type="button" key={code} aria-pressed={market===code} onClick={()=>update({market:code,day:""})}>{code!=="ALL"&&<MaterialFlag country={code} icons={flags}/>} {code==="ALL"?"全部":calendarMarketNames[code]}</button>)}</div>
      <div role="group" aria-label="日历状态筛选">{([['closed','全天休市'],['half_day','半日市'],['unknown','未确认']] as const).map(([code,label])=><button key={code} type="button" aria-pressed={filter===code} onClick={()=>update({status:filter===code?"":code,day:""})}><i data-tone={code==="closed"?"holiday":code}/>{label}</button>)}</div>
    </div>
    {error&&<p role="alert" className="notice error">{error}</p>}
    {!loading&&calendars.length>0&&!verified&&<p className="market-calendar-coverage" role="status">{year} 年安排尚未确认，不能根据工作日推定开市。</p>}
    {filter!=="all"&&calendars.length>0&&<p className="market-calendar-description" role="status">本月符合筛选 {cells.filter(cell=>cell.markets.some(item=>matchesCalendarFilter(item.day.status,filter))).length} 天</p>}
    <div className="market-calendar-month">
      <div className="market-calendar-toolbar"><div><button className="icon-button" type="button" aria-label="上个月" disabled={year===2000&&month===1} onClick={()=>moveMonth(-1)}><ChevronLeft size={17}/></button><h2>{year} 年 {month} 月</h2><button className="icon-button" type="button" aria-label="下个月" disabled={year===2100&&month===12} onClick={()=>moveMonth(1)}><ChevronRight size={17}/></button></div><button className="button secondary small" type="button" onClick={()=>update({month:today?today.slice(0,7):`${currentYear}-${String(currentMonth).padStart(2,"0")}`,day:""})}>回到本月</button></div>
      {calendars.length?<CalendarMonth calendars={calendars} year={year} month={month} filter={filter} selected={selected} today={today} flags={flags} onSelect={value=>update({day:value?String(Number(value.slice(8))):""})}/>:<div className="market-calendar-loading" role="status">{loading?"正在读取日历…":"日历尚未取得"}</div>}
    </div>
    {chosen&&<section className="market-calendar-selected" aria-label="当日市场安排"><h3>{chosen.date}</h3>{chosen.markets.map(item=><p key={item.market}><MaterialFlag country={item.market} icons={flags}/><strong>{calendarMarketNames[item.market]}</strong><span>{describe(item.day)}{calendars.find(calendar=>calendar.market===item.market)?.timeZone?`（${calendars.find(calendar=>calendar.market===item.market)!.timeZone}）`:""}</span></p>)}</section>}
    {calendars.length>0&&<footer className="market-calendar-sources"><p>{verified?`${year} 年官方安排已收录`:"年度安排未确认"} · 临时停市与当日实际交易状态未核实</p><details><summary>官方安排与来源</summary>{calendars.map(calendar=><p key={calendar.market}>{calendarMarketNames[calendar.market]} · {calendar.timeZone||"时区未知"}{calendar.coverage.verifiedAt?` · 核对 ${calendar.coverage.verifiedAt}`:""}</p>)}{sources.map(source=><p key={source.id}><a href={calendarSourceUrl(source.url)} target="_blank" rel="noreferrer">{source.title}</a>{source.publishedAt&&<small> · 发布 {source.publishedAt}</small>}</p>)}{snapshot&&<p>数据版本 {snapshot.calendarVersion}</p>}<p>仅覆盖所列交易所的现货股票常规安排，不含个股停牌。</p></details></footer>}
  </section>;
}
