import test from "node:test";
import assert from "node:assert/strict";
import { calendarCells,calendarTone,matchesCalendarFilter,readCalendarBatch,calendarSourceUrl } from "../src/market-calendar-state.ts";
import type { Calendar } from "../src/reference.tsx";
function calendar(market:string,year:number):Calendar {
 return {market,year,calendarVersion:"synthetic-only",days:Array.from({length:new Date(Date.UTC(year,1,29)).getUTCMonth()===1?366:365},(_,i)=>({date:new Date(Date.UTC(year,0,i+1)).toISOString().slice(0,10),status:"unknown",name:null,isTradingDay:null,close:null})),coverage:{status:"unknown",verifiedAt:null},sources:[]};
}
test("calendar cell layout preserves missing weekend as unknown and leap-year boundaries",()=>{
 const source=calendar("US",2024);source.days=[];
 const cells=calendarCells([source],2024,2);
 assert.equal(cells.length,29);assert.equal(cells[28].date,"2024-02-29");
 const saturday=cells.find(cell=>cell.weekday===6)!;
 assert.equal(saturday.markets[0].day.status,"unknown");assert.equal(calendarTone(saturday),"unknown");
 saturday.markets[0].day.status="weekend";assert.equal(calendarTone(saturday),"neutral");
 assert.equal(calendarCells([source],2025,2).length,28);
 assert.deepEqual(calendarCells([source],2024,13),[]);
 assert.equal(matchesCalendarFilter("trading","closed"),false);
 assert.equal(matchesCalendarFilter("holiday","closed"),true);
 assert.equal(matchesCalendarFilter("unknown","unknown"),true);
});
test("three-market batch refuses mixed versions, duplicated days and incomplete annual data",()=>{
 const make=()=>({calendarVersion:"synthetic-only",year:2024,calendars:Object.fromEntries(["US","HK","CN"].map(market=>[market,calendar(market,2024)]))});
 assert.equal(readCalendarBatch(make(),2024).calendars.US.days.length,366);
 for(const change of [
  (batch:ReturnType<typeof make>)=>{batch.calendars.HK.calendarVersion="other";},
  (batch:ReturnType<typeof make>)=>{delete batch.calendars.CN;},
  (batch:ReturnType<typeof make>)=>{batch.calendars.US.days.pop();},
  (batch:ReturnType<typeof make>)=>{batch.calendars.US.days[1].date=batch.calendars.US.days[0].date;},
  (batch:ReturnType<typeof make>)=>{batch.calendars.US.days[1].date="2024-02-30";},
 ]){const value=make();change(value);assert.throws(()=>readCalendarBatch(value,2024));}
 assert.throws(()=>readCalendarBatch(make(),2025));
});
test("source links remain limited to web protocols",()=>{
 assert.equal(calendarSourceUrl("https://exchange.invalid/calendar"),"https://exchange.invalid/calendar");
 for(const value of ["javascript:alert(1)","data:text/html,hi","file:///private/data","not-a-url"])assert.equal(calendarSourceUrl(value),undefined);
});
