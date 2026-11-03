import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp,mkdir,rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
test("actual fee fields show source evidence with an empty paid fee and explicit owner declarations",async()=>{
  const root=fileURLToPath(new URL("../../../",import.meta.url));await mkdir(join(root,".local"),{recursive:true});const dir=await mkdtemp(join(root,".local","actual-fee-dom-"));
  try{
    const output=join(dir,"actual.cjs");await build({entryPoints:[fileURLToPath(new URL("../src/actual-fee-fields.tsx",import.meta.url))],outfile:output,bundle:true,platform:"node",format:"cjs",jsx:"automatic",external:["react","react/jsx-runtime"],logLevel:"silent"});
    const {ActualFeeFields}=createRequire(import.meta.url)(output);
    const item={tradeId:"synthetic-trade",originalOrderId:"original-order",manifestId:"original-manifest",manifestSha256:"a".repeat(64),registeredFees:"0",actualFee:null,actualFeeKnown:false};
    const props={snapshot:{items:[item]},selected:item.tradeId,draft:{amount:"",currency:"",statement:"",actualConfirmed:false,cashConfirmed:false},disabled:false,onEdit(){},onSelect(){},onPreview(){}};
    const html=renderToStaticMarkup(React.createElement(ActualFeeFields,props));
    assert.ok(html.includes("实际费用确认")&&html.includes("原始依据")&&html.includes(item.manifestSha256));
    assert.match(html,/inputMode="decimal"[^>]*value=""/);assert.ok(!html.includes("checked=\"\""));
    assert.ok(html.includes("本人已核实实际支付的费用")&&html.includes("已核对原现金账户及币种"));assert.ok(!html.includes("1.03"));assert.ok(!html.includes("券商已核实"));assert.ok(!html.includes("<h1>"));
    const known=renderToStaticMarkup(React.createElement(ActualFeeFields,{...props,snapshot:{items:[{...item,actualFee:"0",actualFeeKnown:true}]}}));
    assert.ok(known.includes("已核实实付 0"));assert.ok(!known.includes("textarea"));
    const missing=renderToStaticMarkup(React.createElement(ActualFeeFields,{...props,snapshot:{items:[]},selected:""}));
    assert.ok(missing.includes("尚无已核对的原订单基线"));assert.ok(!missing.includes("已完成"));
  }finally{await rm(dir,{recursive:true,force:true});}
});
