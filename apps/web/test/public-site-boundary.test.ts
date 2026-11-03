import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import {legacySitePath,loginDestination,safeReturnPath} from '../src/site-paths.ts';

Object.defineProperty(globalThis,'window',{value:{location:{origin:'https://alcor.example.invalid'}},configurable:true});

test('return paths stay same origin and never navigate into credential/API endpoints',()=>{
 for(const value of [null,'','https://evil.invalid','//evil.invalid','/\\evil.invalid','/%5c%5cevil.invalid','/%2f%2fevil.invalid','/api/auth/token','/%61pi/auth/token','/uploads/private','/login?returnTo=/portfolio','/setup','/reset-password?token=private'])assert.equal(safeReturnPath(value),null,value??'null');
 assert.equal(safeReturnPath('/records?account=declared#record'),'/portfolio?account=declared#record');
 assert.equal(safeReturnPath('/security/US.AAPL'),'/security/US.AAPL');
 assert.equal(legacySitePath('/quote-pool'),'/market');
 assert.equal(loginDestination('/login','?returnTo=//evil.invalid&next=%2Frecords%3Fview%3Dwatch',''),'/portfolio?view=watch');
 assert.equal(loginDestination('/login','?returnTo=%2Fapi%2Fauth%2Ftoken',''),'/');
});

test('PWA worker never caches private API or navigation, retries writes, or caches SPA HTML as build script',async()=>{
 const callbacks=new Map<string,(event:any)=>void>(),stored=new Map<string,Response>(),deleted:string[]=[];let calls=0,offline=false,privateReply=false;
 const cache={match:async(request:any)=>stored.get(request.url)?.clone(),put:async(request:any,response:Response)=>{stored.set(request.url,response);},keys:async()=>[...stored.keys()].map(url=>({url})),delete:async(request:any)=>stored.delete(request.url)};
 const context={URL,Response,Blob,console,self:{location:{origin:'https://alcor.example.invalid'},clients:{claim:async()=>{}},addEventListener:(name:string,callback:any)=>callbacks.set(name,callback)},
  caches:{open:async()=>cache,keys:async()=>['alcor-api-web-public-static-v1','alcor-api-web-public-static-v2','other-owner-cache'],delete:async(name:string)=>{deleted.push(name);}},fetch:async()=>{calls++;if(offline)throw new Error('controlled offline');const response=new Response(privateReply?'private HTML':'public build',{headers:{'Content-Type':privateReply?'text/html':'application/javascript','Cache-Control':privateReply?'private, no-store':'public, max-age=31536000'}});Object.defineProperty(response,'type',{value:'basic'});return response;}};
 vm.runInNewContext(await readFile(new URL('../public/service-worker.js',import.meta.url),'utf8'),context);
 const activation:Promise<unknown>[]=[];callbacks.get('activate')!({waitUntil:(value:Promise<unknown>)=>activation.push(value)});await Promise.all(activation);assert.deepEqual(deleted,['alcor-api-web-public-static-v1']);
 async function dispatch(path:string,options:{method?:string;mode?:string;destination?:string;headers?:Record<string,string>}={}){
  let answer:Promise<Response>|undefined;const waits:Promise<unknown>[]=[];
  callbacks.get('fetch')!({request:{url:'https://alcor.example.invalid'+path,method:options.method??'GET',mode:options.mode??'cors',destination:options.destination??'script',headers:new Headers(options.headers)},respondWith:(value:Promise<Response>)=>{answer=value;},waitUntil:(value:Promise<unknown>)=>waits.push(value)});
  const result=answer?await answer:undefined;await Promise.all(waits);return result;
 }
 assert.equal(await dispatch('/api/ticker'),undefined);
 assert.equal(await dispatch('/api/account/simple-ledger',{method:'PUT'}),undefined);
 assert.equal(await dispatch('/assets/authenticated-12345678.js',{headers:{Authorization:'Bearer never-store-this'}}),undefined);
 assert.equal(await dispatch('/assets/cookie-12345678.js',{headers:{Cookie:'private=session'}}),undefined);
 assert.equal(calls,0);assert.equal(stored.size,0);
 privateReply=true;await dispatch('/assets/fake-12345678.js');assert.equal(stored.size,0);
 privateReply=false;await dispatch('/assets/build-12345678.js');assert.equal(stored.size,1);
 offline=true;
 const navigation=await dispatch('/portfolio',{mode:'navigate',destination:'document'});
 assert.equal(navigation?.status,503);assert.match(await navigation!.text(),/当前无法连接/);assert.equal(navigation?.headers.get('Cache-Control'),'no-store');
 assert.equal(stored.size,1);
 assert.equal(await dispatch('/api/portfolio/records'),undefined);
});
