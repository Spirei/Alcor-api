export type HistoryQuery = {
  kind: "bars" | "price_series";
  market: string;
  code: string;
  frame: "minute" | "day" | "week" | "month" | "quarter" | "year";
  adjust: string;
  session: "REGULAR" | "ALL";
  instrument: "equity" | "index" | "asset";
  start: string;
  through: string;
};
export type Demand = {
  streamId: string;
  sourceRevision: string;
  revision: number;
  query: HistoryQuery;
  origin: string;
  active: boolean;
  cancellable: boolean;
  expiresAt: string | null;
};
export const marketQueryKey = (value: object) =>
  JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
export function historyRevision(
  items: Demand[],
  source: string,
  query: HistoryQuery,
) {
  return (
    items.find(
      (item) =>
        item.cancellable &&
        item.sourceRevision === source &&
        marketQueryKey(item.query) === marketQueryKey(query),
    )?.revision ?? 0
  );
}
export const marketPendingKey = (scope: string) =>
  "alcor.market.pending:" + scope;
export const validMarketOperation = (id: string) =>
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id);

export function historyCode(raw: string) {
  const value = raw.trim();
  return /^[A-Za-z0-9._-]{1,40}$/.test(value) ? value.toUpperCase() : null;
}

export type HistoryFact = {
  factId: string;
  at: string;
  revision?: number;
  o?: string;
  h?: string;
  l?: string;
  c?: string;
  v?: string;
  corporateAdjustment?: string;
  adjustmentMethod?: string;
  adjustmentFactor?: string;
  sourceClose?: string;
  sourceAdjustedClose?: string;
  volumeBasis?: string;
};
export type ChartBar = { fact: HistoryFact; timestamp: number; open: number; high: number; low: number; close: number; volume: number | null; gapBefore: boolean };
/** Numeric projections are display coordinates only; original exact text stays in each fact. */
export function chartBars(facts: HistoryFact[], now = Date.now()) {
  const bars: ChartBar[] = [];
  let excluded = 0;
  let gapBefore = false;
  for (const fact of facts) {
    const timestamp = Date.parse(fact.at);
    const values = [fact.o, fact.h, fact.l, fact.c];
    const numbers = values.map(value => typeof value !== "string" || value.trim() === "" ? NaN : Number(value));
    const [open, high, low, close] = numbers;
    if (!Number.isFinite(timestamp) || timestamp > now + 5000 || numbers.some(value => !Number.isFinite(value) || value <= 0) || high < Math.max(open, close, low) || low > Math.min(open, close, high)) { excluded++; gapBefore=true; continue; }
    const volume = typeof fact.v !== "string" || fact.v.trim() === "" ? NaN : Number(fact.v);
    bars.push({ fact, timestamp, open, high, low, close, volume: Number.isFinite(volume) && volume >= 0 ? volume : null, gapBefore });
    gapBefore=false;
  }
  bars.sort((a,b) => a.timestamp-b.timestamp);
  // Duplicates cannot be interpreted as extra observations or averaged into a synthetic bar.
  const seen = new Set<number>();
  return { bars: bars.filter(bar => { if (seen.has(bar.timestamp)) { excluded++; return false; } seen.add(bar.timestamp); return true; }), get excluded() { return excluded; } };
}
export function observedWindow<T>(items: T[], count: number, end: number) {
  const right = Math.max(0, Math.min(items.length, Math.floor(end)));
  const size = Math.max(1, Math.floor(count));
  return { items: items.slice(Math.max(0,right-size),right), start: Math.max(0,right-size), end: right };
}

export type IndicatorPoint = {
  windowId?: string;
  factId: string;
  at: string;
  ma: Record<string,string|null>;
  ema20: string | null;
  boll20: { mid: string|null; upper:string|null; lower:string|null };
  macd: { dif:string|null; dea:string|null; hist:string|null };
  rsi14: string | null;
  volume: string | null;
  amount: string | null;
};
export type HistoryIndicators = { version:number; basis:string; points:IndicatorPoint[]; windowScope?:string };

export type PriceSeriesFact = {factId:string;at:string;revision?:number;price?:string;avgPrice?:string|null;prevClose?:string|null;volume?:string|null;amount?:string|null;dataKind?:string};
export function priceSeriesPoints(facts:PriceSeriesFact[],now=Date.now()) {
  let excluded=0,gapBefore=false;
  const points:{fact:PriceSeriesFact;timestamp:number;price:number;avgPrice:number|null;volume:number|null;gapBefore:boolean}[]=[];
  const value=(raw:string|null|undefined,zero=false)=>typeof raw==='string'&&raw.trim()!==''&&Number.isFinite(Number(raw))&&(zero?Number(raw)>=0:Number(raw)>0)?Number(raw):null;
  for(const fact of facts){const stamp=Date.parse(fact.at),price=value(fact.price);if(!Number.isFinite(stamp)||stamp>now+5000||price===null||fact.dataKind!=='provider_real_time_time_frame'){excluded++;gapBefore=true;continue;}points.push({fact,timestamp:stamp,price,avgPrice:value(fact.avgPrice),volume:value(fact.volume,true),gapBefore});gapBefore=false;}
  return {points,excluded};
}
