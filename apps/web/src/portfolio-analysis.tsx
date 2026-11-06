import { LoadingPlaceholder } from "./loading-placeholder";
import {
  PrivateAmount,
  MarketBadge,
  useFinancialDisplay,
} from "./financial-display";
import { Settings2, RefreshCw } from "lucide-react";
import { Dialog } from "./dialog";
import { SelectMenu } from "./select-menu";
import { WorkspaceTabs, WorkspaceEmpty, WorkspaceView } from "./workspace-ui";
import { brokerAccountLabels } from "./broker-account-state";
import {
  analysisToday,
  analysisRange,
  observedPricePlot,
  type AnalysisPeriod,
} from "./portfolio-analysis-state";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import "./portfolio-analysis.css";
type Money = string | null;
type Position = {
  recordId: string;
  brokerAccountId: string;
  market: string;
  code: string;
  name: string;
  currency: string;
  quantity: Money;
  price: Money;
  priceSource: string;
  priceAt: string | null;
  savedMark?: {
    price: Money;
    currency: string | null;
    observedAt?: string | null;
  };
  reportedObservation?: {
    price: Money;
    currency: string | null;
    reportDate?: string | null;
  };
  cost: Money;
  costAuthority: string;
  marketValue: Money;
  unrealizedPnl: Money;
  unrealizedPnlPct: Money;
  realizedPnl: Money;
  converted: {
    currency: string;
    cost: Money;
    marketValue: Money;
    unrealizedPnl: Money;
    realizedPnl: Money;
  };
  complete: boolean;
  unavailableReasons: string[];
};
type Account = {
  accountId: string;
  name: string;
  currencies: {
    currency: string;
    cost: Money;
    marketValue: Money;
    unrealizedPnl: Money;
    realizedPnl: Money;
    cash: Money;
    totalAsset: Money;
    complete: boolean;
  }[];
};
type Book = {
  accountKind: "real" | "simulated";
  totals: {
    cost: Money;
    marketValue: Money;
    unrealizedPnl: Money;
    unrealizedPnlPct: Money;
    realizedPnl: Money;
    cash: Money;
    totalAsset: Money;
  };
  accounts: Account[];
  markets: {
    market: string;
    currency: string;
    cost: Money;
    marketValue: Money;
    unrealizedPnl: Money;
    positionCount: number;
    weightPct?: Money;
    complete: boolean;
  }[];
  positions: Position[];
  ranking: {
    basis: string;
    gainers: Position[];
    losers: Position[];
    unavailable: string[];
  };
  completeness: {
    valuation: boolean;
    cost: boolean;
    cash: boolean;
    realized: boolean;
    missingRecordIds: string[];
  };
};
type Overview = {
  currency: string;
  revision: string;
  asOf: string;
  books: Book[];
  unassigned: { positions: Position[]; reason: string };
  quoteStatus: unknown;
  fx: unknown;
  scope?: string;
  fullWealthComplete?: boolean;
  unrepresentedDomains?: string[];
};
type Close = {
  d: string;
  c: string;
  factId: string;
  pageId: string;
  sourceRevision: string;
  adjust: string;
  currency: string;
};
type Period = {
  state: string;
  start?: string;
  through?: string;
  basis?: string;
  reasons?: unknown[];
  financialHistoryBasis?: unknown;
  byCurrency?: {
    currency: string;
    eventCount: number;
    actualPaidKnownCount: number;
    grossBuys: Money;
    grossSells: Money;
    actualPaidFeesObservedSubtotal: Money;
    netDividendsObservedSubtotal: Money;
    realizedPnlObservedSubtotal: Money;
    realizedPnlComplete: boolean;
    unknownFeeCount: number;
    unknownRealizedCount: number;
  }[];
  priceTrends?: {
    recordId: string;
    first: { d: string; c: string };
    last: { d: string; c: string };
    priceChange: Money;
    priceChangePct: Money;
    observedBars: number;
    sourceRevision: string;
    adjust: string;
  }[];
  completePeriodReturn?: { state: string; value: Money; reasons: unknown[] };
};
type Series = {
  days: number;
  asOf: string;
  revision: string;
  accountKind: string;
  closes: Record<string, Close[]>;
  records: {
    id: string;
    market: string;
    code: string;
    currentQuantity: Money;
    brokerAccountId: string;
  }[];
  orders: Record<string, unknown>[];
  coverage: {
    partial: boolean;
    missing: unknown[];
    historyCoverageKnown: boolean;
  };
  periodAnalysis: Period;
  pagination: {
    orders: {
      offset: number;
      limit: number;
      total: number;
      nextOffset: number | null;
    };
    closes: {
      before: string | null;
      nextBefore: string | null;
      maxPoints: number;
    };
  };
};
type Sources = {
  versions: {
    revision: string;
    usable: boolean;
    revoked: boolean;
    policy: null | {
      source: string;
      licenseRevision: string;
      historyFrames: string[];
      historyAdjustments?: string[];
    };
  }[];
};
function totalValue(book: Book, key: string) {
  const c = book.completeness,
    known =
      key === "cost"
        ? c.cost
        : key === "marketValue"
          ? c.valuation
          : key === "cash"
            ? c.cash
            : key === "realizedPnl"
              ? c.realized
              : key === "totalAsset"
                ? c.valuation && c.cash
                : c.valuation && c.cost;
  return known ? book.totals[key as keyof Book["totals"]] : null;
}
export function AnalysisTotals({
  book,
  currency,
}: {
  book: Book;
  currency: string;
}) {
  return (
    <dl className="analysis-totals">
      {[
        ["cost", "成本"],
        ["marketValue", "持仓估值"],
        ["unrealizedPnl", "持仓浮盈亏"],
        ["unrealizedPnlPct", "持仓浮盈亏率"],
        ["realizedPnl", "有效历史已实现损益"],
        ["cash", "已核实现金"],
        ["totalAsset", "证券与现金合计"],
      ].map(([key, label]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>
            {amount(totalValue(book, key))}
            {(key !== "unrealizedPnlPct" || totalValue(book, key) !== null) && (
              <small>{key === "unrealizedPnlPct" ? "%" : currency}</small>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
const amount = (value: unknown) => (
  <PrivateAmount>
    {typeof value === "string"
      ? value
      : typeof value === "number"
        ? String(value)
        : "未知"}
  </PrivateAmount>
);
const reason = (value: unknown) =>
  typeof value === "string"
    ? (
        {
          missing_verified_period_opening_nav: "缺少已核实的期间期初净值",
          historical_cash_fx_observation_coverage_unknown:
            "历史现金与汇率观察范围尚未核实",
          account_kind_or_binding_unknown: "账户类型或归属尚未核实",
          observed_effective_trades_native_currency: "有效成交依据，按原币保留",
        } as Record<string, string>
      )[value] || value
    : value && typeof value === "object"
      ? Object.entries(value)
          .filter(([, item]) => typeof item === "string")
          .map(([key, item]) => key + ": " + item)
          .join(" · ")
      : "证据未完整核对";
export function PortfolioAnalysis(props: {
  session: Session;
  active?: boolean;
  generation?: number;
  onDenied: (failure: unknown) => void;
}) {
  const s = props.session;
  return (
    <Panel
      key={JSON.stringify([
        s.instance_id,
        s.user.id,
        s.user.role,
        s.receipt_scope,
        s.csrf,
        s.expires_at,
      ])}
      {...props}
    />
  );
}
function Panel({
  active = true,
  generation = 0,
  onDenied,
}: {
  session: Session;
  active?: boolean;
  generation?: number;
  onDenied: (failure: unknown) => void;
}) {
  const open = true;
  const { visible: amountsVisible } = useFinancialDisplay();
  const [currency, setCurrency] = useState("USD"),
    [costMethod, setCostMethod] = useState("diluted"),
    [usPrice, setUsPrice] = useState("observed"),
    [kind, setKind] = useState("real"),
    [account, setAccount] = useState(""),
    [period, setPeriod] = useState<AnalysisPeriod>("ytd"),
    [custom, setCustom] = useState({
      start: analysisToday().slice(0, 4) + "-01-01",
      through: analysisToday(),
    }),
    [draftRange, setDraftRange] = useState(custom),
    [settingsOpen, setSettingsOpen] = useState(false),
    [chart, setChart] = useState("return"),
    [visible, setVisible] = useState(!document.hidden),
    [selectionRevision, setSelectionRevision] = useState(0),
    [sourceRevision, setSourceRevision] = useState(""),
    [sources, setSources] = useState<Sources | null>(null),
    [overview, setOverview] = useState<Overview | null>(null),
    [series, setSeries] = useState<Series | null>(null),
    [error, setError] = useState(""),
    [seriesError, setSeriesError] = useState(""),
    [busy, setBusy] = useState(false);
  const epoch = useRef(0),
    alive = useRef(true),
    controllers = useRef(new Set<AbortController>()),
    denied = useRef(onDenied);
  denied.current = onDenied;
  const range = analysisRange(period, analysisToday(), custom)!;
  const days = String(range.days);
  function clear(keepData = false) {
    epoch.current++;
    for (const c of controllers.current) c.abort();
    controllers.current.clear();
    if (!keepData) {
      setOverview(null);
      setSeries(null);
    }
    setBusy(false);
  }
  function fail(value: unknown) {
    if (value instanceof ApiError && [401, 403].includes(value.status)) {
      clear();
      setSources(null);
      denied.current(value);
    }
    setError(value instanceof Error ? value.message : "分析暂时不可读取");
  }
  useEffect(() => {
    alive.current = true;
    if (!active || !open) clear();
    const hide = () => {
      if (document.hidden) clear();
      setVisible(!document.hidden);
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      alive.current = false;
      epoch.current++;
      for (const c of controllers.current) c.abort();
      controllers.current.clear();
      document.removeEventListener("visibilitychange", hide);
    };
  }, [active, open, generation]);
  useEffect(() => {
    if (active && visible) void load();
  }, [
    active,
    generation,
    visible,
    currency,
    costMethod,
    usPrice,
    kind,
    days,
    range.start,
    range.through,
    sourceRevision,
    selectionRevision,
  ]);
  function change(action: () => void) {
    clear();
    setError("");
    setSeriesError("");
    action();
    setSelectionRevision((value) => value + 1);
  }
  async function loadSources() {
    if (busy || !active || !open || document.hidden) return;
    const run = epoch.current,
      c = new AbortController();
    controllers.current.add(c);
    setBusy(true);
    setError("");
    try {
      const value = await api<Sources>("/market/sources", { signal: c.signal });
      if (alive.current && epoch.current === run) setSources(value);
    } catch (e) {
      if (!c.signal.aborted && epoch.current === run) fail(e);
    } finally {
      controllers.current.delete(c);
      if (epoch.current === run) setBusy(false);
    }
  }
  async function load() {
    if (busy || !active || !open || document.hidden) return;
    clear(true);
    setError("");
    setSeriesError("");
    const run = epoch.current,
      c = new AbortController();
    controllers.current.add(c);
    setBusy(true);
    const overviewQuery = new URLSearchParams({
        currency,
        costMethod,
        usPrice,
      }),
      historyQuery = new URLSearchParams({
        days,
        accountKind: kind,
        start: range.start,
        through: range.through,
        ...(sourceRevision ? { sourceRevision } : {}),
      });
    const results = await Promise.allSettled([
      api<Overview>("/portfolio/overview?" + overviewQuery, {
        signal: c.signal,
      }),
      api<Series>("/portfolio/series?" + historyQuery, { signal: c.signal }),
    ]);
    controllers.current.delete(c);
    if (!alive.current || epoch.current !== run || c.signal.aborted) return;
    for (const result of results)
      if (
        result.status === "rejected" &&
        result.reason instanceof ApiError &&
        [401, 403].includes(result.reason.status)
      ) {
        fail(result.reason);
        return;
      }
    const [total, history] = results;
    if (total.status === "fulfilled") setOverview(total.value);
    else fail(total.reason);
    if (history.status === "fulfilled") setSeries(history.value);
    else
      setSeriesError(
        history.reason instanceof Error
          ? history.reason.message
          : "历史证据暂不可用",
      );
    setBusy(false);
  }
  async function earlier() {
    if (
      !series?.pagination.closes.nextBefore ||
      busy ||
      !active ||
      document.hidden
    )
      return;
    const run = epoch.current,
      c = new AbortController();
    controllers.current.add(c);
    setBusy(true);
    setSeriesError("");
    const params = new URLSearchParams({
      days,
      start: range.start,
      through: range.through,
      accountKind: kind,
      before: series.pagination.closes.nextBefore,
      expectedRevision: series.revision,
      ...(sourceRevision ? { sourceRevision } : {}),
    });
    try {
      const value = await api<Series>("/portfolio/series?" + params, {
        signal: c.signal,
      });
      if (alive.current && epoch.current === run) setSeries(value);
    } catch (e) {
      if (!c.signal.aborted && epoch.current === run) {
        if (e instanceof ApiError && [401, 403].includes(e.status)) fail(e);
        else {
          if (e instanceof ApiError && e.status === 409) setSeries(null);
          setSeriesError(e instanceof Error ? e.message : "历史分页暂不可用");
        }
      }
    } finally {
      controllers.current.delete(c);
      if (epoch.current === run) setBusy(false);
    }
  }
  async function moreOrders() {
    if (
      !series ||
      series.pagination.orders.nextOffset === null ||
      busy ||
      !active ||
      document.hidden
    )
      return;
    const original = series,
      run = epoch.current,
      c = new AbortController();
    controllers.current.add(c);
    setBusy(true);
    setSeriesError("");
    const params = new URLSearchParams({
      days,
      start: range.start,
      through: range.through,
      accountKind: kind,
      orderOffset: String(original.pagination.orders.nextOffset),
      orderLimit: "500",
      expectedRevision: original.revision,
      ...(sourceRevision ? { sourceRevision } : {}),
      ...(original.pagination.closes.before
        ? { before: original.pagination.closes.before }
        : {}),
    });
    try {
      const value = await api<Series>("/portfolio/series?" + params, {
        signal: c.signal,
      });
      if (alive.current && epoch.current === run) {
        if (value.revision !== original.revision)
          throw new Error("历史证据版本已变化，请从第一页重读");
        setSeries((previous) => {
          if (!previous || previous.revision !== value.revision)
            return previous;
          const ids = new Set(previous.orders.map((row) => String(row.id)));
          return {
            ...previous,
            orders: [
              ...previous.orders,
              ...value.orders.filter((row) => !ids.has(String(row.id))),
            ],
            pagination: {
              ...previous.pagination,
              orders: value.pagination.orders,
            },
          };
        });
      }
    } catch (e) {
      if (!c.signal.aborted && epoch.current === run) {
        if (e instanceof ApiError && [401, 403].includes(e.status)) fail(e);
        else {
          if (e instanceof ApiError && e.status === 409) setSeries(null);
          setSeriesError(e instanceof Error ? e.message : "成交分页暂不可用");
        }
      }
    } finally {
      controllers.current.delete(c);
      if (epoch.current === run) setBusy(false);
    }
  }
  const book = overview?.books.find((value) => value.accountKind === kind),
    positions =
      book?.positions.filter(
        (value) => !account || value.brokerAccountId === account,
      ) || [],
    accounts =
      book?.accounts.filter(
        (value) => !account || value.accountId === account,
      ) || [],
    complete = !!book && book.completeness.valuation && book.completeness.cost;
  const accountLabels = brokerAccountLabels(
    (book?.accounts || []).map((value) => ({
      id: value.accountId,
      name: value.name,
      account_kind: kind,
      currency: "",
      currencies: value.currencies.map((row) => row.currency),
    })),
  );
  return (
    <section className="portfolio-analysis" aria-label="资产分析">
      <header className="analysis-heading">
        <div>
          <h2>资产分析</h2>
          <p>证券账户与已核实现金</p>
        </div>
        <div className="analysis-toolbar">
          <SelectMenu
            label="分析账本"
            value={kind}
            disabled={busy}
            onChange={(value) =>
              change(() => {
                setKind(value);
                setAccount("");
              })
            }
            options={[
              { value: "real", label: "真实账户" },
              { value: "simulated", label: "模拟账户" },
            ]}
          />
          <SelectMenu
            label="分析展示币种"
            value={currency}
            disabled={busy}
            onChange={(value) => change(() => setCurrency(value))}
            options={[
              "USD",
              "HKD",
              "CNY",
              "SGD",
              "JPY",
              "KRW",
              "GBP",
              "EUR",
            ].map((value) => ({ value, label: value }))}
          />
          <button
            type="button"
            className="icon-button"
            aria-label="分析设置"
            disabled={busy}
            onClick={() => {
              setSettingsOpen(true);
              void loadSources();
            }}
          >
            <Settings2 size={17} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="刷新分析"
            disabled={busy || !active}
            onClick={() => void load()}
          >
            <RefreshCw size={17} />
          </button>
        </div>
      </header>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {!overview &&
        (busy ? (
          <LoadingPlaceholder label="正在读取资产分析" />
        ) : (
          <div className="analysis-loading" role="status">
            暂未读到资产分析
          </div>
        ))}
      {overview && (
        <>
          <p className="analysis-asof">
            更新至 {analysisTime(overview.asOf)} ·{" "}
            {kind === "real" ? "真实" : "模拟"}账本 · {overview.currency}
          </p>
          {overview.fullWealthComplete === false && (
            <p className="analysis-scope">
              证券账户与现金范围 · 未包含{" "}
              {(overview.unrepresentedDomains || [])
                .map(
                  (value) =>
                    (
                      ({
                        cards: "卡包",
                        other_assets: "其他资产",
                        unbound_legacy_balances: "未绑定旧余额",
                      }) as Record<string, string>
                    )[value] || value,
                )
                .join(" / ")}
            </p>
          )}
          {book ? (
            <>
              <div className="analysis-dashboard">
                <section className="analysis-summary-card">
                  <AnalysisTotals book={book} currency={overview.currency} />
                  {(!book.completeness.valuation ||
                    !book.completeness.cost ||
                    !book.completeness.cash ||
                    !book.completeness.realized) && (
                    <p role="status">
                      范围未完整核对 ·{" "}
                      {Object.entries(book.completeness)
                        .filter(([, value]) => value === false)
                        .map(
                          ([key]) =>
                            (
                              ({
                                valuation: "行情估值",
                                cost: "成本",
                                cash: "现金",
                                realized: "已实现历史",
                              }) as Record<string, string>
                            )[key] || key,
                        )
                        .join(" / ")}{" "}
                      {book.completeness.missingRecordIds.length > 0 && (
                        <>
                          {" "}
                          · 缺失记录 {
                            book.completeness.missingRecordIds.length
                          }{" "}
                          项，详见逐项来源
                        </>
                      )}
                    </p>
                  )}
                </section>
                <section className="analysis-account-card">
                  <div className="analysis-card-heading">
                    <h3>账户明细</h3>
                  </div>
                  <label>
                    <span className="sr-only">账户明细</span>
                    <SelectMenu
                      label="账户明细"
                      value={account}
                      onChange={setAccount}
                      variant="field"
                      options={[
                        {
                          value: "",
                          label: `所有${kind === "real" ? "真实" : "模拟"}账户 · 独立原币`,
                        },
                        ...book.accounts.map((value) => ({
                          value: value.accountId,
                          label:
                            accountLabels.get(value.accountId) || value.name,
                        })),
                      ]}
                    />
                  </label>
                  <div className="portfolio-table">
                    <table>
                      <thead>
                        <tr>
                          <th>账户</th>
                          <th>原币</th>
                          <th>成本</th>
                          <th>持仓市值</th>
                          <th>浮盈亏</th>
                          <th>已实现</th>
                          <th>现金</th>
                          <th>证券与现金合计</th>
                          <th>范围</th>
                        </tr>
                      </thead>
                      <tbody>
                        {accounts.flatMap((value) =>
                          value.currencies.map((row) => (
                            <tr key={value.accountId + ":" + row.currency}>
                              <td>{value.name}</td>
                              <td>{row.currency}</td>
                              <td>{amount(row.cost)}</td>
                              <td>{amount(row.marketValue)}</td>
                              <td>{amount(row.unrealizedPnl)}</td>
                              <td>{amount(row.realizedPnl)}</td>
                              <td>{amount(row.cash)}</td>
                              <td>{amount(row.totalAsset)}</td>
                              <td>{row.complete ? "已核对" : "未完整"}</td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section className="analysis-distribution-card">
                  {complete && book.positions.length > 0 ? (
                    <>
                      <h3>
                        市场分布（全{kind === "real" ? "真实" : "模拟"}账本）
                      </h3>
                      <div className="portfolio-table">
                        <table>
                          <thead>
                            <tr>
                              <th>市场</th>
                              <th>币种</th>
                              <th>持仓数</th>
                              <th>估值占比</th>
                              <th>成本</th>
                              <th>持仓估值</th>
                              <th>浮盈亏</th>
                            </tr>
                          </thead>
                          <tbody>
                            {book.markets.map((value) => (
                              <tr key={value.market + ":" + value.currency}>
                                <td>
                                  <MarketBadge market={value.market} />
                                </td>
                                <td>{value.currency}</td>
                                <td>{value.positionCount}</td>
                                <td>
                                  {amount(value.weightPct)} %
                                  {amountsVisible &&
                                    value.weightPct != null &&
                                    Number.isFinite(Number(value.weightPct)) &&
                                    Number(value.weightPct) >= 0 &&
                                    Number(value.weightPct) <= 100 && (
                                      <svg
                                        viewBox="0 0 100 5"
                                        width="100"
                                        height="5"
                                        role="img"
                                        aria-label={`服务端估值占比 ${value.weightPct}%`}
                                      >
                                        <rect
                                          width={Number(value.weightPct)}
                                          height="5"
                                          rx="2"
                                          fill="currentColor"
                                        />
                                      </svg>
                                    )}
                                </td>
                                <td>{amount(value.cost)}</td>
                                <td>{amount(value.marketValue)}</td>
                                <td>{amount(value.unrealizedPnl)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <h3>持仓浮盈亏排行（非现金收益）</h3>
                      {[
                        ["gainers", "浮盈"],
                        ["losers", "浮亏"],
                      ].map(([key, label]) => (
                        <div key={key}>
                          <strong>{label}</strong>
                          <ol>
                            {book.ranking[key as "gainers" | "losers"].map(
                              (value) => (
                                <li key={value.recordId}>
                                  {value.name} ·{" "}
                                  <MarketBadge market={value.market} />:{" "}
                                  {value.code} ·{" "}
                                  {amount(value.converted?.unrealizedPnl)}{" "}
                                  {value.converted?.currency ||
                                    overview.currency}
                                </li>
                              ),
                            )}
                          </ol>
                        </div>
                      ))}
                    </>
                  ) : (
                    <WorkspaceEmpty
                      title={
                        book.positions.length
                          ? "分布与排行待核对"
                          : "还没有可分析的持仓"
                      }
                      description={
                        book.positions.length
                          ? "等待本账本估值、成本范围完整核对。"
                          : "已归属的证券持仓将显示市场分布与浮盈亏排行。"
                      }
                    />
                  )}
                </section>
                <details className="analysis-position-details">
                  <summary>逐项资产与来源</summary>
                  <div className="portfolio-table">
                    <table>
                      <thead>
                        <tr>
                          <th>资产</th>
                          <th>原币 / 数量</th>
                          <th>价格 / 时间</th>
                          <th>成本 / 口径</th>
                          <th>市值 / 浮盈亏</th>
                          <th>缺失项</th>
                        </tr>
                      </thead>
                      <tbody>
                        {positions.map((value) => (
                          <tr key={value.recordId}>
                            <td>
                              {value.name}
                              <small>
                                <MarketBadge market={value.market} />:{" "}
                                {value.code} · {value.recordId} ·{" "}
                                {value.brokerAccountId}
                              </small>
                            </td>
                            <td>
                              {value.currency || "币种未知"} ·{" "}
                              {amount(value.quantity)}
                            </td>
                            <td>
                              {amount(value.price)}
                              <small>
                                {(
                                  {
                                    licensed_quote: "已许可行情观察",
                                    official_report: "官方报告标记价",
                                    record_mark: "本人登记标记价",
                                    unknown: "来源未知",
                                  } as Record<string, string>
                                )[value.priceSource] ||
                                  value.priceSource ||
                                  "来源未知"}{" "}
                                · {value.priceAt || "时间未知"}
                              </small>
                              {value.savedMark && (
                                <small>
                                  保存标记 {amount(value.savedMark.price)}{" "}
                                  {value.savedMark.currency || "币种未知"} ·{" "}
                                  {value.savedMark.observedAt ||
                                    "观察时间未记录"}{" "}
                                  · 未计入当前估值
                                </small>
                              )}
                              {value.reportedObservation && (
                                <small>
                                  报告标记{" "}
                                  {amount(value.reportedObservation.price)}{" "}
                                  {value.reportedObservation.currency ||
                                    "币种未知"}{" "}
                                  · 报告日期{" "}
                                  {value.reportedObservation.reportDate ||
                                    "未知"}{" "}
                                  · 未计入当前估值
                                </small>
                              )}
                            </td>
                            <td>
                              {amount(value.cost)}
                              <small>{value.costAuthority || "口径未知"}</small>
                            </td>
                            <td>
                              {amount(value.marketValue)} /{" "}
                              {amount(value.unrealizedPnl)}
                            </td>
                            <td>
                              {value.unavailableReasons.join(" · ") ||
                                (!value.complete ? "未完整核对" : "已核对")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            </>
          ) : (
            <p>该账本尚无可核对账户范围</p>
          )}
          {overview.unassigned.positions.length > 0 && (
            <details>
              <summary>
                归属待核对 {overview.unassigned.positions.length} 项
              </summary>
              <p>{overview.unassigned.reason}</p>
              {overview.unassigned.positions.map((value) => (
                <p key={value.recordId}>
                  {value.name} · <MarketBadge market={value.market} />:{" "}
                  {value.code} · {value.recordId}
                </p>
              ))}
            </details>
          )}
        </>
      )}
      <section className="analysis-history" aria-label="期间趋势与历史证据">
        <header className="analysis-card-heading">
          <h3>期间趋势</h3>
          <span>
            {range.start.replaceAll("-", "/")} —{" "}
            {range.through.replaceAll("-", "/")}
          </span>
        </header>
        <WorkspaceTabs
          label="历史分析视图"
          value={chart}
          onChange={setChart}
          items={[
            { value: "return", label: "收益率走势" },
            { value: "asset", label: "总资产趋势" },
            { value: "evidence", label: "历史依据" },
          ]}
        />
        <WorkspaceTabs
          label="分析期间"
          value={period}
          disabled={busy}
          onChange={(value) => change(() => setPeriod(value))}
          items={[
            { value: "month", label: "本月" },
            { value: "1m", label: "近1月" },
            { value: "6m", label: "近6月" },
            { value: "ytd", label: "本年" },
            { value: "1y", label: "近1年" },
            { value: "retained", label: "保留范围" },
            { value: "custom", label: "自定义" },
          ]}
        />
        {period === "custom" && (
          <form
            className="analysis-date-range"
            onSubmit={(event) => {
              event.preventDefault();
              if (analysisRange("custom", analysisToday(), draftRange))
                change(() => setCustom({ ...draftRange }));
            }}
          >
            <label>
              开始日期
              <input
                type="date"
                value={draftRange.start}
                max={analysisToday()}
                onChange={(event) =>
                  setDraftRange((old) => ({
                    ...old,
                    start: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              结束日期
              <input
                type="date"
                value={draftRange.through}
                max={analysisToday()}
                onChange={(event) =>
                  setDraftRange((old) => ({
                    ...old,
                    through: event.target.value,
                  }))
                }
              />
            </label>
            <button
              className="button secondary"
              disabled={
                busy || !analysisRange("custom", analysisToday(), draftRange)
              }
            >
              应用日期
            </button>
          </form>
        )}
        {period === "retained" && (
          <p className="analysis-scope">
            当前接口支持最近20年内的保留证据，较早观察按页读取；缺失日期保持空缺。
          </p>
        )}
        {chart !== "evidence" && (
          <AnalysisTrendState
            type={chart}
            pending={busy && !series}
            series={series}
          />
        )}
        <WorkspaceView active={chart === "evidence"} label="历史依据">
          <div className="analysis-evidence">
            {seriesError && <p role="alert">{seriesError}</p>}
            {series && (
              <>
                <p>
                  历史读取截至 {series.asOf} ·{" "}
                  {series.accountKind === "real" ? "真实" : "模拟"}账本 ·{" "}
                  {range.start} — {range.through}
                </p>
                <p role="status">
                  期间结果{" "}
                  {series.periodAnalysis.state === "observed"
                    ? "有已观察事件依据"
                    : series.periodAnalysis.state === "partial"
                      ? "部分已观察事件，范围未完整"
                      : "未知"}
                </p>
                {(series.periodAnalysis.reasons || []).map((value, index) => (
                  <p key={index}>{reason(value)}</p>
                ))}
                <SourceFacts
                  label="历史依据"
                  value={
                    series.periodAnalysis.financialHistoryBasis ??
                    series.periodAnalysis.basis
                  }
                />
                <p>
                  事件区间 {series.periodAnalysis.start || "未知"} —{" "}
                  {series.periodAnalysis.through || "未知"} · 全
                  {kind === "real" ? "真实" : "模拟"}
                  账本（独立于上方账户明细筛选）
                </p>
                {series.periodAnalysis.byCurrency && (
                  <div className="portfolio-table">
                    <table>
                      <thead>
                        <tr>
                          <th>原币</th>
                          <th>有效事件</th>
                          <th>买入毛额</th>
                          <th>卖出毛额</th>
                          <th>已观察实付费用小计</th>
                          <th>已观察净股息小计</th>
                          <th>已观察已实现损益小计</th>
                          <th>未知项</th>
                        </tr>
                      </thead>
                      <tbody>
                        {series.periodAnalysis.byCurrency.map((value) => (
                          <tr key={value.currency}>
                            <td>{value.currency}</td>
                            <td>{value.eventCount}</td>
                            <td>{amount(value.grossBuys)}</td>
                            <td>{amount(value.grossSells)}</td>
                            <td>
                              {amount(value.actualPaidFeesObservedSubtotal)} ·
                              已核实 {value.actualPaidKnownCount} 笔
                            </td>
                            <td>
                              {amount(value.netDividendsObservedSubtotal)}
                            </td>
                            <td>
                              {amount(value.realizedPnlObservedSubtotal)}
                              <small>
                                {value.realizedPnlComplete
                                  ? "所列有效事件已核对"
                                  : "仍有未核对损益，不代表完整期间收益"}
                              </small>
                            </td>
                            <td>
                              费用 {value.unknownFeeCount} · 已实现{" "}
                              {value.unknownRealizedCount}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {series.periodAnalysis.completePeriodReturn && (
                  <div>
                    <p role="status">
                      完整期间收益{" "}
                      {series.periodAnalysis.completePeriodReturn.state ===
                      "observed"
                        ? amount(
                            series.periodAnalysis.completePeriodReturn.value,
                          )
                        : "未知"}
                    </p>
                    {series.periodAnalysis.completePeriodReturn.reasons.map(
                      (value, index) => (
                        <p key={index}>{reason(value)}</p>
                      ),
                    )}
                  </div>
                )}
                {series.periodAnalysis.priceTrends && (
                  <details>
                    <summary>有实际日线的价格变动（非资产收益）</summary>
                    {series.periodAnalysis.priceTrends.map((value) => (
                      <p key={value.recordId}>
                        {series.records.find(
                          (record) => record.id === value.recordId,
                        )?.code || value.recordId}{" "}
                        · {value.first.d} {value.first.c} → {value.last.d}{" "}
                        {value.last.c} · 价格变动 {amount(value.priceChange)} /{" "}
                        {amount(value.priceChangePct)} % · 实际观察{" "}
                        {value.observedBars} 条 · {value.adjust} ·{" "}
                        {value.sourceRevision}
                      </p>
                    ))}
                  </details>
                )}
                {series.coverage.partial && <p>观察范围尚不完整</p>}
                {series.coverage.missing.map((value, index) => (
                  <p key={index}>{reason(value)}</p>
                ))}
                <p>
                  日线与有效成交是历史素材，不按当前数量反推历史净值或收益。
                </p>
                {Object.entries(series.closes).map(([id, closes]) => (
                  <details key={id}>
                    <summary>
                      {series.records.find((value) => value.id === id)?.code ||
                        id}{" "}
                      · 已保留日线 {closes.length} 条
                    </summary>
                    <ObservedPrices
                      points={closes}
                      start={range.start}
                      through={range.through}
                    />
                    <table>
                      <thead>
                        <tr>
                          <th>日期</th>
                          <th>实际收盘价</th>
                          <th>口径</th>
                          <th>来源</th>
                        </tr>
                      </thead>
                      <tbody>
                        {closes.map((value) => (
                          <tr key={value.factId || value.d}>
                            <td>{value.d}</td>
                            <td>
                              {amount(value.c)} {value.currency || "币种未知"}
                            </td>
                            <td>{value.adjust}</td>
                            <td>
                              {value.sourceRevision}
                              <small>
                                {value.factId} · {value.pageId}
                              </small>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                ))}
                <details>
                  <summary>
                    有效成交与修订依据 {series.orders.length} /{" "}
                    {series.pagination.orders.total} 条
                  </summary>
                  {series.orders.map((value, index) => (
                    <p key={String(value.id ?? index)}>
                      {String(value.recordId ?? "记录待核对")} ·{" "}
                      {String(value.side ?? "方向未知")} · 数量{" "}
                      {amount(value.quantity ?? value.qty)} · 价格{" "}
                      {amount(value.price)} · 实付费用{" "}
                      {value.actualFeeKnown === true
                        ? amount(value.fees)
                        : "未知"}{" "}
                      ·{" "}
                      {String(value.occurredAt ?? value.tradedAt ?? "时间未知")}
                    </p>
                  ))}
                  {series.pagination.orders.nextOffset !== null && (
                    <button disabled={busy} onClick={() => void moreOrders()}>
                      读取更多有效成交
                    </button>
                  )}
                </details>
                {series.pagination.closes.nextBefore && (
                  <button disabled={busy} onClick={() => void earlier()}>
                    读取更早的保留证据
                  </button>
                )}
                <small>历史版本 {series.revision}</small>
              </>
            )}
          </div>
        </WorkspaceView>
      </section>
      {settingsOpen && (
        <Dialog title="分析设置" onClose={() => setSettingsOpen(false)}>
          <div className="dialog-content analysis-settings">
            <label>
              成本口径
              <SelectMenu
                label="成本口径"
                value={costMethod}
                disabled={busy}
                variant="field"
                options={[
                  { value: "diluted", label: "摊薄登记成本" },
                  { value: "average_open", label: "未平仓平均成本" },
                ]}
                onChange={(value) => change(() => setCostMethod(value))}
              />
            </label>
            <label>
              美股价格
              <SelectMenu
                label="美股价格"
                value={usPrice}
                disabled={busy}
                variant="field"
                options={[
                  { value: "observed", label: "实际已观察报价" },
                  { value: "regular", label: "常规时段报价" },
                ]}
                onChange={(value) => change(() => setUsPrice(value))}
              />
            </label>
            <label>
              日线来源
              <SelectMenu
                label="日线来源"
                value={sourceRevision}
                disabled={busy}
                variant="field"
                options={[
                  { value: "", label: "已保留范围，不指定来源" },
                  ...(sources?.versions
                    .filter(
                      (value) =>
                        value.usable &&
                        !value.revoked &&
                        value.policy?.historyFrames.includes("day"),
                    )
                    .map((value) => ({
                      value: value.revision,
                      label: value.policy?.source || "已许可来源",
                    })) || []),
                ]}
                onChange={(value) => change(() => setSourceRevision(value))}
              />
            </label>
            {overview && (
              <details>
                <summary>来源核对</summary>
                <SourceFacts label="报价" value={overview.quoteStatus} />
                <SourceFacts label="汇率" value={overview.fx} />
                <p>分析版本 {overview.revision}</p>
              </details>
            )}
          </div>
        </Dialog>
      )}
    </section>
  );
}
function SourceFacts({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return <p>{label} · 未知</p>;
  if (typeof value !== "object")
    return (
      <p>
        {label} · {typeof value === "string" ? reason(value) : String(value)}
      </p>
    );
  return (
    <details>
      <summary>{label}详情</summary>
      <dl>
        {Object.entries(value).map(([key, item]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>
              {item === null
                ? "未知"
                : typeof item === "object"
                  ? Array.isArray(item)
                    ? item.map(reason).join(" · ")
                    : reason(item)
                  : String(item)}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function ObservedPrices({
  points,
  start,
  through,
}: {
  points: Close[];
  start: string;
  through: string;
}) {
  const { visible } = useFinancialDisplay();
  if (!visible)
    return (
      <p>
        <PrivateAmount>实际收盘价</PrivateAmount>
      </p>
    );
  const plot = observedPricePlot(points, { start, through });
  if (!plot) return <p>图形范围暂不可表示，精确观察值保留在下表。</p>;
  if (!plot.points.length) return <p>所选日期内没有已观察收盘价。</p>;
  return (
    <figure className="analysis-observed-prices">
      <svg
        viewBox="0 0 600 190"
        role="img"
        aria-label="实际日期收盘价，非资产净值或收益曲线"
      >
        <line
          x1="24"
          x2="576"
          y1="164"
          y2="164"
          stroke="currentColor"
          opacity=".15"
        />
        <path
          d={plot.path}
          fill="none"
          stroke="var(--accent,#3478f6)"
          strokeWidth="2"
        />
        {plot.points.map((point) => (
          <circle
            key={point.d}
            cx={point.x}
            cy={point.y}
            r="2.5"
            fill="var(--accent,#3478f6)"
          >
            <title>{`${point.d} · ${point.c}`}</title>
          </circle>
        ))}
        <text x="24" y="185" fontSize="10" fill="currentColor">
          {start.replaceAll("-", "/")}
        </text>
        <text
          x="576"
          y="185"
          textAnchor="end"
          fontSize="10"
          fill="currentColor"
        >
          {through.replaceAll("-", "/")}
        </text>
      </svg>
      <figcaption>
        {plot.points.length} 条实际收盘观察 · 缺失日期不连线，原值保留在下表
      </figcaption>
    </figure>
  );
}
function analysisTime(raw: string) {
  if (!Number.isFinite(Date.parse(raw))) return "时间待核对";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(raw));
}
export function AnalysisTrendState({
  type,
  pending,
  series,
}: {
  type: string;
  pending: boolean;
  series: Series | null;
}) {
  const result = series?.periodAnalysis.completePeriodReturn;
  const observed =
    type === "return" &&
    result?.state === "observed" &&
    typeof result.value === "string";
  return (
    <section
      className="analysis-trend-state"
      aria-label={type === "asset" ? "总资产趋势" : "收益率走势"}
    >
      {observed && (
        <div className="analysis-period-value">
          <span>完整期间收益</span>
          <strong>{amount(result.value)}</strong>
        </div>
      )}
      <WorkspaceEmpty
        title={
          pending
            ? "正在读取期间观察"
            : type === "asset"
              ? "资产净值历史待核对"
              : observed
                ? "期间收益已核对，曲线资料待补齐"
                : "期间收益待核对"
        }
        description={
          pending
            ? ""
            : type === "asset"
              ? "需要各日期的完整资产净值观察，当前持仓不会反推成历史曲线。"
              : "期初净值、现金流和历史观察未完整时，收益率保持未知。"
        }
      />
      {series && (
        <p className="analysis-history-counts">
          已保留 {series.records.length} 项证券、{series.orders.length}{" "}
          笔有效成交 · 原始资料见历史依据
        </p>
      )}
    </section>
  );
}
