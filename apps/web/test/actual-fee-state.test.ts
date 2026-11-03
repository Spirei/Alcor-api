import assert from "node:assert/strict";
import test from "node:test";
import { actualFeeCommand,emptyActualFeeDraft,type ActualFeeSnapshot } from "../src/actual-fee-state.ts";
import { operationPath,restoreOperation,saveOperation } from "../src/operation-journal.ts";
const id="12345678-1234-4234-8234-123456789abc";
const snapshot:ActualFeeSnapshot={targetUserId:"synthetic-owner",brokerAccountId:"ba-"+"1".repeat(24),brokerRevision:3,snapshotRevision:"b".repeat(64),coverageScope:"verified_existing_registered_baselines_only",wholeLegacyFinancialComplete:false,items:[{originalOrderId:"old-original-order",tradeId:id,recordId:"r-1",recordRevision:7,manifestId:id,manifestSha256:"a".repeat(64),registeredFees:"0",actualFee:null,actualFeeKnown:false,authority:null}]};
test("actual confirmation starts empty and keeps exact paid fee separate from every estimate",()=>{
  const draft=emptyActualFeeDraft();assert.equal(draft.amount,"");assert.equal(draft.currency,"");assert.equal(draft.actualConfirmed,false);assert.equal(draft.cashConfirmed,false);
  assert.throws(()=>actualFeeCommand(snapshot,snapshot.items[0],draft,"synthetic-owner",id),/填写/);
  const entered={...draft,amount:"1.11",currency:"USD",statement:"本人已逐笔核实原账户实际支付1.11。",actualConfirmed:true,cashConfirmed:true};
  const data=actualFeeCommand(snapshot,snapshot.items[0],entered,"synthetic-owner",id);
  assert.equal(data.confirmations[0].actualFee,"1.11");assert.equal(data.confirmations[0].authority,"owner_recorded");
  assert.equal(data.manifestId,id);assert.equal(data.manifestSha256,"a".repeat(64));assert.equal(data.confirmations[0].originalOrderId,"old-original-order");
  assert.equal("plan" in data,false);assert.equal("ruleVersion" in data,false);assert.equal(entered.amount,"1.11");
  assert.equal(actualFeeCommand(snapshot,snapshot.items[0],{...entered,amount:"0"},"synthetic-owner",id).confirmations[0].actualFee,"0");
  assert.throws(()=>actualFeeCommand(snapshot,{...snapshot.items[0],actualFeeKnown:true,actualFee:"0"},entered,"synthetic-owner",id),/不能覆盖/);
  assert.throws(()=>actualFeeCommand(snapshot,snapshot.items[0],entered,"another-owner",id),/基线/);
  assert.throws(()=>actualFeeCommand(snapshot,{...snapshot.items[0],recordRevision:8},entered,"synthetic-owner",id),/基线/);
});
test("actual confirmation journal persists only its original locator and resolves the actual receipt route",()=>{
  const values=new Map<string,string>();const storage={get length(){return values.size;},key(index:number){return [...values.keys()][index]??null;},getItem(key:string){return values.get(key)??null;},setItem(key:string,value:string){values.set(key,value);},removeItem(key:string){values.delete(key);}};
  saveOperation(storage,"scope",{id,kind:"fee_confirmation"});
  assert.equal(operationPath(restoreOperation(storage,"scope")!.kind),"/fees/confirmations");
  assert.deepEqual(JSON.parse([...values.values()][0]),{id,kind:"fee_confirmation"});
  assert.ok(![...values.values()][0].includes("statement"));
});
