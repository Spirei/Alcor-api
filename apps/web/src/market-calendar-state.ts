import type { Calendar } from "./reference";
export const calendarMarkets = ["US", "HK", "CN"] as const;
export const calendarMarketNames: Record<string,string> = {US:"美股",HK:"港股",CN:"A 股"};
export type CalendarCell = {date:string;day:number;weekday:number;markets:{market:string;day:Calendar["days"][number]}[]};
export type CalendarFilter = "all"|"closed"|"half_day"|"unknown";
export type CalendarBatch={calendarVersion:string;year:number;calendars:Record<string,Calendar>};
export function readCalendarBatch(value:unknown,year:number):CalendarBatch {
  const batch=value as CalendarBatch|null;
  if(!Number.isInteger(year)||year<2000||year>2100)throw new Error("日历年份无效");
  const length=new Date(Date.UTC(year,1,29)).getUTCMonth()===1?366:365;
  const fail=()=>{throw new Error("日历批次或年度数据不完整，请重新读取");};
  if(!batch||batch.year!==year||typeof batch.calendarVersion!=="string"||!batch.calendarVersion||batch.calendarVersion.length>128||!batch.calendars)fail();
  for(const market of calendarMarkets){
    const calendar=batch!.calendars[market];
    if(!calendar||calendar.market!==market||calendar.year!==year||calendar.calendarVersion!==batch!.calendarVersion||!Array.isArray(calendar.days)||calendar.days.length!==length||!calendar.coverage||!["verified","unknown"].includes(calendar.coverage.status)||!Array.isArray(calendar.sources)||calendar.sources.length>64)fail();
    const seen=new Set<string>();
    for(const day of calendar.days){
      if(typeof day.date!=="string"||!day.date.startsWith(`${year}-`)||!/^\d{4}-\d{2}-\d{2}$/.test(day.date)||!Number.isFinite(new Date(day.date+"T00:00:00Z").getTime())||new Date(day.date+"T00:00:00Z").toISOString().slice(0,10)!==day.date||seen.has(day.date)||!["trading","weekend","holiday","half_day","unknown"].includes(day.status))fail();
      seen.add(day.date);
    }
  }
  return batch!;
}
export function calendarCells(calendars:Calendar[],year:number,month:number):CalendarCell[] {
  if(!Number.isInteger(year)||year<2000||year>2100||!Number.isInteger(month)||month<1||month>12)return [];
  const indexes=calendars.map(calendar=>({market:calendar.market,days:new Map(calendar.days.map(day=>[day.date,day]))}));
  return Array.from({length:new Date(Date.UTC(year,month,0)).getUTCDate()},(_,i)=>{
    const date=`${year}-${String(month).padStart(2,"0")}-${String(i+1).padStart(2,"0")}`;
    return {date,day:i+1,weekday:new Date(date+"T00:00:00Z").getUTCDay(),markets:indexes.map(item=>({market:item.market,day:item.days.get(date)??{date,status:"unknown",name:null,isTradingDay:null,close:null}}))};
  });
}
export function matchesCalendarFilter(status:string,filter:CalendarFilter) {
  return filter==="all" || (filter==="closed"? status==="holiday"||status==="weekend" : status===filter);
}
export function calendarTone(cell:CalendarCell):"neutral"|"holiday"|"half_day"|"unknown"|"mixed" {
  const statuses=cell.markets.map(item=>item.day.status);
  if((cell.weekday===0||cell.weekday===6)&&statuses.every(status=>status==="weekend"||status==="holiday"))return "neutral";
  const tones=[...new Set(statuses.filter(status=>["holiday","half_day","unknown"].includes(status)))];
  return tones.length>1?"mixed":(tones[0] as "holiday"|"half_day"|"unknown")||"neutral";
}
export function calendarFill(cell:CalendarCell):string|undefined {
  if(calendarTone(cell)!=="mixed")return undefined;
  const colors={holiday:"#c19c79",half_day:"#c99c35",unknown:"#9d7dc2"};
  const counts=Object.entries(colors).map(([tone,color])=>({color,count:cell.markets.filter(item=>item.day.status===tone).length})).filter(item=>item.count);
  const total=counts.reduce((sum,item)=>sum+item.count,0);let cursor=0;
  return `linear-gradient(125deg,${counts.map(item=>{const start=cursor;cursor+=item.count/total*100;return `color-mix(in srgb,${item.color} 18%,var(--surface)) ${start}% ${cursor}%`;}).join(",")})`;
}
export function calendarSourceUrl(value:string) {
  try {const url=new URL(value);return ["https:","http:"].includes(url.protocol)?url.href:undefined;}catch{return undefined;}
}
