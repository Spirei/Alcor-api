import { LoadingPlaceholder } from "./loading-placeholder";
import { PrivateAmount, MarketBadge } from "./financial-display";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, ApiError, type Session } from "./api";
import { Dialog } from "./dialog";
import { WorkspaceEmpty, usePageReveal } from "./workspace-ui";
import { dailyReasonLabel } from "./activity-presentation";
export type DailyPosition = {
  recordId: string;
  accountId: string | null;
  market: string;
  code: string;
  quantity: string | null;
  currentExposurePriceMoveEstimate: string | null;
  actualPnl: string | null;
  previousDate: string | null;
  date: string | null;
  previousClose: string | null;
  close: string | null;
  priceDifference: string | null;
  currency: string | null;
  quantityProof: unknown;
  source: {
    sourceRevision?: string | null;
    licenseRevision?: string | null;
    pageIds?: string[];
    factIds?: string[];
  } | null;
  reasons: string[];
};
export type DailyBook = {
  accountKind: "real" | "simulated" | "unknown";
  currency: string | null;
  actualPnl: string | null;
  currentExposurePriceMoveEstimate: string | null;
  complete: boolean;
  reasons: string[];
  positions: DailyPosition[];
};
type Summary = {
  date: string;
  holdings: number;
  books: DailyBook[];
  settlement: string;
  calculation: {
    actualPnlScope: string;
    currentExposureEstimateIsActualPnl: false;
    feesAndFxIncluded: false;
    collectionOnRead: false;
  };
};
const amount = (value: string | null | undefined) => (
  <PrivateAmount>{value ?? "未知"}</PrivateAmount>
);
const kind = {
  real: "真实账户",
  simulated: "模拟账户",
  unknown: "账户类型未知",
};
const day = (value: string | null) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value.split("-").map(Number).join("/")
    : value || "日期未知";
