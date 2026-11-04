import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { requestId } from "./request-id";
import { WorkspaceTabs, WorkspaceEmpty } from "./workspace-ui";
import {
  MarketAssetDetails,
  MarketEarningsCalendar,
} from "./market-asset-details";

type Item = {
  market?: string;
  code?: string;
  symbol?: string;
  name?: string;
  nameZh?: string;
  price?: string | number | null;
  changePct?: string | number | null;
  volume?: string | number | null;
  amount?: string | number | null;
  marketCap?: string | number | null;
  currency?: string | null;
};
type IndexGroup = {
  market: string;
  label: string;
  flag: string;
  open: boolean | null;
  indices: {
    symbol?: string;
    name: string;
    open: number | null;
    latest: number | null;
    changePct: number | null;
    time: string | null;
    kind: string;
    proxy: false;
    extra?: string;
  }[];
};
type Discovery = {
  groups?: IndexGroup[];
  query: Record<string, unknown>;
  revision: string | null;
  state: string;
  sourceRevision: string | null;
  licenseRevision: string | null;
  source: string;
  observedAt: string | null;
  coverage: {
    scope: string;
    complete: boolean;
    providerTotal: number | null;
    observedCount: number;
  };
  items: Item[];
  pagination: {
    limit: number;
    offset: number;
    total?: number | null;
    hasMore?: boolean;
  };
  originals: { id: string; sha256: string; path: string }[];
};
type Version = {
  revision: string;
  usable: boolean;
  policy: { source: string; purposes: string[]; markets: string[] } | null;
};
type Receipt = { requestId: string; state: string; message?: string };
const root = "/market/discovery";
export function MarketReferencePanel(props: {
  session: Session;
  active?: boolean;
  initialKind?: string;
}) {
  const s = props.session;
  return (
    <Content
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
function Content({
  session,
  active = true,
  initialKind = "search",
}: {
  session: Session;
  active?: boolean;
  initialKind?: string;
}) {
  const key =
    "market-discovery:" +
    JSON.stringify([
      session.instance_id,
      session.user.id,
      session.user.role,
      session.receipt_scope,
    ]);
  const [sourceRefresh, setSourceRefresh] = useState(0);
  const [kind, setKind] = useState(initialKind),
    [market, setMarket] = useState("US"),
    [q, setQ] = useState(""),
    [metric, setMetric] = useState("volume"),
    [source, setSource] = useState(""),
    [sources, setSources] = useState<Version[]>([]),
    [data, setData] = useState<Discovery | null>(null),
    [entity, setEntity] = useState<{
      market: string;
      code: string;
      name?: string;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [receipt, setReceipt] = useState<Receipt | null>(null);
  const [pending, setPending] = useState<string | null>(() => {
    try {
      const id = sessionStorage.getItem(key);
      return id &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          id,
        )
        ? id
        : null;
    } catch {
      return null;
    }
  });
  const epoch = useRef(0),
    alive = useRef(active),
    reads = useRef(new Set<AbortController>());
  const retire = useCallback(
    (failure: unknown) => {
      if (failure instanceof ApiError && [401, 403].includes(failure.status)) {
        epoch.current++;
        setData(null);
        setEntity(null);
        setSources([]);
        setReceipt(null);
        setPending(null);
        try {
          sessionStorage.removeItem(key);
        } catch {
          /* Retire memory. */
        }
      }
      setError(failure instanceof Error ? failure.message : "资产目录读取失败");
    },
    [key],
  );
  function invalidate() {
    epoch.current++;
    for (const controller of reads.current) controller.abort();
    reads.current.clear();
    setData(null);
    setReceipt(null);
    setError("");
  }
  useEffect(() => {
    if (!active || document.hidden) return;
    alive.current = true;
    const controller = new AbortController(),
      run = epoch.current;
    void api<{ versions: Version[] }>("/market/sources", {
      signal: controller.signal,
    })
      .then((value) => {
        if (alive.current && run === epoch.current) setSources(value.versions);
      })
      .catch((failure) => {
        if (!controller.signal.aborted && run === epoch.current)
          retire(failure);
      });
    const hide = () => {
      epoch.current++;
      for (const current of reads.current) current.abort();
      reads.current.clear();
      setData(null);
      setEntity(null);
      setReceipt(null);
      setBusy(false);
      if (!document.hidden) setSourceRefresh((value) => value + 1);
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      alive.current = false;
      epoch.current++;
      controller.abort();
      for (const current of reads.current) current.abort();
      reads.current.clear();
      document.removeEventListener("visibilitychange", hide);
      setBusy(false);
    };
  }, [active, retire, sourceRefresh]);
  const purpose =
      "discovery." + kind + (kind === "ranking" ? "." + metric : ""),
    eligible = sources.filter(
      (value) => value.usable && value.policy?.purposes.includes(purpose),
    );
  function query() {
    return {
      kind,
      market,
      ...(kind === "search" ? { q: q.trim() } : {}),
      ...(kind === "ranking" ? { metric } : {}),
    };
  }
  async function read(offset = 0) {
    if (busy || !active || document.hidden) return;
    const run = epoch.current,
      controller = new AbortController();
    reads.current.add(controller);
    setBusy(true);
    setError("");
    const params = new URLSearchParams({
      kind,
      market,
      limit: "25",
      offset: String(offset),
    });
    if (kind === "search") params.set("q", q.trim());
    if (kind === "ranking") params.set("metric", metric);
    if (source) params.set("source_revision", source);
    if (offset && data?.revision) params.set("revision", data.revision);
    try {
      const value = await api<Discovery>(root + "?" + params, {
        signal: controller.signal,
      });
      if (alive.current && run === epoch.current) setData(value);
    } catch (failure) {
      if (!controller.signal.aborted && run === epoch.current) {
        if (failure instanceof ApiError && failure.status === 409)
          setData(null);
        retire(failure);
      }
    } finally {
      reads.current.delete(controller);
      if (run === epoch.current) setBusy(false);
    }
  }
  useEffect(() => {
    // Read retained observations only; collection remains an explicit licensed action.
    if (active && kind !== "search" && !document.hidden) void read();
  }, [active, kind, market, metric, source, sourceRefresh]);
  function remember(id: string | null) {
    try {
      if (id) sessionStorage.setItem(key, id);
      else sessionStorage.removeItem(key);
      setPending(id);
      return true;
    } catch {
      if (!id) setPending(null);
      else setError("无法保留原请求编号，未登记来源采集");
      return !id;
    }
  }
  function accept(value: Receipt, id: string) {
    if (value.requestId !== id) throw new Error("原采集回执不匹配");
    setReceipt(value);
    if (
      [
        "completed",
        "failed",
        "closed",
        "rejected",
        "observed",
        "unavailable",
        "retained_unavailable",
      ].includes(value.state)
    )
      remember(null);
  }
  async function collect() {
    if (
      busy ||
      pending ||
      document.hidden ||
      !eligible.some((value) => value.revision === source)
    )
      return;
    const id = requestId();
    if (!remember(id)) return;
    const run = epoch.current;
    setBusy(true);
    setError("");
    try {
      const value = await api<Receipt>(
        root + "/collect",
        {
          method: "POST",
          body: JSON.stringify({
            requestId: id,
            sourceRevision: source,
            query: query(),
          }),
        },
        session.csrf,
      );
      if (alive.current && run === epoch.current) accept(value, id);
    } catch (failure) {
      if (run === epoch.current) retire(failure);
    } finally {
      if (run === epoch.current) setBusy(false);
    }
  }
  async function resolve() {
    if (!pending || busy || document.hidden) return;
    const id = pending,
      run = epoch.current;
    setBusy(true);
    setError("");
    try {
      const value = await api<Receipt>(root + "/operations/" + id);
      if (alive.current && run === epoch.current) accept(value, id);
    } catch (failure) {
      if (run === epoch.current) retire(failure);
    } finally {
      if (run === epoch.current) setBusy(false);
    }
  }
  async function original(id: string, path?: string) {
    if (!data?.sourceRevision) return;
    const controller = new AbortController(),
      run = epoch.current;
    reads.current.add(controller);
    try {
      const params = new URLSearchParams({
        source_revision: data.sourceRevision,
      });
      const safePath =
        path &&
        /^\/api\/market\/discovery\/originals\/[a-f0-9-]+\?source_revision=[a-f0-9-]+$/i.test(
          path,
        )
          ? path
          : "/api" +
            root +
            "/originals/" +
            encodeURIComponent(id) +
            "?" +
            params;
      const response = await fetch(safePath, {
        credentials: "same-origin",
        headers: { "X-CSRF-Token": session.csrf },
        signal: controller.signal,
      });
      if (!response.ok)
        throw new ApiError(response.status, "来源原件暂时无法读取");
      const blob = await response.blob();
      if (!alive.current || run !== epoch.current || document.hidden) return;
      const url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `discovery-${id}.bin`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (failure) {
      if (!controller.signal.aborted && run === epoch.current) retire(failure);
    } finally {
      reads.current.delete(controller);
    }
  }
  return (
    <section className="panel">
      <WorkspaceTabs
        label="全球市场分类"
        value={kind}
        disabled={busy}
        items={[
          { value: "top", label: "市值与热门资产" },
          { value: "indices", label: "全球指数" },
          { value: "search", label: "资产搜索" },
          { value: "ranking", label: "市场榜单" },
          { value: "earnings", label: "财报日历" },
        ]}
        onChange={(value) => {
          invalidate();
          setKind(value);
          setMarket(value === "indices" ? "ALL" : "US");
        }}
      />
      {kind === "earnings" ? (
        <MarketEarningsCalendar
          session={session}
          sources={sources}
          onSelect={setEntity}
        />
      ) : (
        <>
          <div className="form-grid">
            <label>
              市场
              <select
                value={market}
                disabled={busy}
                onChange={(event) => {
                  invalidate();
                  setMarket(event.target.value);
                }}
              >
                {[
                  "US",
                  "HK",
                  "CN",
                  "JP",
                  "KR",
                  ...(kind === "indices" ? ["ALL"] : []),
                ].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            {kind === "search" && (
              <label>
                代码或名称
                <input
                  value={q}
                  maxLength={100}
                  disabled={busy}
                  onChange={(event) => {
                    invalidate();
                    setQ(event.target.value);
                  }}
                />
              </label>
            )}
            {kind === "ranking" && (
              <label>
                排序依据
                <select
                  value={metric}
                  onChange={(event) => {
                    invalidate();
                    setMetric(event.target.value);
                  }}
                  disabled={busy}
                >
                  <option value="volume">来源成交量</option>
                  <option value="amount">来源成交额</option>
                </select>
              </label>
            )}
            <label>
              许可来源
              <select
                value={source}
                onChange={(event) => {
                  invalidate();
                  setSource(event.target.value);
                }}
                disabled={busy || !!pending}
              >
                <option value="">未指定来源版本</option>
                {eligible.map((value) => (
                  <option key={value.revision} value={value.revision}>
                    {value.policy?.source} · {value.revision.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="portfolio-actions">
            <button
              disabled={busy}
              onClick={() => setSourceRefresh((value) => value + 1)}
            >
              刷新许可来源
            </button>
            <button
              disabled={busy || (kind === "search" && !q.trim())}
              onClick={() => void read()}
            >
              读取已有观察
            </button>
            <button
              disabled={
                busy ||
                !!pending ||
                !eligible.some((value) => value.revision === source) ||
                (kind === "search" && !q.trim())
              }
              onClick={() => void collect()}
            >
              按当前许可采集一次
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
          {busy && <p role="status">正在读取…</p>}
          {receipt && (
            <p role="status">
              {receipt.state}
              {receipt.message ? " · " + receipt.message : ""}
            </p>
          )}
          {pending && (
            <div>
              <p role="status">来源请求结果待核对</p>
              <code>{pending}</code>
              <button disabled={busy} onClick={() => void resolve()}>
                查询原请求
              </button>
            </div>
          )}
          {data && (
            <>
              {data.state !== "observed" ? (
                <WorkspaceEmpty
                  title={
                    data.state === "retained_unavailable"
                      ? "原来源保留，当前许可不可读取"
                      : "暂无已观察来源记录"
                  }
                  description="已有观察会显示在这里；采集需要明确选择有效许可来源。"
                />
              ) : (
                <>
                  <p>
                    {data.source} · {data.observedAt ?? "观察时间未知"} ·{" "}
                    {data.coverage.observedCount}条观察
                    {data.coverage.complete
                      ? " · 当前来源页已完整"
                      : " · 来源覆盖未完整核实"}
                  </p>
                  {data.groups && (
                    <>
                      {data.groups.map((group) => (
                        <section key={group.market}>
                          <h3>{group.label || group.market}</h3>
                          <p>
                            {group.open === null
                              ? "来源开市状态未知"
                              : group.open
                                ? "来源标记开市"
                                : "来源标记休市"}
                          </p>
                          <div className="workspace-table">
                            <table>
                              <thead>
                                <tr>
                                  <th>指数 / 来源情绪值</th>
                                  <th>来源开盘</th>
                                  <th>来源最新值</th>
                                  <th>来源涨跌幅</th>
                                  <th>来源时间</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.indices.map((item, index) => (
                                  <tr
                                    key={
                                      (item.symbol || item.name) + ":" + index
                                    }
                                  >
                                    <td>
                                      {item.name}
                                      <small>
                                        {item.symbol || "代码未知"} ·{" "}
                                        {item.kind === "sentiment"
                                          ? "来源情绪指标"
                                          : "真实指数"}
                                      </small>
                                    </td>
                                    <td>{item.open ?? "未知"}</td>
                                    <td>{item.latest ?? "未知"}</td>
                                    <td>{item.changePct ?? "未知"}</td>
                                    <td>{item.time ?? "未知"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {!group.indices.length && <p>该分组暂无已许可观察</p>}
                        </section>
                      ))}
                    </>
                  )}
                  {kind !== "indices" && (
                    <div className="workspace-table">
                      <table>
                        <thead>
                          <tr>
                            <th>资产</th>
                            <th>市场</th>
                            <th>来源价格</th>
                            <th>涨跌幅</th>
                            <th>来源成交量</th>
                            <th>来源成交额</th>
                            {kind === "top" && <th>市值（来源口径）</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {data.items.map((row, index) => (
                            <tr
                              key={
                                (row.market || "") +
                                ":" +
                                (row.code || row.symbol || index)
                              }
                            >
                              <td>
                                <button
                                  disabled={
                                    !row.market || !(row.code || row.symbol)
                                  }
                                  onClick={() =>
                                    setEntity({
                                      market: row.market!,
                                      code: row.code || row.symbol!,
                                      name: row.nameZh || row.name,
                                    })
                                  }
                                >
                                  {row.nameZh ||
                                    row.name ||
                                    row.code ||
                                    row.symbol ||
                                    "名称未知"}
                                </button>
                                <small>
                                  {row.code || row.symbol || "代码未知"}
                                </small>
                              </td>
                              <td>{row.market ?? "未知"}</td>
                              <td>
                                {row.price ?? "未知"} {row.currency ?? ""}
                              </td>
                              <td>{row.changePct ?? "未知"}</td>
                              <td>{row.volume ?? "未知"}</td>
                              <td>{row.amount ?? "未知"}</td>
                              {kind === "top" && (
                                <td>{row.marketCap ?? "未知"}</td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="portfolio-actions">
                    <button
                      disabled={busy || !data.pagination.offset}
                      onClick={() =>
                        void read(
                          Math.max(
                            0,
                            data.pagination.offset - data.pagination.limit,
                          ),
                        )
                      }
                    >
                      上一页
                    </button>
                    <button
                      disabled={
                        busy ||
                        !data.revision ||
                        !(
                          data.pagination.hasMore ??
                          (data.pagination.total !== undefined &&
                            data.pagination.total !== null &&
                            data.pagination.offset + data.items.length <
                              data.pagination.total)
                        )
                      }
                      onClick={() =>
                        void read(
                          data.pagination.offset + data.pagination.limit,
                        )
                      }
                    >
                      下一页
                    </button>
                  </div>
                  <details>
                    <summary>来源原件</summary>
                    <p>
                      {data.sourceRevision} · {data.licenseRevision}
                    </p>
                    {data.originals.map((page) => (
                      <button
                        key={page.id}
                        onClick={() => void original(page.id, page.path)}
                      >
                        下载原页 {page.id}
                      </button>
                    ))}
                  </details>
                </>
              )}
            </>
          )}
        </>
      )}
      <details>
        <summary>按明确代码查看资料</summary>
        <form
          className="portfolio-actions"
          onSubmit={(event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget),
              code = String(fields.get("code") || "")
                .trim()
                .toUpperCase(),
              selectedMarket = String(fields.get("market") || "");
            if (code) setEntity({ market: selectedMarket, code });
          }}
        >
          <label>
            市场
            <select name="market">
              {["US", "HK", "CN", "JP", "KR", "SG", "ASSET"].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            代码
            <input name="code" maxLength={40} required />
          </label>
          <button>查看资料</button>
        </form>
      </details>
      {entity && (
        <MarketAssetDetails
          session={session}
          entity={entity}
          sources={sources}
        />
      )}
    </section>
  );
}
