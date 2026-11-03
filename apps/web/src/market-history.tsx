import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { Dialog } from "./dialog";
import { ReportLifetime, reportScope } from "./financial-report-lifetime";
import {
  historyRevision,
  historyCode,
  marketPendingKey,
  marketQueryKey,
  validMarketOperation,
  type Demand,
  type HistoryQuery,
  type HistoryIndicators,
} from "./market-history-model";
import { requestId } from "./request-id";
import { PriceAlertsPanel } from "./price-alerts";
import { MarketQuotesPanel } from "./market-quotes";
import { MarketReferencePanel } from "./market-reference";
import { MarketPriceSeriesChart, PriceSeriesFactTable } from "./market-price-series-chart";
import { MarketHistoryChart, MarketHistoryFactTable } from "./market-history-chart";
import { SelectMenu } from "./select-menu";

type Policy = {
  id: string;
  source: string;
  sourceVersion: string;
  licenseRevision: string;
  purposes: string[];
  markets: string[];
  historyFrames: string[];
  historyAdjustments?: string[];
  historyKinds?: ("bars" | "price_series")[];
  priceSeriesSessions?: string[];
  historyInstruments?: ("equity" | "index" | "asset")[];
  historySymbols?: {market:string;instrument:string;code:string;name?:string}[];
  historyMinuteSessions?: string[];
  historyMarkets: string[];
};
type Version = {
  revision: string;
  policyId: string;
  usable: boolean;
  revoked: boolean;
  policy: Policy | null;
};
type Sources = { policies: Policy[]; versions: Version[] };
type Receipt = {
  requestId: string;
  revision?: number | string;
  streamId?: string;
  revoked?: boolean;
  collection?: string;
  kind?: string;
  sourceRevision?: string;
  observedAt?: string;
  state?: string;
  message?: string;
  quota?: { subscription: { totalUsed: number | null; remain: number | null; ownUsed: number | null } | null; historyKl: { used: number | null; remain: number | null } | null } | null;
};
type Facts = {
  state: string;
  sourceRevision: string;
  revision: string;
  licenseRevision: string;
  indicators?: HistoryIndicators;
  timezone: string;
  facts: { factId: string; pageId: string; revision: number; at: string; price?: string; avgPrice?: string | null; prevClose?: string | null; volume?: string | null; amount?: string | null; dataKind?: string; corporateAdjustment?: string; adjustmentMethod?: string; adjustmentFactor?: string; sourceClose?: string; sourceAdjustedClose?: string; volumeBasis?: string; o?: string; h?: string; l?: string; c?: string; v?: string }[];
  coverage: { assurance: string; fullBusinessHistoryVerified: false; partial?: boolean; calendarCompletenessVerified?: boolean; corporateActionContinuityVerified?: boolean };
  availableRange: { from: string | null; through: string | null; observedLocalDates: string[] };
  pagination: { before: string | null; hasMore: boolean };
};
const periodLabels: Record<string, string> = {
  minute: "分钟K",
  day: "日K",
  week: "周K",
  month: "月K",
  quarter: "季K",
  year: "年K",
};
const initial = {
  source: "",
  market: "",
  code: "",
  frame: "",
  adjust: "",
  session: "",
  start: "",
  through: "",
  mode: "bars",
  instrument: "",
  kind: "",
};
export function MarketHistoryPage({
  session,
  active = true,
}: {
  session: Session;
  active?: boolean;
}) {
  const scope = reportScope(session);
  return (
    <HistorySession
      key={JSON.stringify([scope, session.csrf, session.expires_at])}
      session={session}
      active={active}
      scope={scope}
    />
  );
}
function HistorySession({
  session,
  active,
  scope,
}: {
  session: Session;
  active: boolean;
  scope: string;
}) {
  const [visible, setVisible] = useState(
    typeof document === "undefined" || !document.hidden,
  );
  const [locked, setLocked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [sources, setSources] = useState<Sources | null>(null),
    [demands, setDemands] = useState<Demand[]>([]);
  const [diagnosticSource, setDiagnosticSource] = useState("");
  const [policy, setPolicy] = useState(""),
    [draft, setDraft] = useState(initial);
  const [pending, setPending] = useState<string | null>(null),
    [receipt, setReceipt] = useState<Receipt | null>(null);
  const [facts, setFacts] = useState<Facts | null>(null),
    [confirm, setConfirm] = useState<
      | { kind: "source"; version: string }
      | { kind: "demand"; demand: Demand }
      | null
    >(null);
  const key = marketPendingKey(scope),
    working = useRef(false),
    reads = useRef(0),
    factReads = useRef(0),
    generation = useRef(0);
  const [lifetime] = useState(
    () =>
      new ReportLifetime(
        () => apiSessionSnapshot().csrf === session.csrf,
        () => typeof document !== "undefined" && !document.hidden,
      ),
  );
  const pause = useCallback(() => {
    lifetime.pause();
    ++reads.current;
    ++factReads.current;
    ++generation.current;
    working.current = false;
    setBusy(false);
  }, [lifetime]);
  const retire = useCallback(() => {
    pause();
    setLocked(true);
    setSources(null);
    setDemands([]);
    setDraft(initial);
    setPolicy("");
    setDiagnosticSource("");
    setFacts(null);
    setReceipt(null);
    setPending(null);
    setConfirm(null);
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* Contents already withdrawn. */
    }
  }, [pause, key]);
  function failure(reason: unknown) {
    setError(reason instanceof Error ? reason.message : "行情操作失败");
    if (
      apiSessionSnapshot().csrf !== session.csrf ||
      (reason instanceof ApiError &&
        ([401, 403].includes(reason.status) ||
          reason.code === "session_changed"))
    )
      retire();
  }
  useLayoutEffect(() => {
    lifetime.resume(active && visible && !locked);
    return pause;
  }, [active, visible, locked, lifetime, pause]);
  useEffect(() => {
    try {
      const id = sessionStorage.getItem(key);
      if (id && !validMarketOperation(id)) throw Error("原操作编号无效");
      setPending(id);
    } catch {
      setError("原操作编号无法读取");
      setLocked(true);
    }
    const visibility = () => {
      if (document.hidden) pause();
      setVisible(!document.hidden);
    };
    const changed = () => {
      retire();
      setError("登录身份已变化，请重新核对");
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("alcor:session-changed", changed);
    window.addEventListener("alcor:session-expired", changed);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("alcor:session-changed", changed);
      window.removeEventListener("alcor:session-expired", changed);
    };
  }, [key, pause, retire]);
  async function load() {
    const ticket = lifetime.begin();
    if (!ticket) return;
    const serial = ++reads.current;
    try {
      const [value, listing] = await Promise.all([
        api<Sources>("/market/sources", { signal: ticket.signal }),
        api<{ items: Demand[] }>("/market/demands?include_inactive=1", {
          signal: ticket.signal,
        }),
      ]);
      if (ticket.current() && serial === reads.current) {
        setSources(value);
        setDemands(listing.items);
      }
    } catch (reason) {
      if (apiSessionSnapshot().csrf !== session.csrf) retire();
      else if (ticket.current()) {
        setSources(null);
        setDemands([]);
        failure(reason);
      }
    } finally {
      ticket.finish();
    }
  }
  useEffect(() => {
    if (active && visible && !locked) void load();
  }, [active, visible, locked]);
  const selected = sources?.versions.find(
    (value) => value.revision === draft.source && value.usable,
  );
  const selectedPolicy = selected?.policy;
  const allowedAdjustments = draft.kind === "price_series" || draft.instrument !== "equity" ? ["none"] : selectedPolicy?.historyAdjustments ?? (selectedPolicy?.source === "yahoo" ? ["none"] : ["none","qfq","hfq"]);
  const adjustmentLabel = (value: string) => selectedPolicy?.source === "yahoo" && draft.instrument === "equity" ? ({none:"来源原报OHLC",qfq:"来源调整收盘比率"} as Record<string,string>)[value] || value : ({none:"不复权",qfq:"前复权",hfq:"后复权"} as Record<string,string>)[value] || value;
  const canRegisterPolicy = (value: Policy) => value.purposes.includes("latest") || value.purposes.some(purpose=>purpose.startsWith("discovery.") || ["company-profile","financials","earnings.calendar"].includes(purpose)) || value.historyFrames.length > 0 || (value.priceSeriesSessions?.length ?? 0) > 0 ||
    (session.user.role === "admin" && value.source === "futu" && value.sourceVersion === "futu-sdk-records-v1" && value.purposes.some(purpose => ["futu.test", "futu.quota"].includes(purpose)));

  function edit(value: Partial<typeof draft>) {
    ++generation.current;
    setDraft((old) => ({ ...old, ...value }));
    setFacts(null);
  }
  function query(requireWindow = true): HistoryQuery | null {
    const code = historyCode(draft.code);
    if (
      !selectedPolicy ||
      !(selectedPolicy.historyKinds ?? [...(selectedPolicy.historyFrames.length ? ["bars"] : []),...((selectedPolicy.priceSeriesSessions?.length ?? 0) ? ["price_series"] : [])]).includes(draft.kind) ||
      (draft.kind === "price_series" ? draft.frame !== "minute" || draft.adjust !== "none" || draft.instrument !== "equity" : !selectedPolicy.historyFrames.includes(draft.frame)) ||
      !selectedPolicy.historyMarkets.includes(draft.market) ||
      !(selectedPolicy.historyInstruments ?? ["equity"]).includes(draft.instrument as HistoryQuery["instrument"]) ||
      (draft.instrument !== "equity" && (draft.frame !== "day" || draft.adjust !== "none")) ||
      !allowedAdjustments.includes(draft.adjust) ||
      !code ||
      (draft.frame === "minute" && (!(draft.kind === "price_series" ? selectedPolicy.priceSeriesSessions : selectedPolicy.historyMinuteSessions)?.includes(draft.session) ||
        !["REGULAR", "ALL"].includes(draft.session) || (draft.session === "ALL" && draft.market !== "US"))) ||
      (requireWindow && (!draft.start || !draft.through)) ||
      (draft.start && draft.through && draft.start > draft.through)
    )
      return null;
    return {
      kind: draft.kind as HistoryQuery["kind"],
      market: draft.market,
      code,
      frame: draft.frame as HistoryQuery["frame"],
      adjust: draft.adjust,
      session: draft.frame === "minute" ? draft.session as "REGULAR" | "ALL" : "REGULAR",
      instrument: draft.instrument as HistoryQuery["instrument"],
      start: draft.start,
      through: draft.through,
    };
  }
  function clearPending() {
    try {
      sessionStorage.removeItem(key);
      setPending(null);
      return true;
    } catch {
      setError("原操作状态无法保存，请继续核对原编号");
      return false;
    }
  }
  async function mutate(
    path: string,
    method: string,
    payload: object,
    recover = false,
  ) {
    if (working.current || locked || (!recover && pending)) return;
    const ticket = lifetime.begin();
    if (!ticket) return;
    let id = pending;
    if (!recover) {
      id = requestId();
      try {
        sessionStorage.setItem(key, id);
        setPending(id);
      } catch {
        setError("原操作编号无法保存");
        ticket.finish();
        return;
      }
    }
    if (!id) {
      ticket.finish();
      return;
    }
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await api<Receipt>(
        recover ? `/market/operations/${id}` : path,
        {
          method: recover ? "GET" : method,
          ...(!recover
            ? { body: JSON.stringify({ ...payload, ...(path.startsWith("/futu/") ? { requestId: id } : { request_id: id }) }) }
            : {}),
          signal: ticket.signal,
        },
        recover ? undefined : session.csrf,
      );
      if (!ticket.current()) return;
      if (value.requestId !== id) throw Error("原操作回执不匹配");
      if (!clearPending()) return;
      setReceipt(value);
      setConfirm(null);
      void load();
    } catch (reason) {
      if (apiSessionSnapshot().csrf !== session.csrf) retire();
      else if (ticket.current()) {
        // A received rejection is known; timeouts/5xx/aborts retain the original UUID.
        if (
          !recover &&
          reason instanceof ApiError &&
          [400, 404, 409, 422, 429].includes(reason.status) &&
          reason.code !== "session_changed"
        ) {
          if (!clearPending()) return;
        }
        failure(reason);
      }
    } finally {
      ticket.finish();
      if (ticket.current()) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  async function readFacts(older = false) {
    if (older && (!facts?.pagination.before || !facts.pagination.hasMore || facts.facts.length >= 24000)) return;
    const value = query(false),
      ticket = lifetime.begin();
    if (!value || !ticket) return;
    const serial = ++factReads.current,
      draftGeneration = generation.current;
    setError("");
    if (!older) setFacts(null);
    const params = new URLSearchParams({source_revision: draft.source,kind: value.kind,market: value.market,code: value.code,frame: value.frame,adjust: value.adjust,session: value.session,instrument: value.instrument,mode: value.frame === "minute" ? draft.mode : "bars",limit: "3000"});
    if (value.start) params.set("start",value.start);
    if (value.through) params.set("through",value.through);
    if (older && facts) { params.set("before",facts.pagination.before!); params.set("expected_revision",facts.revision); }
    try {
      const result = await api<Facts>("/market/history?" + params.toString(), {
        signal: ticket.signal,
      });
      if (
        ticket.current() &&
        serial === factReads.current &&
        draftGeneration === generation.current
      )
        setFacts(previous => {
          const scoped = result.indicators ? {...result.indicators,windowScope:"returned_page_only",points:result.indicators.points.map(point=>({...point,windowId:params.get("before") || "latest"}))} : undefined;
          if (!older || !previous) return {...result,indicators:scoped};
          const ids = new Set(result.facts.map(row=>row.factId));
          return { ...result, facts: [...result.facts,...previous.facts.filter(row=>!ids.has(row.factId))], indicators: scoped ? {...scoped,points:[...scoped.points,...(previous.indicators?.points.filter(point=>!ids.has(point.factId)) || [])]} : previous.indicators };
        });
    } catch (reason) {
      if (apiSessionSnapshot().csrf !== session.csrf) retire();
      else if (ticket.current()) failure(reason);
    } finally {
      ticket.finish();
    }
  }
  async function downloadPage(pageId: string) {
    if (!facts || !validMarketOperation(pageId)) return;
    const ticket = lifetime.begin(), draftGeneration = generation.current;
    if (!ticket) return;
    setError("");
    try {
      const params = new URLSearchParams({source_revision: facts.sourceRevision});
      const response = await fetch(`/api/market/history/originals/${pageId}?${params}`,{credentials:"same-origin",headers:{"X-CSRF-Token":session.csrf},signal:ticket.signal});
      if (!response.ok) throw new ApiError(response.status,"来源原件暂时无法读取");
      const blob = await response.blob();
      if (ticket.current() && draftGeneration === generation.current) {
        const url = URL.createObjectURL(blob), anchor = document.createElement("a");
        anchor.href=url; anchor.download=`history-page-${pageId}.bin`; anchor.click();
        window.setTimeout(()=>URL.revokeObjectURL(url),0);
      }
    } catch (reason) { if (ticket.current()) failure(reason); }
    finally { ticket.finish(); }
  }
  const currentQuery = query(false);
  const demandQuery = query();
  const existing = currentQuery
    ? demands.find(
        (value) =>
          value.sourceRevision === draft.source &&
          marketQueryKey(value.query) === marketQueryKey(currentQuery),
      )
    : null;
  if (!active || !visible) return <section aria-hidden="true" />;
  if (locked)
    return (
      <section>
        <h1>行情</h1>
        <p role="alert">{error || "登录状态已变化，请重新核对"}</p>
      </section>
    );
  return (
    <section className="page-section">
      <div className="section-heading">
        <h1>行情</h1>
        <button disabled={busy} onClick={() => void load()}>
          刷新
        </button>
      </div>
      <PriceAlertsPanel session={session} active={active && visible && !locked}/>
      <MarketQuotesPanel session={session} active={active && visible && !locked}/>
      <MarketReferencePanel session={session} active={active && visible && !locked}/>
      {error && <p role="alert">{error}</p>}
      {pending && (
        <div className="panel">
          <p>操作结果待核对</p>
          <code>{pending}</code>
          <button
            disabled={busy}
            onClick={() => void mutate("", "GET", {}, true)}
          >
            核对原操作
          </button>
        </div>
      )}
      {receipt && (
        <p role="status">
          操作已登记 <code>{receipt.requestId}</code>
        </p>
      )}
      {session.user.role === "admin" && (
        <div className="panel">
          <h2>行情来源检查</h2>
          <p>仅检查本人已登记且许可有效的固定来源。连接状态不代表报价权限或历史数据完整。</p>
          <SelectMenu label="检查来源" value={diagnosticSource} onChange={setDiagnosticSource}
            disabled={busy || !!pending}
            options={[{value: "", label: "选择已登记来源"}, ...(sources?.versions.filter(version => version.usable && version.policy?.source === "futu").map(version => ({value: version.revision, label: `${version.policy?.id} · ${version.revision}`})) ?? [])]} />
          {([['futu.test', '检查连接'], ['futu.quota', '查询额度']] as const).map(([purpose, label]) => (
            <button key={purpose} disabled={busy || !!pending || !sources?.versions.some(version => version.revision === diagnosticSource && version.usable && version.policy?.purposes.includes(purpose))}
              onClick={() => void mutate(`/futu/${purpose.split('.')[1]}`, "POST", {sourceRevision: diagnosticSource})}>{label}</button>
          ))}
          <button disabled={busy || !!pending || !sources?.versions.some(version => version.revision === diagnosticSource && version.usable)} onClick={() => setConfirm({kind: "source", version: diagnosticSource})}>停用检查来源</button>
          <p className="muted">需分别具备连接检查或额度查询许可；结果未知时只核对原操作，不重复发送。</p>
          {receipt?.kind?.startsWith("futu.") && <div role="status">
            <p>检查来源：<code>{receipt.sourceRevision}</code> · {receipt.observedAt}</p>
            <p>{receipt.message || (receipt.state === "observed" ? "已读取当前连接额度" : receipt.state === "partial" ? "仅取得部分额度" : "检查结果未知或不可用")}</p>
            {receipt.kind === "futu.quota" && <dl>
              <div><dt>订阅已用 / 剩余</dt><dd>{receipt.quota?.subscription?.totalUsed ?? "未知"} / {receipt.quota?.subscription?.remain ?? "未知"}</dd></div>
              <div><dt>当前连接已用</dt><dd>{receipt.quota?.subscription?.ownUsed ?? "未知"}</dd></div>
              <div><dt>历史额度已用 / 剩余</dt><dd>{receipt.quota?.historyKl?.used ?? "未知"} / {receipt.quota?.historyKl?.remain ?? "未知"}</dd></div>
            </dl>}
          </div>}
        </div>
      )}
      <div className="panel">
        <div className="form-grid">
          <SelectMenu
            label="来源许可"
            value={policy}
            options={[
              { value: "", label: "选择已许可来源" },
              ...(sources?.policies
                .filter(canRegisterPolicy)
                .map((value) => ({
                  value: value.id,
                  label: `${value.source} · ${value.id}`,
                })) ?? []),
            ]}
            onChange={setPolicy}
            disabled={busy}
          />
          <button
            disabled={
              !policy ||
              busy ||
              !!pending ||
              !sources?.policies.some(
                (value) => value.id === policy && canRegisterPolicy(value),
              )
            }
            onClick={() =>
              void mutate("/market/sources", "POST", { policy_id: policy })
            }
          >
            登记来源
          </button>
        </div>
        {sources &&
          !sources.policies.some(canRegisterPolicy) && (
            <p>尚无可登记的行情来源许可</p>
          )}
      </div>
      <form
        className="panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (demandQuery)
            void mutate("/market/demands", "POST", {
              source_revision: draft.source,
              query: demandQuery,
              expected_revision: historyRevision(
                demands,
                draft.source,
                demandQuery,
              ),
            });
        }}
      >
        <div className="form-grid">
          <SelectMenu
            label="已登记来源"
            value={draft.source}
            options={[
              { value: "", label: "选择来源" },
              ...(sources?.versions
                .filter(
                  (value) => value.usable && (value.policy?.historyFrames.length || value.policy?.priceSeriesSessions?.length),
                )
                .map((value) => ({
                  value: value.revision,
                  label: `${value.policy?.source} · ${value.revision.slice(0, 8)}`,
                })) ?? []),
            ]}
            onChange={(source) =>
              edit({ source, frame: "", market: "", adjust: "", session: "", instrument: "",kind:"" })
            }
            disabled={busy}
          />
          <SelectMenu label="数据类型" value={draft.kind} disabled={busy} options={[{value:"",label:"选择数据类型"},...(selectedPolicy?.historyKinds ?? (selectedPolicy ? [...(selectedPolicy.historyFrames.length?["bars"]:[]),...((selectedPolicy.priceSeriesSessions?.length??0)?["price_series"]:[])] : [])).map(value=>({value,label:value==="price_series"?"真实分时价格 / 来源均价":"OHLC历史K线 / 分钟收盘"}))]} onChange={kind=>edit({kind,frame:kind==="price_series"?"minute":"",adjust:kind==="price_series"?"none":"",instrument:"",session:"",mode:kind==="price_series"?"all-day":"bars"})}/>
          <SelectMenu label="资产类型" value={draft.instrument} disabled={busy} options={[{value:"",label:"选择资产类型"},...(draft.kind === "price_series" ? (selectedPolicy?.priceSeriesSessions?.length ? ["equity"] : []) : selectedPolicy?.historyInstruments ?? (selectedPolicy ? ["equity"] : [])).map(value=>({value,label:({equity:"股票 / 股票ETF",index:"真实指数",asset:"加密资产"} as Record<string,string>)[value] || value}))]} onChange={instrument=>edit({instrument,frame:"",market:"",code:"",adjust:"",session:""})}/>
          <SelectMenu
            label="周期"
            value={draft.frame}
            options={[
              { value: "", label: "选择周期" },
              ...((draft.kind === "price_series" ? ["minute"] : selectedPolicy?.historyFrames)?.filter(value=>!draft.instrument || draft.instrument==="equity" || value==="day").map((value) => ({
                value,
                label: draft.kind === "price_series" && value === "minute" ? "真实分时观察" : periodLabels[value] ?? value,
              })) ?? []),
            ]}
            onChange={(frame) => edit({ frame, session: "" })}
            disabled={busy}
          />
          <SelectMenu
            label="市场"
            value={draft.market}
            options={[
              { value: "", label: "选择市场" },
              ...(selectedPolicy?.historyMarkets.map((value) => ({
                value,
                label: value,
              })) ?? []),
            ]}
            onChange={(market) => edit({ market, code: "" })}
            disabled={busy}
          />
          {draft.frame === "minute" && <SelectMenu label="观察范围" value={draft.mode} options={[{value:"bars",label:draft.kind === "price_series" ? "指定范围分时" : "指定范围分钟K"},{value:"all-day",label:"最近真实交易日"},{value:"five-day",label:"最近5个有来源记录的交易日"}]} onChange={mode=>edit({mode})} disabled={busy}/>}
          {draft.frame === "minute" && <SelectMenu label="交易时段" value={draft.session}
            options={[{value: "", label: "选择交易时段"}, ...((draft.kind === "price_series" ? selectedPolicy?.priceSeriesSessions : selectedPolicy?.historyMinuteSessions)?.filter(value => value === "REGULAR" || value === "ALL" && draft.market === "US").map(value => ({value, label: value === "ALL" ? "全天（美股，含扩展时段）" : "常规交易时段"})) ?? [])]}
            onChange={session => edit({session})} disabled={busy} />}
          {!!selectedPolicy?.historySymbols?.filter(value=>value.instrument===draft.instrument && value.market===draft.market).length && <SelectMenu label="许可标的" value={draft.code} options={[{value:"",label:"选择许可标的"},...selectedPolicy.historySymbols.filter(value=>value.instrument===draft.instrument&&value.market===draft.market).map(value=>({value:value.code,label:value.name?`${value.name} · ${value.code}`:value.code}))]} onChange={code=>edit({code})} disabled={busy}/>}
          <label>
            代码
            <input
              value={draft.code}
              placeholder="AAPL / 00700"
              maxLength={40}
              disabled={busy}
              onChange={(event) => edit({ code: event.target.value })}
            />
          </label>
          <SelectMenu
            label="复权"
            value={draft.adjust}
            options={[
              { value: "", label: "选择口径" },
              ...allowedAdjustments.map(value=>({value,label:adjustmentLabel(value)})),
            ]}
            onChange={(adjust) => edit({ adjust })}
            disabled={busy}
          />
          <label>
            开始日期
            <input
              type="date"
              value={draft.start}
              disabled={busy}
              onChange={(event) => edit({ start: event.target.value })}
            />
          </label>
          <label>
            结束日期
            <input
              type="date"
              value={draft.through}
              min={draft.start || undefined}
              disabled={busy}
              onChange={(event) => edit({ through: event.target.value })}
            />
          </label>
        </div>
        <div className="inline-actions">
          <button
            type="submit"
            disabled={!demandQuery || busy || !!pending || !sources}
          >
            登记采集需求
          </button>
          <button
            type="button"
            disabled={!currentQuery || busy}
            onClick={() => void readFacts()}
          >
            读取已采集
          </button>
          {existing?.active && existing.cancellable && (
            <button
              type="button"
              disabled={busy || !!pending}
              onClick={() => setConfirm({ kind: "demand", demand: existing })}
            >
              停止需求
            </button>
          )}
        </div>
        {selectedPolicy && (
          <details>
            <summary>来源许可</summary>
            <p>
              {selectedPolicy.id} · {selectedPolicy.licenseRevision}
            </p>
            <p>
              {selectedPolicy.purposes.join("、")} ·{" "}
              {selectedPolicy.markets.join("、")}
            </p>
            <button
              type="button"
              disabled={busy || !!pending}
              onClick={() =>
                setConfirm({ kind: "source", version: draft.source })
              }
            >
              停用来源
            </button>
          </details>
        )}
      </form>
      {!!demands.filter((value) => value.query.kind === "bars").length && (
        <div className="panel">
          <h2>采集需求</h2>
          {demands
            .filter((value) => value.query.kind === "bars")
            .map((value) => (
              <div className="list-row" key={value.streamId}>
                <span>
                  {value.query.market} {value.query.code} ·{" "}
                  {{equity:"股票",index:"真实指数",asset:"加密资产"}[value.query.instrument]} · {value.query.kind === "price_series" ? "真实分时观察" : periodLabels[value.query.frame] ?? value.query.frame} ·{" "}
                  {value.query.start} — {value.query.through} ·{" "}
                  {value.active ? "已登记" : "已停止或过期"}
                </span>
                <button
                  disabled={busy}
                  onClick={() =>
                    edit({
                      source: value.sourceRevision,
                      market: value.query.market,
                      code: value.query.code,
                      instrument: value.query.instrument,
                      kind: value.query.kind,
                      frame: value.query.frame,
                      adjust: value.query.adjust,
                      start: value.query.start,
                      through: value.query.through,
                    })
                  }
                >
                  查看
                </button>
              </div>
            ))}
        </div>
      )}
      {facts && selected && currentQuery && (
        <div className="panel">
          <p>
            {facts.facts.length
              ? `${facts.facts.length} 条来源记录`
              : facts.state === "retained_unavailable" ? "原来源记录已保留，当前许可不可读取" : "尚无已采集记录"}
            {facts.pagination.hasMore ? " · 尚有更早来源记录" : ""} ·{" "}
            {facts.coverage.partial ? "部分观察覆盖" : facts.coverage.assurance.includes("terminal_pages")
              ? "来源分页已结束"
              : "覆盖范围未知"}
            {facts.coverage.assurance.includes("partial_records")
              ? " · 部分来源记录未通过核对"
              : ""}
          </p>
          {facts.coverage.calendarCompletenessVerified === false && <p role="status">交易日历完整性未核实{facts.coverage.corporateActionContinuityVerified === false ? " · 公司行动连续性未核实" : ""}</p>}
          <p>来源时区 {facts.timezone} · {facts.availableRange.from ?? "未知"} — {facts.availableRange.through ?? "未知"}</p>
          {facts.pagination.hasMore && <button disabled={busy || facts.facts.length >= 24000} onClick={()=>void readFacts(true)}>读取更早来源记录</button>}
          {facts.facts.length >= 24000 && <p role="status">已达本页24000条显示上限，请缩小日期范围</p>}
          {!!facts.facts.length && currentQuery.kind === "bars" && <MarketHistoryChart facts={facts.facts} frame={currentQuery.frame} instrument={currentQuery.instrument} market={currentQuery.market} code={currentQuery.code} adjust={adjustmentLabel(currentQuery.adjust)} session={currentQuery.session} sourceRevision={facts.sourceRevision} coverage={facts.coverage.assurance} indicators={facts.indicators}/>}
          {!!facts.facts.length && currentQuery.kind === "price_series" && <MarketPriceSeriesChart facts={facts.facts} market={currentQuery.market} code={currentQuery.code} session={currentQuery.session} sourceRevision={facts.sourceRevision} coverage={facts.coverage.assurance} indicators={facts.indicators}/>}
          {!!facts.facts.length && <details><summary>来源原件</summary>{[...new Set(facts.facts.map(row=>row.pageId))].map(id=><button key={id} onClick={()=>void downloadPage(id)}>下载原页 {id}</button>)}</details>}
          {!!facts.facts.length && currentQuery.kind === "price_series" && <PriceSeriesFactTable key={facts.revision+":"+facts.facts.length} facts={facts.facts}/>}
          {!!facts.facts.length && currentQuery.kind === "bars" && <MarketHistoryFactTable key={facts.revision+":"+facts.facts.length} facts={facts.facts}/>}
        </div>
      )}
      {confirm && (
        <Dialog
          title={confirm.kind === "source" ? "停用行情来源" : "停止采集需求"}
          onClose={() => setConfirm(null)}
        >
          <p>停止后续采集，保留已采集历史。</p>
          <button
            disabled={busy || !!pending}
            onClick={() => {
              if (confirm.kind === "source")
                void mutate(`/market/sources/${confirm.version}`, "DELETE", {});
              else
                void mutate("/market/demands", "DELETE", {
                  source_revision: confirm.demand.sourceRevision,
                  query: confirm.demand.query,
                  expected_revision: confirm.demand.revision,
                });
            }}
          >
            确认停止
          </button>
        </Dialog>
      )}
    </section>
  );
}