export function DailyActivitySummary({
  session,
  active,
}: {
  session: Session;
  active: boolean;
}) {
  return (
    <SummaryPanel
      key={JSON.stringify([
        session.instance_id,
        session.user.id,
        session.user.role,
        session.receipt_scope,
        session.csrf,
        session.expires_at,
      ])}
      session={session}
      active={active}
    />
  );
}
function SummaryPanel({
  session,
  active,
}: {
  session: Session;
  active: boolean;
}) {
  const [value, setValue] = useState<Summary | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [locked, setLocked] = useState(false);
  const epoch = useRef(0),
    request = useRef<AbortController | null>(null),
    live = useRef(active);
  live.current = active && !locked;
  function clear() {
    epoch.current++;
    request.current?.abort();
    request.current = null;
    setValue(null);
    setError("");
    setBusy(false);
  }
  useEffect(() => {
    if (!active) clear();
    else if (!locked && !document.hidden) void read();
    const visibility = () => {
      if (document.hidden) clear();
      else if (live.current) void read();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      epoch.current++;
      request.current?.abort();
      setBusy(false);
      setValue(null);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [active, locked]);
  async function read() {
    if (!live.current || busy || document.hidden) return;
    const generation = ++epoch.current,
      controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setBusy(true);
    setError("");
    const current = () =>
      live.current &&
      !document.hidden &&
      generation === epoch.current &&
      !controller.signal.aborted;
    try {
      const result = await api<Summary>(
        "/activities/daily-summary",
        { signal: controller.signal },
        session.csrf,
      );
      if (current()) setValue(result);
    } catch (reason) {
      if (current()) {
        if (
          reason instanceof ApiError &&
          ([401, 403].includes(reason.status) ||
            reason.code === "session_changed")
        ) {
          setValue(null);
          setLocked(true);
        }
        setError(reason instanceof Error ? reason.message : "摘要暂不可读取");
      }
    } finally {
      if (current()) {
        setBusy(false);
        request.current = null;
      }
    }
  }
  return (
    <section className="daily-price-summary" aria-label="每日价格影响摘要">
      <div className="activity-section-heading">
        <div>
          <h2>每日价格影响</h2>
          <p className="muted">
            {value?.date ? day(value.date) : "观察日期待核对"}
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="刷新每日价格影响"
          disabled={busy || locked || !active}
          aria-busy={busy}
          onClick={() => void read()}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      <p className="activity-scope-note">
        仅核对证券价格影响，不含费用和汇率；当前持仓估算不代表整个账户的实际当日损益。
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {locked && <p role="status">会话已变化，请重新登录后核对。</p>}
      {!value && !error && !locked && (
        <LoadingPlaceholder label="正在读取已保存证据" compact />
      )}
      {value && (
        <>
          {value.books.length === 0 && (
            <WorkspaceEmpty title="暂无可核对的持仓证据" />
          )}
          {value.books.map((book, index) => (
            <DailySummaryBook
              key={book.accountKind + ":" + book.currency + ":" + index}
              book={book}
            />
          ))}
        </>
      )}
    </section>
  );
}
export function DailySummaryBook({ book }: { book: DailyBook }) {
  const [proof, setProof] = useState<DailyPosition | null>(null),
    [page, setPage] = useState(0);
  const current = Math.min(
      page,
      Math.max(0, Math.ceil(book.positions.length / 20) - 1),
    ),
    reveal = usePageReveal(current);
  useEffect(() => setProof(null), [book]);
  const goTo = (page: number) => {
    reveal.request();
    setPage(page);
  };
  return (
    <section className="daily-summary-book" ref={reveal.ref} tabIndex={-1}>
      <div className="activity-section-heading">
        <h3>
          {kind[book.accountKind] || kind.unknown} ·{" "}
          {book.currency ?? "币种未知"}
        </h3>
        <span className="activity-coverage">
          {book.complete ? "本价格影响范围已核实" : "证据待补齐"}
        </span>
      </div>
      <dl className="activity-metrics">
        <div>
          <dt>已核实证券价格影响</dt>
          <dd>{amount(book.actualPnl)}</dd>
        </div>
        <div>
          <dt>当前持仓价格变动估算</dt>
          <dd>{amount(book.currentExposurePriceMoveEstimate)}</dd>
        </div>
      </dl>
      {!!book.reasons.length && (
        <p className="activity-scope-note">
          {[...new Set(book.reasons.map(dailyReasonLabel))].join(" · ")}
        </p>
      )}
      <div className="portfolio-table daily-summary-table">
        <table>
          <thead>
            <tr>
              <th>证券</th>
              <th>当前数量</th>
              <th>收盘观察</th>
              <th>已核实价格影响</th>
              <th>当前持仓估算</th>
              <th>证据</th>
            </tr>
          </thead>
          <tbody>
            {book.positions
              .slice(current * 20, (current + 1) * 20)
              .map((position) => (
                <tr key={position.recordId}>
                  <td>
                    <MarketBadge market={position.market} />
                    <strong>{position.code}</strong>
                    <small>{position.currency ?? "币种未知"}</small>
                  </td>
                  <td>{amount(position.quantity)}</td>
                  <td>
                    <span>
                      {day(position.previousDate)} ·{" "}
                      {amount(position.previousClose)}
                    </span>
                    <span>
                      {day(position.date)} · {amount(position.close)}
                    </span>
                  </td>
                  <td>{amount(position.actualPnl)}</td>
                  <td>{amount(position.currentExposurePriceMoveEstimate)}</td>
                  <td>
                    <button
                      type="button"
                      className="activity-proof-link"
                      onClick={() => setProof(position)}
                    >
                      {position.reasons.length ? "查看缺失依据" : "查看来源"}
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {book.positions.length > 20 && (
        <div className="workspace-pagination">
          <button
            type="button"
            disabled={!current}
            onClick={() => goTo(current - 1)}
          >
            上一页
          </button>
          <span>
            第{current + 1} / {Math.ceil(book.positions.length / 20)}页 · 已读
            {book.positions.length}条证券
          </span>
          <button
            type="button"
            disabled={(current + 1) * 20 >= book.positions.length}
            onClick={() => goTo(current + 1)}
          >
            下一页
          </button>
        </div>
      )}
      {proof && (
        <Dialog
          title="价格影响来源"
          className="activity-proof-dialog"
          onClose={() => setProof(null)}
        >
          <div className="activity-proof">
            <h3>
              {proof.market} · {proof.code}
            </h3>
            {proof.reasons.length > 0 && (
              <ul>
                {proof.reasons.map((reason, index) => (
                  <li key={index}>{dailyReasonLabel(reason)}</li>
                ))}
              </ul>
            )}
            <dl>
              <dt>记录编号</dt>
              <dd>{proof.recordId}</dd>
              <dt>所属账户</dt>
              <dd>{proof.accountId ?? "未绑定账户"}</dd>
              <dt>行情来源版本</dt>
              <dd>{proof.source?.sourceRevision ?? "未知"}</dd>
              <dt>许可版本</dt>
              <dd>{proof.source?.licenseRevision ?? "未知"}</dd>
              <dt>保留原件</dt>
              <dd>{proof.source?.pageIds?.join(" · ") || "未知"}</dd>
              <dt>价格观察</dt>
              <dd>{proof.source?.factIds?.join(" · ") || "未知"}</dd>
            </dl>
            <details>
              <summary>数量依据与原始状态</summary>
              <pre className="activity-original">
                <PrivateAmount>
                  {JSON.stringify(
                    {
                      quantityProof: proof.quantityProof,
                      reasons: proof.reasons,
                    },
                    null,
                    2,
                  )}
                </PrivateAmount>
              </pre>
            </details>
          </div>
        </Dialog>
      )}
    </section>
  );
}
