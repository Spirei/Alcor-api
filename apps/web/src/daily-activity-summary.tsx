import { PrivateAmount, MarketBadge } from "./financial-display";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
type Position = {
  recordId: string; accountId: string | null; market: string; code: string; quantity: string | null;
  currentExposurePriceMoveEstimate: string | null; actualPnl: string | null;
  previousDate: string | null; date: string | null; previousClose: string | null; close: string | null;
  priceDifference: string | null; currency: string | null; quantityProof: unknown;
  source: { sourceRevision?: string | null; licenseRevision?: string | null; pageIds?: string[]; factIds?: string[] } | null;
  reasons: string[];
};
type Book = { accountKind: "real" | "simulated" | "unknown"; currency: string | null; actualPnl: string | null; currentExposurePriceMoveEstimate: string | null; complete: boolean; reasons: string[]; positions: Position[] };
type Summary = { date: string; holdings: number; books: Book[]; settlement: string; calculation: { actualPnlScope: string; currentExposureEstimateIsActualPnl: false; feesAndFxIncluded: false; collectionOnRead: false } };
const amount = (value: string | null | undefined) => <PrivateAmount>{value ?? "未知"}</PrivateAmount>;
const kind = { real: "真实账户", simulated: "模拟账户", unknown: "账户类型未知" };
export function DailyActivitySummary({ session, active }: { session: Session; active: boolean }) {
  return <SummaryPanel key={JSON.stringify([session.instance_id, session.user.id, session.user.role, session.receipt_scope, session.csrf, session.expires_at])} session={session} active={active} />;
}
function SummaryPanel({ session, active }: { session: Session; active: boolean }) {
  const [open, setOpen] = useState(false), [value, setValue] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [locked, setLocked] = useState(false);
  const epoch = useRef(0), request = useRef<AbortController | null>(null), live = useRef(active);
  live.current = active && open && !locked;
  function clear() { epoch.current++; request.current?.abort(); request.current = null; setValue(null); setError(""); setBusy(false); }
  useEffect(() => { if (!active || !open) clear(); return () => { epoch.current++; request.current?.abort(); }; }, [active, open]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) clear(); };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);
  async function read() {
    if (!live.current || busy || document.hidden) return;
    const generation = ++epoch.current, controller = new AbortController();
    request.current?.abort(); request.current = controller; setBusy(true); setError(""); setValue(null);
    const current = () => live.current && !document.hidden && generation === epoch.current && !controller.signal.aborted;
    try {
      const result = await api<Summary>("/activities/daily-summary", { signal: controller.signal }, session.csrf);
      if (current()) setValue(result);
    } catch (reason) {
      if (current()) {
        if (reason instanceof ApiError && ([401, 403].includes(reason.status) || reason.code === "session_changed")) { setValue(null); setLocked(true); }
        setError(reason instanceof Error ? reason.message : "摘要暂不可读取");
      }
    } finally { if (current()) { setBusy(false); request.current = null; } }
  }
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>每日价格影响摘要</summary>
    {open && <>
      <button className="button secondary small" disabled={busy || locked || !active} onClick={() => void read()}>读取已保存证据</button>
      {error && <p role="alert">{error}</p>}
      {value && <>
        <p>{value.date} · {value.settlement}</p>
        <p>已核实价格影响不含费用和汇率；当前持仓估算不代表实际当日损益。</p>
        {value.books.length === 0 && <p>尚无可展示的账户与原币证据</p>}
        {value.books.map((book, index) => <section key={book.accountKind + ":" + book.currency + ":" + index}>
          <h3>{kind[book.accountKind]} · {book.currency ?? "币种未知"}</h3>
          <dl className="portfolio-proof"><div><dt>已核实证券价格影响</dt><dd>{amount(book.actualPnl)}</dd></div><div><dt>当前持仓价格变动估算</dt><dd>{amount(book.currentExposurePriceMoveEstimate)}</dd></div><div><dt>证据覆盖</dt><dd>{book.complete ? "本证券价格影响范围已核实" : "证据不完整"}</dd></div></dl>
          {book.reasons.length > 0 && <ul>{book.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>}
          <div className="portfolio-table"><table><thead><tr><th>证券／账户</th><th>当前数量</th><th>收盘观察</th><th>已核实价格影响</th><th>当前持仓估算</th><th>缺失证据</th></tr></thead><tbody>{book.positions.map(position => <tr key={position.recordId}>
            <td><MarketBadge market={position.market}/>: {position.code}<br />{position.accountId ?? "未绑定账户"}<br />{position.currency ?? "币种未知"}</td><td>{amount(position.quantity)}</td>
            <td>{position.previousDate ?? "前日未知"}：{amount(position.previousClose)}<br />{position.date ?? "日期未知"}：{amount(position.close)}</td>
            <td>{amount(position.actualPnl)}</td><td>{amount(position.currentExposurePriceMoveEstimate)}</td><td>{position.reasons.join(" · ") || "—"}<details><summary>来源证据</summary><dl><dt>记录</dt><dd>{position.recordId}</dd><dt>行情来源版本</dt><dd>{position.source?.sourceRevision ?? "未知"}</dd><dt>许可版本</dt><dd>{position.source?.licenseRevision ?? "未知"}</dd><dt>原件</dt><dd>{position.source?.pageIds?.join(" · ") || "未知"}</dd><dt>观察</dt><dd>{position.source?.factIds?.join(" · ") || "未知"}</dd></dl></details></td>
          </tr>)}</tbody></table></div>
        </section>)}
      </>}
    </>}
  </details>;
}
