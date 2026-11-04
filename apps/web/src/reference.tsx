import { TradingMonth } from "./trading-month";
import {
  Activity,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { RefreshCw } from "lucide-react";
import { api, ApiError, type Session } from "./api";
import { ConnectionVerification } from "./connection-verification";
import { SelectMenu } from "./select-menu";
import { requestId } from "./request-id";
import {
  dayLabel,
  mayPoll,
  terminal,
  readOriginalReceipt,
  releaseRejectedRequest,
  rateLabel,
  receiptKey,
  restoreRequest,
  type Receipt,
} from "./reference-state";
import "./reference.css";
import { CalendarComparison } from "./calendar-comparison";
import { FxObservations } from "./fx-observations";
import { FxProviderEditor, type CustomProvider } from "./fx-provider-editor";
import { WorkspaceTabs, WorkspaceView } from "./workspace-ui";
import { FxConverter } from "./fx-converter";

type Rates = {
  refreshEnabled: boolean;
  base: string;
  rates: Record<string, string>;
  quoted: string[];
  observationDate: string | null;
  observationInstant?: string | null;
  roundedCurrencies?: string[];
  updatedAt: number | null;
  source: string;
  sourcePrecision?: string;
  identityCurrencies?: string[];
  exactRatios?: Record<string, { numerator: string; denominator: string }>;
  quarantined?: boolean;
  budget?: {
    dayUTC: string;
    limit: number;
    used: number;
    remaining: number;
    scope: string;
  };
};
type HistoryEntry = {
  requestId: string;
  taskId: string;
  state: Receipt["state"];
  errorCode: string | null;
  requestedAt: string;
  observationId: string | null;
};
type HistoryPage = { items: HistoryEntry[]; nextCursor: string | null };
type Config = {
  enabled: boolean;
  daily_budget: number;
  revision: number;
  custom?: { url: string } | null;
};
type Day = {
  date: string;
  status: string;
  name: string | null;
  isTradingDay: boolean | null;
  actualTradingStatus?: string;
  sourceIds?: string[];
  close: {
    continuous: string;
    auction: { earliest: string; latest: string } | null;
  } | null;
};
export type Calendar = {
  market: string;
  marketName?: string;
  timeZone?: string;
  year: number;
  days: Day[];
  coverage: {
    status: string;
    verifiedAt: string | null;
    temporaryClosures?: string;
    verifiedYears?: number[];
  };
  sources: {
    id: string;
    title: string;
    url: string;
    publishedAt?: string | null;
    verifiedAt?: string | null;
  }[];
};
export function ReferencePage({
  session,
  active = true,
}: {
  session: Session;
  active?: boolean;
}) {
  const scope = JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  return (
    <ReferenceSession
      key={JSON.stringify([scope, session.csrf, session.expires_at])}
      scope={scope}
      session={session}
      active={active}
    />
  );
}
function ReferenceSession({
  scope,
  session,
  active,
}: {
  scope: string;
  session: Session;
  active: boolean;
}) {
  const [view, setView] = useState<"rates" | "calendar" | "source">("rates");
  const [visible, setVisible] = useState(!document.hidden);
  const [rates, setRates] = useState<Rates | null>(null),
    [config, setConfig] = useState<Config | null>(null);
  const [calendar, setCalendar] = useState<Calendar | null>(null),
    [market, setMarket] = useState("CN"),
    [year, setYear] = useState(String(new Date().getFullYear())),
    [month, setMonth] = useState(
      String(new Date().getMonth() + 1).padStart(2, "0"),
    );
  const [calendarMode, setCalendarMode] = useState("single"),
    [observationsOpen, setObservationsOpen] = useState(false);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [receipt, setReceipt] = useState<Receipt | null>(null);
  const [id, setId] = useState<string | null>(null),
    [locked, setLocked] = useState(false),
    [draft, setDraft] = useState({ enabled: false, dailyBudget: "12" });
  const [customProvider, setCustomProvider] = useState<CustomProvider>();
  const [providerEditorEpoch, setProviderEditorEpoch] = useState(0);
  useLayoutEffect(
    () => () => {
      // Activity hides a module by cleaning up effects before hidden props render.
      setCustomProvider(undefined);
      setProviderEditorEpoch((value) => value + 1);
    },
    [],
  );
  useEffect(() => {
    if (!active || !visible) {
      setCustomProvider(undefined);
      setProviderEditorEpoch((value) => value + 1);
    }
  }, [active, visible]);
  const [historyOpen, setHistoryOpen] = useState(false),
    [history, setHistory] = useState<HistoryPage | null>(null),
    [historyBusy, setHistoryBusy] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const historyRead = useRef(0),
    ratesRead = useRef(0);
  const requestRef = useRef<string | null>(null),
    polling = useRef(false);
  const selectedObservation = useRef<string | null>(null);
  const epoch = useRef(0),
    mounted = useRef(true),
    dirty = useRef(false),
    live = useRef(active && visible);
  live.current = active && visible;
  const clear = useCallback(() => {
    epoch.current++;
    setRates(null);
    setConfig(null);
    setCalendar(null);
    setReceipt(null);
    setHistory(null);
    setHistoryBusy(false);
    setVerificationOpen(false);
    setId(null);
    requestRef.current = null;
    selectedObservation.current = null;
    setDraft({ enabled: false, dailyBudget: "12" });
    setCustomProvider(undefined);
    setProviderEditorEpoch((value) => value + 1);
    setLocked(true);
    try {
      sessionStorage.removeItem(receiptKey(scope));
    } catch {
      /* fail closed */
    }
  }, [scope]);
  const failure = useCallback(
    (reason: unknown) => {
      if (
        reason instanceof ApiError &&
        (reason.status === 401 || reason.status === 403)
      )
        clear();
      setError(reason instanceof Error ? reason.message : "服务连接失败");
    },
    [clear],
  );
  useEffect(() => {
    mounted.current = true;
    try {
      const restored = restoreRequest(sessionStorage, scope);
      requestRef.current = restored;
      setId(restored);
    } catch (reason) {
      setLocked(true);
      failure(reason);
    }
    const visibility = () => {
      epoch.current++;
      setVisible(!document.hidden);
      if (document.hidden) {
        setRates(null);
        setConfig(null);
        setReceipt(null);
        setHistory(null);
        setHistoryBusy(false);
        setVerificationOpen(false);
      }
    };
    const expired = () => clear();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("alcor:session-expired", expired);
    return () => {
      mounted.current = false;
      epoch.current++;
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("alcor:session-expired", expired);
    };
  }, [scope, clear, failure]);
  useEffect(() => {
    epoch.current++;
    if (!active) {
      setRates(null);
      setConfig(null);
      setReceipt(null);
      setHistory(null);
      setHistoryBusy(false);
      setVerificationOpen(false);
    }
  }, [active]);
  const load = useCallback(
    async (observationId?: string | null) => {
      if (!live.current || locked) return;
      const selectedRequest = requestRef.current;
      const observation = observationId ?? selectedObservation.current;
      const generation = epoch.current,
        read = ++ratesRead.current;
      try {
        const result = await api<Rates>(
          `/reference/rates${observation ? `?observationId=${encodeURIComponent(observation)}` : ""}`,
        );
        if (
          mounted.current &&
          live.current &&
          generation === epoch.current &&
          read === ratesRead.current &&
          selectedRequest === requestRef.current
        )
          setRates(result);
      } catch (reason) {
        if (
          mounted.current &&
          live.current &&
          generation === epoch.current &&
          read === ratesRead.current &&
          selectedRequest === requestRef.current
        )
          failure(reason);
      }
    },
    [locked, failure],
  );
  useEffect(() => {
    if (!active || !visible || locked) return;
    void load();
    if (session.user.role === "admin") {
      const generation = epoch.current;
      void api<Config>("/reference/rates/provider")
        .then((value) => {
          if (mounted.current && live.current && generation === epoch.current) {
            setConfig(value);
            if (!dirty.current)
              setDraft({
                enabled: value.enabled,
                dailyBudget: String(value.daily_budget),
              });
          }
        })
        .catch((reason) => {
          if (generation === epoch.current) failure(reason);
        });
    }
  }, [active, visible, locked, load, session.user.role, failure]);
  useEffect(() => {
    setCalendar(null);
    if (
      !active ||
      !visible ||
      locked ||
      calendarMode !== "single" ||
      !/^\d{4}$/.test(year) ||
      Number(year) < 2000 ||
      Number(year) > 2100
    )
      return;
    const controller = new AbortController();
    const generation = epoch.current;
    void api<{ data: Calendar }>(
      `/reference/calendar?market=${market}&year=${year}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (
          !controller.signal.aborted &&
          mounted.current &&
          live.current &&
          generation === epoch.current
        )
          setCalendar(result.data);
      })
      .catch((reason) => {
        if (!controller.signal.aborted && generation === epoch.current)
          failure(reason);
      });
    return () => controller.abort();
  }, [active, visible, locked, market, year, failure, calendarMode]);
  const check = useCallback(async () => {
    if (!id || !live.current || locked || busy || polling.current) return;
    polling.current = true;
    const generation = epoch.current;
    const original = id;
    try {
      await readOriginalReceipt(
        () => api<Receipt>(`/reference/rates/operations/${original}`),
        () =>
          mounted.current &&
          live.current &&
          generation === epoch.current &&
          requestRef.current === original,
        (value) => {
          setReceipt(value);
          setError("");
          if (value.state === "completed") {
            selectedObservation.current = value.observation_id ?? null;
            void load(value.observation_id);
          }
        },
        failure,
      );
    } finally {
      polling.current = false;
    }
  }, [id, locked, busy, load, failure]);
  useEffect(() => {
    if (!mayPoll(active, visible, id, receipt) || locked || busy) return;
    void check();
    const timer = setInterval(() => void check(), 2000);
    return () => clearInterval(timer);
  }, [active, visible, id, receipt?.state, locked, busy, check]);
  async function refresh() {
    if (busy || locked || requestRef.current || !live.current) return;
    const identifier = requestId();
    const generation = epoch.current;
    try {
      sessionStorage.setItem(receiptKey(scope), identifier);
      requestRef.current = identifier;
      selectedObservation.current = null;
      ++ratesRead.current;
      setId(identifier);
      setBusy(true);
      setError("");
      await api(
        "/reference/rates/refresh",
        { method: "POST", body: JSON.stringify({ requestId: identifier }) },
        session.csrf,
      );
      if (mounted.current && live.current && generation === epoch.current)
        void check();
    } catch (reason) {
      if (
        mounted.current &&
        live.current &&
        generation === epoch.current &&
        requestRef.current === identifier
      ) {
        try {
          if (
            releaseRejectedRequest(
              sessionStorage,
              scope,
              identifier,
              reason instanceof ApiError ? reason.status : undefined,
            )
          ) {
            requestRef.current = null;
            setId(null);
            setReceipt(null);
          }
        } catch {
          setLocked(true);
        }
        failure(reason);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function finish() {
    if (!receipt || !terminal(receipt.state)) return;
    try {
      sessionStorage.removeItem(receiptKey(scope));
      requestRef.current = null;
      selectedObservation.current = null;
      ++ratesRead.current;
      setId(null);
      setReceipt(null);
      void load();
      if (historyOpen) void loadHistory();
    } catch (reason) {
      failure(reason);
    }
  }
  async function save() {
    if (!config || busy || locked || !live.current) return;
    const budget = Number(draft.dailyBudget);
    if (!Number.isInteger(budget) || budget < 1 || budget > 1000) {
      setError("每日额度须为 1–1000");
      return;
    }
    const generation = epoch.current;
    setBusy(true);
    try {
      const result = await api<{ revision: number }>(
        "/reference/rates/provider",
        {
          method: "PUT",
          body: JSON.stringify({
            enabled: draft.enabled,
            dailyBudget: budget,
            revision: config.revision,
            ...(customProvider ? { custom: customProvider } : {}),
          }),
        },
        session.csrf,
      );
      if (mounted.current && live.current && generation === epoch.current) {
        setCustomProvider(undefined);
        setProviderEditorEpoch((value) => value + 1);
        const current = await api<Config>("/reference/rates/provider");
        if (!mounted.current || !live.current || generation !== epoch.current)
          return;
        setConfig(current);
        if (current.revision === result.revision) {
          setDraft({
            enabled: current.enabled,
            dailyBudget: String(current.daily_budget),
          });
          dirty.current = false;
          setError("");
        } else {
          setError("设置已变化，草稿已保留，请核对后保存");
        }
        void load();
      }
    } catch (reason) {
      if (generation === epoch.current) {
        if (reason instanceof ApiError && reason.code === "reauth_required") {
          setVerificationOpen(true);
          return;
        }
        failure(reason);
        if (reason instanceof ApiError && [0, 409].includes(reason.status)) {
          try {
            const current = await api<Config>("/reference/rates/provider");
            if (
              mounted.current &&
              live.current &&
              generation === epoch.current
            ) {
              setConfig(current);
              setError("已重新读取当前设置，草稿已保留，请核对后保存");
            }
          } catch (lookupError) {
            if (generation === epoch.current) failure(lookupError);
          }
        }
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const loadHistory = useCallback(
    async (cursor?: string) => {
      if (!live.current || locked) return;
      const generation = epoch.current,
        read = ++historyRead.current;
      setHistoryBusy(true);
      try {
        const value = await api<HistoryPage>(
          `/reference/rates/operations?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        );
        if (
          mounted.current &&
          live.current &&
          generation === epoch.current &&
          read === historyRead.current
        )
          setHistory((previous) => ({
            items: cursor
              ? [...(previous?.items || []), ...value.items]
              : value.items,
            nextCursor: value.nextCursor,
          }));
      } catch (reason) {
        if (
          mounted.current &&
          live.current &&
          generation === epoch.current &&
          read === historyRead.current
        )
          failure(reason);
      } finally {
        if (
          mounted.current &&
          generation === epoch.current &&
          read === historyRead.current
        )
          setHistoryBusy(false);
      }
    },
    [locked, failure],
  );
  useEffect(() => {
    if (historyOpen && active && visible && !locked) void loadHistory();
  }, [historyOpen, active, visible, locked, id, receipt?.state, loadHistory]);
  function resume(entry: HistoryEntry) {
    if (
      locked ||
      !live.current ||
      (requestRef.current && requestRef.current !== entry.requestId)
    )
      return;
    try {
      sessionStorage.setItem(receiptKey(scope), entry.requestId);
      requestRef.current = entry.requestId;
      selectedObservation.current =
        entry.state === "completed" ? entry.observationId : null;
      ++ratesRead.current;
      setId(entry.requestId);
      setReceipt({
        id: entry.taskId,
        state: entry.state,
        error_code: entry.errorCode,
        observation_id: entry.observationId,
      });
      if (entry.state === "completed") void load(entry.observationId);
    } catch (reason) {
      setLocked(true);
      failure(reason);
    }
  }
  return (
    <section className="reference-page">
      <header className="page-heading">
        <h1>汇率与日历</h1>
        <button
          className="button"
          type="button"
          onClick={() => void load()}
          disabled={busy || locked}
        >
          <RefreshCw size={16} />
          重新读取
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      <WorkspaceTabs
        label="汇率与日历功能"
        value={view}
        onChange={setView}
        items={[
          { value: "rates", label: "汇率换算" },
          { value: "calendar", label: "休市日历" },
          ...(session.user.role === "admin"
            ? [{ value: "source" as const, label: "来源设置" }]
            : []),
        ]}
      />
      <WorkspaceView active={view === "rates"} label="汇率换算与观察">
        <FxConverter rates={rates} />
        <section aria-label="汇率">
          <div className="reference-actions">
            <h2>汇率 · 1 {rates?.base ?? "USD"}</h2>
            <button
              className="button"
              type="button"
              onClick={() => void refresh()}
              disabled={busy || locked || id !== null || !rates?.refreshEnabled}
            >
              刷新报价
            </button>
          </div>
          {rates ? (
            <>
              <dl className="reference-rates">
                {[
                  ...new Set([
                    "USD",
                    "CNY",
                    "HKD",
                    "JPY",
                    "EUR",
                    ...Object.keys(rates.rates),
                  ]),
                ].map((code) => (
                  <div key={code}>
                    <dt>{code}</dt>
                    <dd>
                      {rates.roundedCurrencies?.includes(code) ? "≈ " : ""}
                      {Object.hasOwn(rates.rates, code)
                        ? rateLabel(rates.rates, code)
                        : "未知"}
                      {rates.identityCurrencies?.includes(code) && (
                        <small>基准恒等值，非外部报价</small>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <details>
                <summary>来源</summary>
                <p>{rates.source}</p>
                <p>
                  {rates.sourcePrecision === "date"
                    ? "来源仅提供日期，日内时效未知"
                    : rates.sourcePrecision
                      ? `来源时间精度 ${rates.sourcePrecision}`
                      : "来源时间精度未知"}
                </p>
                <p>
                  报价时间：
                  {rates.observationInstant ?? rates.observationDate ?? "未知"}
                </p>
                <p>
                  接收时间：
                  {rates.updatedAt === null
                    ? "未取得"
                    : new Date(rates.updatedAt).toLocaleString()}
                </p>
                {!!Object.keys(rates.exactRatios || {}).length && (
                  <dl className="portfolio-proof">
                    {Object.entries(rates.exactRatios || {}).map(
                      ([code, ratio]) => (
                        <div key={code}>
                          <dt>{code} 原始比率</dt>
                          <dd>
                            {ratio.numerator} / {ratio.denominator}
                          </dd>
                        </div>
                      ),
                    )}
                  </dl>
                )}
                {rates.budget && (
                  <p>
                    共享来源预算 · {rates.budget.dayUTC} UTC · 已用{" "}
                    {rates.budget.used} / {rates.budget.limit} · 剩余{" "}
                    {rates.budget.remaining}
                  </p>
                )}
                {rates.quarantined === true && (
                  <p role="status">
                    恢复隔离中，仅可读取保留观察，不执行来源刷新
                  </p>
                )}
              </details>
            </>
          ) : (
            <p>暂无汇率</p>
          )}
          {id && (
            <div className="reference-receipt">
              <span>
                {receipt
                  ? {
                      queued: "等待处理",
                      running: "正在读取",
                      completed: "刷新完成",
                      failed: "刷新失败",
                      interrupted: "处理已中断",
                    }[receipt.state]
                  : "结果待核对"}
              </span>
              {receipt?.error_code && (
                <span>
                  {receipt.error_code === "daily_budget"
                    ? "每日额度已用完"
                    : receipt.error_code === "provider_disabled"
                      ? "供应商读取未启用"
                      : "供应商读取未完成"}
                </span>
              )}
              <button
                className="button"
                type="button"
                onClick={() => void check()}
                disabled={locked}
              >
                查询原请求
              </button>
              {receipt && terminal(receipt.state) && (
                <button className="button" type="button" onClick={finish}>
                  完成
                </button>
              )}
              <details>
                <summary>请求编号</summary>
                <code>{id}</code>
              </details>
            </div>
          )}
        </section>
        <details
          onToggle={(event) => setObservationsOpen(event.currentTarget.open)}
        >
          <summary>来源观察与原件</summary>
          <Activity
            mode={
              observationsOpen && active && visible && !locked
                ? "visible"
                : "hidden"
            }
          >
            <FxObservations
              session={session}
              disabled={busy || id !== null || locked}
              onSelect={(observation) => {
                selectedObservation.current = observation;
                void load(observation);
              }}
              onDenied={failure}
            />
          </Activity>
        </details>
        <details
          open={historyOpen}
          onToggle={(e) => setHistoryOpen(e.currentTarget.open)}
        >
          <summary>刷新记录</summary>
          <div className="reference-calendar">
            <table>
              <thead>
                <tr>
                  <th>请求时间</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {history?.items.map((entry) => (
                  <tr key={entry.requestId}>
                    <td>{new Date(entry.requestedAt).toLocaleString()}</td>
                    <td>
                      {{
                        queued: "等待处理",
                        running: "正在读取",
                        completed: "已完成",
                        failed: "失败",
                        interrupted: "已中断",
                      }[entry.state] || "待核对"}
                    </td>
                    <td>
                      <button
                        className="button small"
                        type="button"
                        disabled={locked || (!!id && id !== entry.requestId)}
                        onClick={() => resume(entry)}
                      >
                        查询原请求
                      </button>
                      <details>
                        <summary>请求编号</summary>
                        <code>{entry.requestId}</code>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!historyBusy && history?.items.length === 0 && <p>暂无刷新记录</p>}
          {historyBusy && <p role="status">正在读取…</p>}
          {history?.nextCursor && (
            <button
              className="button"
              type="button"
              disabled={historyBusy || locked}
              onClick={() => void loadHistory(history.nextCursor!)}
            >
              更多记录
            </button>
          )}
        </details>
      </WorkspaceView>
      <WorkspaceView active={view === "calendar"} label="休市日历">
        <section aria-label="交易日历">
          <div className="reference-actions">
            <h2>交易日历</h2>
            <SelectMenu
              label="日历范围"
              value={calendarMode}
              onChange={setCalendarMode}
              options={[
                { value: "single", label: "单市场" },
                { value: "batch", label: "三市场对比" },
              ]}
            />
            <SelectMenu
              label="市场"
              disabled={calendarMode === "batch"}
              value={market}
              onChange={setMarket}
              options={[
                { value: "CN", label: "A 股" },
                { value: "HK", label: "港股" },
                { value: "US", label: "美股" },
              ]}
            />
            <SelectMenu
              label="月份"
              value={month}
              onChange={setMonth}
              options={Array.from({ length: 12 }, (_, index) => ({
                value: String(index + 1).padStart(2, "0"),
                label: `${index + 1}月`,
              }))}
            />
            <label>
              年份
              <input
                type="number"
                min="2000"
                max="2100"
                value={year}
                onChange={(event) => setYear(event.target.value)}
              />
            </label>
          </div>
          {calendarMode === "batch" ? (
            <CalendarComparison
              year={year}
              month={month}
              active={active && visible && !locked && view === "calendar"}
              onDenied={failure}
            />
          ) : calendar ? (
            <>
              <p role="status">
                {calendar.coverage.status === "verified"
                  ? "年度安排已收录"
                  : "该年份年度安排未确认"}{" "}
                · 临时停市和当日实际交易状态未知
              </p>
              <p>
                {calendar.marketName || calendar.market} ·{" "}
                {calendar.timeZone || "时区未知"}
              </p>
              <TradingMonth calendar={calendar} month={month} />
              <details>
                <summary>日期与收市明细</summary>
                <div className="reference-calendar">
                  <table>
                    <thead>
                      <tr>
                        <th>日期</th>
                        <th>安排</th>
                        <th>名称</th>
                        <th>收市时间（当地）</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calendar.days
                        .filter((day) => day.date.slice(5, 7) === month)
                        .map((day) => (
                          <tr key={day.date}>
                            <td>{day.date}</td>
                            <td>{dayLabel(day.status)}</td>
                            <td>{day.name ?? "—"}</td>
                            <td>
                              {day.close
                                ? `${day.close.continuous}${day.close.auction ? ` · ${day.close.auction.earliest}–${day.close.auction.latest}` : ""}`
                                : day.isTradingDay === false
                                  ? "不适用"
                                  : "未知"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </details>
              <details>
                <summary>来源</summary>
                {calendar.sources.length ? (
                  calendar.sources.map((source) => (
                    <p key={source.id}>
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.title}
                      </a>
                      {source.publishedAt && (
                        <small>发布 {source.publishedAt}</small>
                      )}
                      {source.verifiedAt && (
                        <small>核对 {source.verifiedAt}</small>
                      )}
                    </p>
                  ))
                ) : (
                  <p>该年份尚未确认</p>
                )}
              </details>
            </>
          ) : (
            <p>日历尚未取得</p>
          )}
        </section>
      </WorkspaceView>
      <WorkspaceView active={view === "source"} label="汇率来源设置">
        {session.user.role === "admin" && config && (
          <section aria-label="汇率供应商">
            <h2>汇率供应商</h2>
            <p>{config.custom ? "自定义来源" : "默认来源"}</p>
            <FxProviderEditor
              key={providerEditorEpoch}
              active={active && visible}
              disabled={busy || locked}
              onChange={setCustomProvider}
            />
            <div className="reference-actions">
              <label>
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  disabled={busy || locked}
                  onChange={(event) => {
                    dirty.current = true;
                    setDraft({ ...draft, enabled: event.target.checked });
                  }}
                />
                允许读取
              </label>
              <label>
                每日额度
                <input
                  inputMode="numeric"
                  value={draft.dailyBudget}
                  disabled={busy || locked}
                  onChange={(event) => {
                    dirty.current = true;
                    setDraft({ ...draft, dailyBudget: event.target.value });
                  }}
                />
              </label>
              <button
                className="button"
                type="button"
                onClick={() => void save()}
                disabled={busy || locked}
              >
                保存
              </button>
            </div>
          </section>
        )}
      </WorkspaceView>
      {verificationOpen && (
        <ConnectionVerification
          session={session}
          scope="reference/rates/provider"
          onClose={() => setVerificationOpen(false)}
          onVerified={() => {
            setVerificationOpen(false);
            void save();
          }}
          onDenied={() => clear()}
        />
      )}
    </section>
  );
}
