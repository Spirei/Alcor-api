/** Independent declared ledger. Numeric source tokens survive untouched until explicitly edited. */
export class SourceNumber { readonly raw:string; constructor(raw:string){this.raw=raw;} }
export type Value = null|boolean|string|SourceNumber|Value[]|{[key:string]:Value};
export type Row = {[key:string]:Value};
export const categories = ['cash','fixed','receivable','debt','invest'] as const;
export type Category = typeof categories[number];
export const labels:Record<Category,string>={cash:'流动资金',fixed:'固定资产',receivable:'应收款',debt:'负债',invest:'投资理财'};
export const pages=['home','weather','cashflow','family','calendar','manage','update','addItem','editItem','help','invest','addInvest','summary','addSummary','account','settings'] as const;
export type Page=typeof pages[number];
export function decode(raw:string):Value {
 let at=0,depth=0;const space=()=>{while(/\s/.test(raw[at]||'')&&at<raw.length)at++;};
 const read=():Value=>{space();const c=raw[at];if(c==='"'){const start=at++;while(at<raw.length){if(raw[at]==='\\'){at+=2;continue;}if(raw[at++]==='"')return JSON.parse(raw.slice(start,at));}throw Error('字符串不完整');}
 if(c==='{'||c==='['){if(++depth>128)throw Error('JSON嵌套超过128层，请保留原件并核对');at++;const array=c==='[',end=array?']':'}';const out:Row|Value[]=array?[]:{};space();if(raw[at]===end){at++;depth--;return out;}while(at<raw.length){if(array)(out as Value[]).push(read());else{const key=read();if(typeof key!=='string'||Object.hasOwn(out,key))throw Error('JSON字段重复或无效');space();if(raw[at++]!==':')throw Error('JSON字段无效');Object.defineProperty(out,key,{value:read(),enumerable:true,writable:true,configurable:true});}space();if(raw[at]===end){at++;depth--;return out;}if(raw[at++]!==',')throw Error('JSON分隔符无效');}throw Error('JSON不完整');}
 for(const [word,value]of [['true',true],['false',false],['null',null]] as const)if(raw.startsWith(word,at)){at+=word.length;return value;}
 const n=raw.slice(at).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);if(!n)throw Error('JSON数值无效');at+=n[0].length;return new SourceNumber(n[0]);};
 const value=read();space();if(at!==raw.length)throw Error('JSON尾部无效');return value;
}
export function encode(value:Value):string {if(value instanceof SourceNumber)return value.raw;if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(encode).join(',')+']';return '{'+Object.entries(value).map(([key,v])=>JSON.stringify(key)+':'+encode(v)).join(',')+'}';}
export const object=(value:Value|undefined):Row=>value&&typeof value==='object'&&!Array.isArray(value)&&!(value instanceof SourceNumber)?value:{};
export const rows=(value:Value|undefined):Row[]=>Array.isArray(value)?value.filter(v=>v&&typeof v==='object'&&!Array.isArray(v)&&!(v instanceof SourceNumber)) as Row[]:[];
export const text=(value:Value|undefined):string=>value instanceof SourceNumber?value.raw:typeof value==='string'?value:'';
export function decimal(value:Value|undefined):string|null {const s=text(value);if(!s||s.length>200||!/^[-+]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(s))return null;const [mantissa,exp='0']=s.toLowerCase().split('e');const e=Number(exp);if(!Number.isInteger(e)||Math.abs(e)>200)return null;const negative=mantissa.startsWith('-');const [whole,fraction='']=mantissa.replace(/^[-+]/,'').split('.');let digits=whole+fraction;const scale=fraction.length-e;if(scale<0)digits+='0'.repeat(-scale);else if(scale>=digits.length)digits='0'.repeat(scale-digits.length+1)+digits;const n=scale>0?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits;const clean=n.replace(/^0+(?=\d)/,'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');return (negative&&/[1-9]/.test(clean)?'-':'')+clean;}
function parts(v:string){const [w,f='']=v.split('.');return {n:BigInt(w+f),s:f.length};}
export function add(a:string|null,b:string|null):string|null {if(a===null||b===null)return null;const x=parts(a),y=parts(b),s=Math.max(x.s,y.s);return scaled(x.n*10n**BigInt(s-x.s)+y.n*10n**BigInt(s-y.s),s);}
function scaled(n:bigint,s:number){const negative=n<0n;if(negative)n=-n;let raw=n.toString().padStart(s+1,'0');if(s)raw=raw.slice(0,-s)+'.'+raw.slice(-s);return decimal((negative?'-':'')+raw)!;}
export const negate=(s:string|null)=>s===null?null:s==='0'?'0':s.startsWith('-')?s.slice(1):'-'+s;
export function multiply(a:string|null,b:string|null):string|null{if(a===null||b===null)return null;const x=parts(a),y=parts(b);return scaled(x.n*y.n,x.s+y.s);}
export function deriveRatio(a:string|null,b:string|null):{value:string|null;basis:'exact'|'rounded_18_significant_digits'|'unknown'} {if(a===null||b===null||b==='0')return {value:null,basis:'unknown'};const x=parts(a),y=parts(b);let n=x.n*10n**BigInt(y.s),d=y.n*10n**BigInt(x.s);if(d<0n){n=-n;d=-d;}const gcd=(a:bigint,b:bigint):bigint=>{a=a<0n?-a:a;while(b){const next=a%b;a=b;b=next;}return a;};const common=gcd(n,d);n/=common;d/=common;const denominator=d;let twos=0,fives=0;while(d%2n===0n){d/=2n;twos++;}while(d%5n===0n){d/=5n;fives++;}const exactScale=Math.max(twos,fives);if(d===1n&&exactScale<=400){const value=scaled(n*2n**BigInt(exactScale-twos)*5n**BigInt(exactScale-fives),exactScale);return {value,basis:value===null?'unknown':'exact'};}
 const negative=n<0n,abs=negative?-n:n;let exponent=abs.toString().length-denominator.toString().length;if(exponent>=0){if(abs<denominator*10n**BigInt(exponent))exponent--;}else if(abs*10n**BigInt(-exponent)<denominator)exponent--;const scale=17-exponent;if(Math.abs(scale)>1000)return {value:null,basis:'unknown'};let rounded:bigint;if(scale>=0)rounded=(abs*10n**BigInt(scale)*2n+denominator)/(2n*denominator);else{const denom=denominator*10n**BigInt(-scale);rounded=((abs*2n+denom)/(2n*denom))*10n**BigInt(-scale);}if(abs!==0n&&rounded===0n)return {value:null,basis:'unknown'};return {value:scaled(negative?-rounded:rounded,Math.max(0,scale)),basis:'rounded_18_significant_digits'};
}
export function ratio(a:string|null,b:string|null):string|null{return deriveRatio(a,b).value;}

