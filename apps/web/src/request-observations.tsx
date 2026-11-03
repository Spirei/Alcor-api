import { useEffect, useState } from "react";
import { api } from "./api";
import {
  legacyImportLabel,
  requestSnapshot,
  type RequestSnapshot,
} from "./request-observation-state";

export function RequestObservations() {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>接口请求</summary>
      <RequestDetails visible={open} />
    </details>
  );
}
function RequestDetails({ visible }: { visible: boolean }) {
  const [data, setData] = useState<RequestSnapshot | null>(null),
    [error, setError] = useState("");
  const [period, setPeriod] = useState("today"),
    [status, setStatus] = useState("all"),
    [source, setSource] = useState("all"),
    [method, setMethod] = useState("all"),
    [query, setQuery] = useState("");
  const [page, setPage] = useState(1),
    [anchor, setAnchor] = useState(0),
    [revision, setRevision] = useState(0),
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
    if (!visible || !shown) return;
    let current = true;
    const controller = new AbortController();
    setError("");
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
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [visible, shown, params, revision]);
  useEffect(() => {
    if (!visible || !shown || !live) return;
    const stream = new EventSource("/api/request-logs/events");
    const update = () => {
      setAnchor(0);
      setPage(1);
      setRevision((old) => old + 1);
    };
    stream.addEventListener("change", update);
    stream.onerror = () => {
      stream.close();
      setLive(false);
      setError("实时连接已断开，请重新读取");
    };
    return () => stream.close();
  }, [visible, shown, live]);
  function reset(change: () => void) {
    change();
    setPage(1);
    setAnchor(0);
  }
  return (
    <div className="request-observations">
      <div className="module-actions">
        <select
          aria-label="请求时间"
          value={period}
          onChange={(event) => reset(() => setPeriod(event.target.value))}
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
          onChange={(event) => reset(() => setStatus(event.target.value))}
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
          onChange={(event) => reset(() => setSource(event.target.value))}
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
          onChange={(event) => reset(() => setMethod(event.target.value))}
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
          aria-label="查找接口模板"
          value={query}
          maxLength={120}
          onChange={(event) => reset(() => setQuery(event.target.value))}
        />
        <button
          className="button secondary small"
          onClick={() => reset(() => setRevision((old) => old + 1))}
        >
          重新读取
        </button>
        <label>
          <input
            type="checkbox"
            checked={live}
            onChange={(event) => setLive(event.target.checked)}
          />
          实时
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {data && (
        <>
          <p role="status">{legacyImportLabel(data.legacyImport)}</p>
          <p>
            已观测 {data.summary.total} 次 · 错误 {data.summary.errors} 次 ·
            服务端错误 {data.summary.serverErrors} 次 · 平均{" "}
            {data.summary.averageMs.toFixed(1)} ms
          </p>
          {data.localCollector?.buffered > 0 && (
            <p role="status">请求记录正在写入</p>
          )}
          {data.localCollector?.storageAvailable === false && (
            <p role="status">请求记录存储暂不可用，统计可能不完整</p>
          )}
          {data.rollupPending && (
            <p role="status">
              汇总处理中（{data.aggregateRevision}/{data.revision}）
            </p>
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
                    <td>{new Date(row.at).toLocaleString()}</td>
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
                setAnchor(data.pagination.anchor);
                setPage(data.pagination.page - 1);
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
                setAnchor(data.pagination.anchor);
                setPage(data.pagination.page + 1);
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
