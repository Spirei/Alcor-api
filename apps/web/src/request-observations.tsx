import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "./api";
import { RefreshCw } from "lucide-react";
import { feedDateTime } from "./feed-display";
import {
  legacyImportLabel,
  requestObservationFilters,
  requestObservationSearch,
  requestSnapshot,
  type RequestSnapshot,
} from "./request-observation-state";

export function RequestObservations({
  expanded = false,
  active = true,
}: {
  expanded?: boolean;
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (expanded)
    return (
      <section aria-label="请求观察">
        <RequestDetails visible={active} />
      </section>
    );
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>接口请求</summary>
      <RequestDetails visible={open && active} />
    </details>
  );
}
function RequestDetails({ visible }: { visible: boolean }) {
  const [data, setData] = useState<RequestSnapshot | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const location = useLocation(),
    navigate = useNavigate();
  const { period, status, source, method, query, page, anchor } =
    requestObservationFilters(location.search);
  const update = (
    patch: Partial<ReturnType<typeof requestObservationFilters>>,
  ) =>
    navigate(
      {
        pathname: location.pathname,
        search: requestObservationSearch(location.search, patch),
      },
      { replace: true },
    );
  const updateRef = useRef(update);
  updateRef.current = update;
  const [revision, setRevision] = useState(0),
    [live, setLive] = useState(false);
  const [shown, setShown] = useState(!document.hidden);
  useEffect(() => {
    const update = () => setShown(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const params = new URLSearchParams({
    rPeriod: period,
    rStatus: status,
    rSource: source,
    rMethod: method,
    rQ: query,
    rPage: String(page),
    rAnchor: String(anchor),
  }).toString();
  useEffect(() => {
    if (!visible || !shown) {
      setData(null);
      setBusy(false);
      return;
    }
    let current = true;
    const controller = new AbortController();
    setError("");
    setBusy(true);
    api<{ data: unknown }>(`/request-logs?${params}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (current) setData(requestSnapshot(result.data));
      })
      .catch((cause) => {
        if (current) {
          setData(null);
          setError(cause.message);
        }
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [visible, shown, params, revision]);
  useEffect(() => {
    if (!visible || !shown || !live) return;
    const stream = new EventSource("/api/request-logs/events");
    let current = true;
    const update = () => {
      if (!current || document.hidden) return;
      updateRef.current({ anchor: 0, page: 1 });
      setRevision((old) => old + 1);
    };
    stream.addEventListener("change", update);
    stream.onerror = () => {
      stream.close();
      setLive(false);
      setError("实时连接已断开，请重新读取");
    };
    return () => {
      current = false;
      stream.close();
    };
  }, [visible, shown, live]);
  function reset(patch: Partial<ReturnType<typeof requestObservationFilters>>) {
    setData(null);
    update({ ...patch, page: 1, anchor: 0 });
  }
  return (
    <div className="request-observations">
      <div className="module-actions">
        <select
          aria-label="请求时间"
          value={period}
          onChange={(event) => reset({ period: event.target.value })}
        >
          {[
            ["today", "今天"],
            ["7d", "7天"],
            ["30d", "30天"],
          ].map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="请求结果"
          value={status}
          onChange={(event) => reset({ status: event.target.value })}
        >
          {[
            ["all", "全部结果"],
            ["success", "成功"],
            ["4xx", "4xx"],
            ["5xx", "5xx"],
            ["cancelled", "中断"],
          ].map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="请求来源"
          value={source}
          onChange={(event) => reset({ source: event.target.value })}
        >
          {[
            ["all", "全部来源"],
            ["web", "Web"],
            ["ios", "iOS"],
            ["app", "App"],
            ["other", "其他"],
          ].map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="请求方法"
          value={method}
          onChange={(event) => reset({ method: event.target.value })}
        >
          {[
            "all",
            "GET",
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
            "HEAD",
            "OPTIONS",
            "OTHER",
          ].map((value) => (
            <option key={value} value={value}>
              {value === "all" ? "全部方法" : value}
            </option>
          ))}
        </select>
        <input
          placeholder="查找接口模板"
          aria-label="查找接口模板"
          value={query}
          maxLength={120}
          onChange={(event) => reset({ query: event.target.value })}
        />
        <button
          type="button"
          className="icon-button"
          disabled={busy}
          aria-busy={busy}
          aria-label="刷新请求观察"
          onClick={() => {
            reset({});
            setRevision((old) => old + 1);
          }}
        >
          <RefreshCw size={18} />
        </button>
        <div className="activity-live-setting">
          <span>实时</span>
          <button
            type="button"
            className="appearance-switch"
            role="switch"
            aria-label="实时请求观察"
            aria-checked={live}
            onClick={() => setLive((value) => !value)}
          >
            <span className="appearance-switch-track" aria-hidden="true">
              <span />
            </span>
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">正在读取请求观察…</p>}
      {data && (
        <>
          <RequestObservationMetrics data={data} />
          <details className="activity-scope-proof">
            <summary>统计范围</summary>
            <p>仅统计当前服务已保留的请求观察，不代表所有客户端或完整历史。</p>
            <p>{legacyImportLabel(data.legacyImport)}</p>
            <p>
              汇总修订 {data.aggregateRevision} · 记录修订 {data.revision}
            </p>
          </details>
          {data.localCollector?.buffered > 0 && (
            <p role="status">请求记录正在写入</p>
          )}
          {data.localCollector?.storageAvailable === false && (
            <p role="status">请求记录存储暂不可用，统计可能不完整</p>
          )}
          {data.rollupPending && (
            <p role="status">统计汇总处理中，数值暂不展示。</p>
          )}
          {data.detailGap && <p role="status">该页部分明细已超过保留范围</p>}
          {data.lostBuffered > 0 && (
            <p role="status">
              缓冲丢弃 {data.lostBuffered}{" "}
              条，部分可能已提交；进程意外中断前的缓冲完整性未知
            </p>
          )}
          <div className="portfolio-table">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>接口</th>
                  <th>方法</th>
                  <th>来源</th>
                  <th>状态</th>
                  <th>耗时</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map((row) => (
                  <tr key={row.id}>
                    <td>{feedDateTime(row.at)}</td>
                    <td>{row.path}</td>
                    <td>{row.method}</td>
                    <td>{row.source}</td>
                    <td>{row.status}</td>
                    <td>{row.duration.toFixed(1)} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.logs.length && <p>暂无请求明细</p>}
          </div>
          <div className="module-actions">
            <button
              className="button secondary small"
              disabled={data.pagination.page <= 1}
              onClick={() => {
                update({
                  anchor: data.pagination.anchor,
                  page: data.pagination.page - 1,
                });
              }}
            >
              上一页
            </button>
            <span>
              {data.pagination.page} /{" "}
              {Math.max(1, Math.ceil(data.pagination.total / 20))}
            </span>
            <button
              className="button secondary small"
              disabled={data.pagination.page * 20 >= data.pagination.total}
              onClick={() => {
                update({
                  anchor: data.pagination.anchor,
                  page: data.pagination.page + 1,
                });
              }}
            >
              下一页
            </button>
          </div>
          <details>
            <summary>按接口汇总</summary>
            <div className="portfolio-table">
              <table>
                <thead>
                  <tr>
                    <th>接口</th>
                    <th>方法</th>
                    <th>次数</th>
                    <th>错误</th>
                    <th>平均耗时</th>
                  </tr>
                </thead>
                <tbody>
                  {data.endpoints.map((row) => (
                    <tr key={row.path + row.method}>
                      <td>{row.path}</td>
                      <td>{row.method}</td>
                      <td>{row.count}</td>
                      <td>{row.errors}</td>
                      <td>{row.averageMs.toFixed(1)} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <details>
            <summary>按{data.chartUnit === "hour" ? "小时" : "天"}汇总</summary>
            <div className="portfolio-table">
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>次数</th>
                    <th>错误</th>
                  </tr>
                </thead>
                <tbody>
                  {data.chart.map((row) => (
                    <tr key={row.key}>
                      <td>{row.key}</td>
                      <td>{row.count}</td>
                      <td>{row.errors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

export function RequestObservationMetrics({
  data,
}: {
  data: Pick<RequestSnapshot, "summary" | "rollupPending">;
}) {
  return (
    <dl className="activity-metrics request-metrics">
      {[
        { label: "已观测请求", value: data.summary.total },
        { label: "错误", value: data.summary.errors },
        { label: "服务端错误", value: data.summary.serverErrors },
        {
          label: "平均耗时",
          value: `${data.summary.averageMs.toFixed(1)} ms`,
        },
      ].map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{data.rollupPending ? "待汇总" : item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