export const sum=(values:(string|null)[])=>values.reduce<string|null>((a,b)=>add(a,b),'0');
export function amountIn(row:Row,ledger:Row,currency:string):string|null {const amount=decimal(row.amount),cur=text(row.cur);if(!cur||!currency)return null;if(cur===currency)return amount;const fx=object(ledger.fx),from=decimal(fx[cur]),to=decimal(fx[currency]);if(from===null||to===null||from==='0'||to==='0'||from.startsWith('-')||to.startsWith('-'))return null;return ratio(multiply(amount,from),to);}
export function validateRow(row:Row,investment=false,previous?:Row):string|null {const changed=(key:string)=>!previous||encode(row[key]??null)!==encode(previous[key]??null);if(changed('name')&&!text(row.name).trim())return '请填写名称';if(changed('amount')&&decimal(row.amount)===null)return '修改金额时请明确填写精确值；未改的未知原值保留';if(changed('cur')&&!text(row.cur).trim())return '修改币种时请明确选择';if(investment&&changed('bucket')&&!['活钱','稳健','长期'].includes(text(row.bucket)))return '请选择投资分类';return null;}

export function day(s:string):boolean {if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;}
export function patchRow(ledger:Row,category:Category,row:Row):Row {const source=ledger[category];if(!Array.isArray(source))throw Error('原类别不是数组，不能覆盖未知原值');const id=text(row.id);if(!id)throw Error('记录缺少稳定编号，不能按名称猜测');const count=source.filter(r=>text(object(r).id)===id).length;if(count>1)throw Error('记录编号重复，请先核对原件');return {...ledger,[category]:count?source.map(r=>text(object(r).id)===id?row:r):[...source,row]};}
/** Typed list controls never erase unrecognized historical elements. */
export function retainUnknown(previous:Value|undefined,next:Value):Value {if(!Array.isArray(previous)||!Array.isArray(next))return next;const unknown=(v:Value)=>v===null||typeof v!=='object'||Array.isArray(v)||v instanceof SourceNumber;const available=new Map<string,number>();for(const v of next)if(unknown(v)){const key=encode(v);available.set(key,(available.get(key)||0)+1);}const out=[...next];for(let i=0;i<previous.length;i++){const value=previous[i];if(unknown(value)){const key=encode(value),count=available.get(key)||0;if(count)available.set(key,count-1);else out.splice(Math.min(i,out.length),0,value);}}return out;}

export function typedPatch(previous:Row,next:Row):Row {const result={...next};for(const key of [...categories,'members','summaries','snaps','logs'])if(key in next)result[key]=retainUnknown(previous[key],next[key]);if(next.cashflow){const old=object(previous.cashflow),updated={...object(next.cashflow)};for(const key of ['incomeItems','expenseItems'])if(key in updated)updated[key]=retainUnknown(old[key],updated[key]);result.cashflow=updated;}return result;}

