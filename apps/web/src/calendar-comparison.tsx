import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { dayLabel } from "./reference-state";
import type { Calendar } from "./reference";

export function CalendarComparison({year,month,active,onDenied}:{year:string;month:string;active:boolean;onDenied:(failure:unknown)=>void}){
 const [value,setValue]=useState<{calendarVersion:string;year:number;calendars:Record<string,Calendar>}|null>(null),[error,setError]=useState('');
 const epoch=useRef(0),failure=useRef(onDenied);failure.current=onDenied;
 useEffect(()=>{setValue(null);setError('');if(!active||document.hidden||!/^\d{4}$/.test(year)||Number(year)<2000||Number(year)>2100)return;const run=++epoch.current,controller=new AbortController();void api<{data:{calendarVersion:string;year:number;calendars:Record<string,Calendar>}}>('/reference/calendar/batch?year='+year,{signal:controller.signal}).then(result=>{if(!controller.signal.aborted&&run===epoch.current)setValue(result.data);}).catch(reason=>{if(!controller.signal.aborted&&run===epoch.current){setError(reason instanceof Error?reason.message:'日历读取失败');failure.current(reason);}});return()=>{epoch.current++;controller.abort();};},[year,active]);
 if(error)return <p role="alert">{error}</p>;
 if(!value)return <p role="status">日历尚未取得</p>;
 const markets=['CN','HK','US'],days=new Map<string,Map<string,Calendar['days'][number]>>();
 for(const market of markets)for(const day of value.calendars[market]?.days||[]){if(day.date.slice(5,7)!==month)continue;if(!days.has(day.date))days.set(day.date,new Map());days.get(day.date)!.set(market,day);}
 return <><div className="reference-calendar"><table><thead><tr><th>日期</th>{markets.map(market=><th key={market}>{value.calendars[market]?.marketName||market}<small>{value.calendars[market]?.timeZone||'时区未知'}</small></th>)}</tr></thead><tbody>{[...days].sort(([left],[right])=>left.localeCompare(right)).map(([date,observations])=><tr key={date}><td>{date}</td>{markets.map(market=>{const day=observations.get(market);return <td key={market}>{day?dayLabel(day.status):'未确认'}{day?.name&&<small>{day.name}</small>}{day?.close&&<small>连续交易收市 {day.close.continuous}{day.close.auction?` · 收市竞价区间 ${day.close.auction.earliest}—${day.close.auction.latest}`:''}</small>}</td>;})}</tr>)}</tbody></table></div>{markets.map(market=>{const calendar=value.calendars[market];return calendar&&<details key={market}><summary>{calendar.marketName||market} · {calendar.coverage.status==='verified'?'年度安排已收录':'该年份未确认'}</summary><p>临时停市与当日实际交易状态未核实</p>{calendar.sources.map(source=><p key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>{source.publishedAt&&<small>发布 {source.publishedAt}</small>}{source.verifiedAt&&<small>核对 {source.verifiedAt}</small>}</p>)}</details>;})}</>;
}
