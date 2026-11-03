import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

test('actual public celebrity components keep unknown/exact holdings and disclosure coverage without a fabricated performance chart',async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url));await mkdir(join(root,'.local'),{recursive:true});const tmp=await mkdtemp(join(root,'.local/celeb-dom-'));
 try{
  const output=join(tmp,'celeb.cjs');await build({entryPoints:[fileURLToPath(new URL('../src/celebs.tsx',import.meta.url))],outfile:output,bundle:true,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime'],loader:{'.css':'empty'},define:{'import.meta.env.VITE_UI_PERF':'"0"','import.meta.env.VITE_UI_DELAY_MS':'""'},logLevel:'silent'});
  const m=createRequire(import.meta.url)(output);
  const holdings=renderToStaticMarkup(React.createElement(m.DisclosedHoldings,{person:{stockIcons:{},holdings:[{code:'UNKNOWN',name:'Source record',market:null,currency:null,qty:null,quantity:'0',cost:null,weight:null,price:'0.000000000000000001',target:null,asOf:null,value:'123456789123456789.123456789',valueUnit:null}]}}));
  assert.match(holdings,/未知 \/ 未知/);assert.match(holdings,/数量 0/);assert.match(holdings,/qty 未知/);assert.match(holdings,/成本 未知/);assert.match(holdings,/0\.000000000000000001/);assert.match(holdings,/123456789123456789\.123456789/);assert.match(holdings,/非实时价格/);assert.ok(!holdings.includes('数量 0 · qty 0'));
  const unavailable=renderToStaticMarkup(React.createElement(m.DisclosureNotice,{authority:'registered_disclosure_source_retained_unavailable',detail:null}));assert.match(unavailable,/当前不可核对/);assert.match(unavailable,/历史登记/);
  const partial=renderToStaticMarkup(React.createElement(m.DisclosureNotice,{authority:'verified_disclosure_original',detail:{reportedSourceEvidence:{coverage:{wholePortfolioKnown:false,unparsedAccessions:['one']}}}}));assert.match(partial,/完整持仓与交易历史未知/);
  const base={dates:['2020-01-01','2020-01-02'],values:['1','2'],benchmarks:[],state:'unknown',disclosedSummary:{y1:null,y3:null,y5:null,spxY1:null},provenance:{},unknownReasons:[],syntheticHistory:false,portfolioPerformanceKnown:false};
  const unknown=renderToStaticMarkup(React.createElement(m.ReturnsView,{value:base}));assert.ok(!unknown.includes('<svg'));assert.match(unknown,/收益范围未知/);assert.match(unknown,/原声明收益未经独立核验/);
  const blocked=renderToStaticMarkup(React.createElement(m.ReturnsView,{value:{...base,state:'observed',provenance:{sourceIntegrity:{state:'retained_unavailable'}}}}));assert.ok(!blocked.includes('<svg'));
  const actual=renderToStaticMarkup(React.createElement(m.ObservedReturns,{dates:base.dates,values:['1.000000000000000001','1.000000000000000002'],label:'Source declarations'}));assert.match(actual,/实际日期间隔/);assert.match(actual,/已知 2\/2/);assert.match(actual,/156/);assert.match(actual,/24/);
 }finally{await rm(tmp,{recursive:true,force:true});}
});
