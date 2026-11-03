import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,mkdir,rm} from "node:fs/promises";
import {createRequire} from "node:module";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {emptyActualFeeDraft} from "../src/actual-fee-state.ts";
import {nativeActualFeeCommand,type NativeActualFeeSnapshot} from "../src/native-actual-fee-state.ts";
import {operationPath,restoreOperation,saveOperation} from "../src/operation-journal.ts";
const item={tradeId:"aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",recordId:"r-test",recordRevision:4,registrationRequestId:"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",registrationSha256:"a".repeat(64),currency:"USD",registeredFees:"1.03",estimatedFees:"1.03",actualFee:null,actualFeeKnown:false,authority:null,canConfirm:true,occurredAt:"2026-09-02T00:00:00Z",code:"A",side:"buy"};
const snapshot:NativeActualFeeSnapshot={targetUserId:"u-owner",brokerAccountId:"ba-synthetic",brokerRevision:2,snapshotRevision:"b".repeat(64),coverageScope:"completed_native_calculated_fee_registrations_only",items:[item]};
test("native actual command starts blank and requires explicit original currency, paid statement and same registration",()=>{
 const draft=emptyActualFeeDraft();assert.equal(draft.amount,"");assert.equal(draft.currency,"");
 assert.throws(()=>nativeActualFeeCommand(snapshot,item,draft,"u-owner",item.registrationRequestId));
 const paid={amount:"0",currency:"USD",statement:"Verified actual zero against my cash record",actualConfirmed:true,cashConfirmed:true};
 const body=nativeActualFeeCommand(snapshot,item,paid,"u-owner",item.registrationRequestId);
 assert.equal(body.confirmations[0].actualFee,"0");assert.equal(body.confirmations[0].authority,"owner_recorded");assert.equal(body.confirmations[0].registrationSha256,item.registrationSha256);
 assert.throws(()=>nativeActualFeeCommand(snapshot,item,{...paid,currency:"HKD"},"u-owner",item.registrationRequestId));
 assert.throws(()=>nativeActualFeeCommand(snapshot,item,paid,"u-other",item.registrationRequestId));
 assert.throws(()=>nativeActualFeeCommand(snapshot,{...item,registrationSha256:"c".repeat(64)},paid,"u-owner",item.registrationRequestId));
});
test("native confirmation journal persists only original receipt locator and resolves the native query route",()=>{
 const map=new Map<string,string>();const storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)},removeItem:(k:string)=>{map.delete(k)},key:(i:number)=>Array.from(map.keys())[i]??null,get length(){return map.size}};
 saveOperation(storage,"owner:instance:session",{id:item.registrationRequestId,kind:"native_fee_confirmation"});
 assert.equal(restoreOperation(storage,"owner:instance:session")?.kind,"native_fee_confirmation");assert.equal(operationPath("native_fee_confirmation"),"/fees/confirmations/native");
 assert.ok(!Array.from(map.values()).join().includes("1.03"));assert.ok(!Array.from(map.values()).join().includes("statement"));
});
test("shared paid form shows exact native registration but never pre-fills estimated fees as actual",async()=>{
 const root=fileURLToPath(new URL("../../../",import.meta.url));await mkdir(join(root,".local"),{recursive:true});const dir=await mkdtemp(join(root,".local","native-actual-dom-"));
 try{const out=join(dir,"form.cjs");await build({entryPoints:[fileURLToPath(new URL("../src/actual-fee-fields.tsx",import.meta.url))],outfile:out,bundle:true,platform:"node",format:"cjs",jsx:"automatic",external:["react","react/jsx-runtime"],logLevel:"silent"});const {ActualFeeFields}=createRequire(import.meta.url)(out);
 const html=renderToStaticMarkup(React.createElement(ActualFeeFields,{snapshot,selected:item.tradeId,draft:emptyActualFeeDraft(),disabled:false,onSelect(){},onEdit(){},onPreview(){}}));
 assert.ok(html.includes("计算费用实付确认")&&html.includes(item.registrationRequestId)&&html.includes(item.registrationSha256));
 assert.match(html,/inputMode="decimal"[^>]*value=""/);assert.ok(!html.includes('value="1.03"'));assert.ok(!html.includes("已核实实付 1.03"));assert.ok(!html.includes("查看原始快照"));
 assert.ok(html.includes("本人已核实实际支付的费用")&&html.includes("已核对原现金账户及币种"));
 }finally{await rm(dir,{recursive:true,force:true});}
});