export function totals(ledger:Row,currency:string,member=''):Record<string,string|null>{if(!currency.trim())return {cash:null,fixed:null,receivable:null,debt:null,invest:null,assets:null,net:null};const result:Record<string,string|null>={};for(const cat of categories){const list=rows(ledger[cat]).filter(r=>!r.archived&&(!member||text(r.owner)===member));const source=ledger[cat];result[cat]=!Array.isArray(source)||source.some(r=>r===null||typeof r!=='object'||Array.isArray(r)||r instanceof SourceNumber||cat==='debt'&&decimal(object(r).amount)!==null&&decimal(object(r).amount)!=='0'&&!decimal(object(r).amount)!.startsWith('-'))?null:sum(list.map(r=>amountIn(r,ledger,currency)));}result.assets=sum(['cash',...(ledger.excludeFixed===true?[]:['fixed']),'receivable','invest'].map(k=>result[k]));result.net=add(result.assets,result.debt);return result;}
export function annual(row:Row):string|null {const factors:Record<string,string>={month:'12',year:'1',week:'52',day:'365',quarter:'4',once:'1',monthly:'12',yearly:'1'};const factor=factors[text(row.freq)];return factor?multiply(decimal(row.amount),factor):null;}
export function move(list:Value[],index:number,direction:number):Value[]{const to=index+direction;if(to<0||to>=list.length)return list;const result=[...list];[result[index],result[to]]=[result[to],result[index]];return result;}
/** Approximate numerical return solver for explicitly complete owner-declared observed cash flows. */
export function performance(history:Row[],complete:boolean,asOf=new Date().toISOString().slice(0,10)):{state:string;reason:string;annual:string|null;period:string|null;start:string|null;end:string|null} {
 const missing=(reason:string)=>({state:'unknown',reason,annual:null,period:null,start:null,end:null});
 if(!complete)return missing('尚未明确声明此范围的估值与资金流记录完整');
 if(history.length<2)return missing('至少需要两个不同日期的真实估值观察');
 const sorted=[...history].sort((a,b)=>text(a.d).localeCompare(text(b.d)));
 if(sorted.some(r=>!day(text(r.d))||decimal(r.v)===null||decimal(r.inn)===null||decimal(r.out)===null))return missing('观察日期、估值或资金流不完整，未补零');
 if(!day(asOf)||sorted.some(r=>text(r.d)>asOf))return missing('存在未来登记或截止日期无效，不能把规划值当成已发生收益');
 const dates=sorted.map(r=>text(r.d));if(new Set(dates).size!==dates.length)return missing('同日多次观察未明确收盘估值与资金流顺序，不能合成收益');
 const start=dates[0],end=dates.at(-1)!,elapsed=(Date.parse(end)-Date.parse(start))/86400000;if(elapsed<=0)return missing('观察期间无有效跨度');
 if(decimal(sorted[0].inn)!=='0'||decimal(sorted[0].out)!=='0')return missing('期初观察含当日资金流，尚未明确期初估值与流入流出的先后');
 const opening=Number(decimal(sorted[0].v)),closing=Number(decimal(sorted.at(-1)!.v));if(!(opening>0)||!Number.isFinite(opening)||!Number.isFinite(closing)||closing<0)return missing('期初估值或期末估值不能支持收益计算');
 const flows=[{time:0,value:-opening}];for(const row of sorted.slice(1)){const incoming=Number(decimal(row.inn)),outgoing=Number(decimal(row.out));if(!Number.isFinite(incoming)||!Number.isFinite(outgoing)||incoming<0||outgoing<0)return missing('资金流必须是已知非负值');const value=outgoing-incoming;if(value)flows.push({time:(Date.parse(text(row.d))-Date.parse(start))/86400000/365,value});}flows.push({time:elapsed/365,value:closing});
 if(!flows.some(f=>f.value>0)||!flows.some(f=>f.value<0))return missing('资金流无可解收益符号');
 const f=(rate:number)=>flows.reduce((total,flow)=>total+flow.value/Math.pow(1+rate,flow.time),0);
 // Multiple sign changes can yield multiple IRRs: do not select an arbitrary root.
 let changes=0,last=0;for(const flow of flows){const sign=Math.sign(flow.value);if(sign&&last&&sign!==last)changes++;if(sign)last=sign;}if(changes>1)return missing('资金流存在多个符号变化，资金加权收益可能多解');
 let low=-0.999999,high=1;while(Math.sign(f(low))===Math.sign(f(high))&&high<1e8)high=high*2+1;if(!Number.isFinite(f(low))||Math.sign(f(low))===Math.sign(f(high)))return missing('未找到有界唯一收益解');
 for(let i=0;i<120;i++){const mid=(low+high)/2;if(Math.sign(f(mid))===Math.sign(f(low)))low=mid;else high=mid;}
 const rate=(low+high)/2,period=Math.pow(1+rate,elapsed/365)-1;if(!Number.isFinite(rate)||!Number.isFinite(period))return missing('结果不在可显示数值范围');
 return {state:'owner_declared_complete',reason:'基于明确完整登记的期初/期末估值与中间资金流；近似XIRR，不代表券商已核收益',annual:(rate*100).toFixed(6),period:(period*100).toFixed(6),start,end};
}
export function revisionToken(value:Value|undefined):string|null {const token=text(value);if(!/^(0|[1-9]\d*)$/.test(token)||token.length>16)return null;return BigInt(token)<=BigInt(Number.MAX_SAFE_INTEGER)?token:null;}
