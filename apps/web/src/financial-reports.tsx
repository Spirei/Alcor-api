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
import {
  ReportLifetime,
  reportScope,
  reportStorageKey,
} from "./financial-report-lifetime";
import { requestId } from "./request-id";
import { ReportMediaAliases } from "./report-media-aliases";

type Report = {
  id: string;
  market: string;
  exchange: string;
  companyCode: string;
  companyName: string;
  fiscalYear: number;
  fiscalPeriod: string;
  reportType: string;
  fileName: string;
  fileSize: number;
  fileUrl: string;
  createdAt: string;
};
type Catalog = {
  reports: Report[];
  revision: number;
  historicalCoverageKnown: false;
};
type Receipt = {
  requestId: string;
  state: "completed" | "closed";
  report?: Report;
  deleted?: boolean;
  revision?: number;
};
const blank = {
  market: "",
  exchange: "",
  code: "",
  companyName: "",
  fiscalYear: "",
  fiscalPeriod: "",
  reportType: "",
};
const labels: Record<keyof typeof blank, string> = {
  market: "市场",
  exchange: "交易所",
  code: "股票代码",
  companyName: "公司名称",
  fiscalYear: "财年",
  fiscalPeriod: "报告期",
  reportType: "财报类型",
};

export function FinancialReportsPage({
  session,
  active = true,
}: {
  session: Session;
  active?: boolean;
}) {
  if (session.user.role !== "admin") return <p role="alert">需要管理员权限</p>;
  const scope = reportScope(session);
  return (
    <ReportSession
      key={JSON.stringify([scope, session.csrf, session.expires_at])}
      session={session}
      active={active}
      scope={scope}
    />
  );
}
function ReportSession({
  session,
  active,
  scope,
}: {
  session: Session;
  active: boolean;
  scope: string;
}) {
  const [filters, setFilters] = useState({
    market: "",
    exchange: "",
    code: "",
  });
  const [query, setQuery] = useState("");
  const [listing, setListing] = useState<Catalog | null>(null);
  const key = reportStorageKey(scope);
  const [pending, setPending] = useState<string | null>(null);
  const [fields, setFields] = useState(blank);
  const [file, setFile] = useState<File | null>(null);
  const [deleting, setDeleting] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [locked, setLocked] = useState(false);
  const [visible, setVisible] = useState(
    typeof document === "undefined" || !document.hidden,
  );
  const fileInput = useRef<HTMLInputElement>(null);
  const reads = useRef(0),
    working = useRef(false);
  const [lifetime] = useState(
    () =>
      new ReportLifetime(
        () => apiSessionSnapshot().csrf === session.csrf,
        () => !document.hidden,
      ),
  );
  const clearFile = useCallback(() => {
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
  }, []);
  const pause = useCallback(() => {
    lifetime.pause();
    ++reads.current;
    working.current = false;
    setBusy(false);
    clearFile();
    setDeleting(null);
  }, [lifetime, clearFile]);
  const retire = useCallback(() => {
    pause();
    setLocked(true);
    setListing(null);
    setFields(blank);
    setFilters({ market: "", exchange: "", code: "" });
    setQuery("");
    setNotice("");
    setPending(null);
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* in-memory contents are already retired */
    }
  }, [key, pause]);
  function fail(reason: unknown) {
    setError(reason instanceof Error ? reason.message : "操作失败");
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
    setBusy(false);
    return pause;
  }, [active, visible, locked, lifetime, pause]);
  useEffect(() => {
    try {
      const value = sessionStorage.getItem(key);
      if (
        value &&
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)
      )
        throw Error("原操作编号无效");
      setPending(value);
    } catch {
      setError("原操作编号无法读取");
      setLocked(true);
    }
    setFile(null);
    setFilters({ market: "", exchange: "", code: "" });
    setQuery("");
    setFields(blank);
    setDeleting(null);
    setNotice("");
  }, [key]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) pause();
      setVisible(!document.hidden);
    };
    document.addEventListener("visibilitychange", hide);
    const changed = () => {
      retire();
      setError("登录身份已变化，请重新核对");
    };
    window.addEventListener("alcor:session-changed", changed);
    window.addEventListener("alcor:session-expired", changed);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("alcor:session-changed", changed);
      window.removeEventListener("alcor:session-expired", changed);
    };
  }, [pause, retire]);
  async function load() {
    const ticket = lifetime.begin();
    if (!ticket || locked) return;
    const read = ++reads.current;
    try {
      const value = await api<Catalog>("/financial-reports" + query, {
        signal: ticket.signal,
      });
      if (ticket.current() && read === reads.current) {
        setListing(value);
        setError("");
      }
    } catch (reason) {
      if (apiSessionSnapshot().csrf !== session.csrf) retire();
      else if (
        ticket.current() &&
        (read === reads.current ||
          (reason instanceof ApiError && [401, 403].includes(reason.status)))
      )
        fail(reason);
    } finally {
      ticket.finish();
    }
  }
  useEffect(() => {
    if (active && visible && !locked) void load();
  }, [query, active, visible, locked]);
  const resource = {
    data: listing,
    error: "",
    reload: () => {
      void load();
    },
  };
  function accept(result: Receipt, id: string) {
    if (
      result.requestId !== id ||
      !["completed", "closed"].includes(result.state)
    )
      throw Error("原财报操作回执不匹配");
    sessionStorage.removeItem(key);
    setPending(null);
    setNotice(
      result.state === "closed"
        ? "原操作已关闭"
        : result.deleted
          ? "财报文件已删除"
          : "财报文件已保存",
    );
    resource.reload();
  }
  async function execute(kind: "upload" | "delete", report?: Report) {
    if (
      pending ||
      working.current ||
      locked ||
      !resource.data ||
      (kind === "upload" && !file)
    )
      return;
    const ticket = lifetime.begin();
    if (!ticket) return;
    working.current = true;
    const id = requestId();
    setError("");
    setNotice("");
    try {
      sessionStorage.setItem(key, id);
    } catch {
      setError("原操作编号无法保存");
      working.current = false;
      ticket.finish();
      return;
    }
    setPending(id);
    setBusy(true);
    setDeleting(null);
    const source = file;
    setFile(null);
    try {
      let result: Receipt;
      if (kind === "upload" && source) {
        const form = new FormData();
        Object.entries(fields).forEach(([name, value]) =>
          form.set(name, value),
        );
        form.set("file", source);
        form.set("requestId", id);
        form.set("expectedRevision", String(resource.data.revision));
        result = await api<Receipt>(
          "/financial-reports",
          { method: "POST", body: form, signal: ticket.signal },
          session.csrf,
          300000,
        );
      } else if (report) {
        result = await api<Receipt>(
          `/financial-reports/${encodeURIComponent(report.id)}?requestId=${id}&expectedRevision=${resource.data.revision}`,
          { method: "DELETE", signal: ticket.signal },
          session.csrf,
        );
      } else throw Error("财报操作无效");
      if (ticket.current()) accept(result, id);
    } catch (reason) {
      if (apiSessionSnapshot().csrf !== session.csrf) {
        retire();
        return;
      }
      if (!ticket.current()) return;
      fail(reason);
      if (
        reason instanceof ApiError &&
        reason.code !== "session_changed" &&
        [400, 401, 403, 409, 413, 422, 429].includes(reason.status)
      ) {
        sessionStorage.removeItem(key);
        setPending(null);
      }
    } finally {
      if (ticket.current()) {
        working.current = false;
        setBusy(false);
      }
      ticket.finish();
    }
  }
  async function recover(close = false) {
    if (!pending || working.current || locked) return;
    const ticket = lifetime.begin();
    if (!ticket) return;
    working.current = true;
    const id = pending;
    setBusy(true);
    setError("");
    try {
      const result = await api<Receipt>(
        `/financial-reports/operations/${id}${close ? "/close" : ""}`,
        close
          ? { method: "POST", signal: ticket.signal }
          : { signal: ticket.signal },
        close ? session.csrf : undefined,
      );
      if (ticket.current()) accept(result, id);
    } catch (reason) {
      if (apiSessionSnapshot().csrf !== session.csrf) {
        retire();
        return;
      }
      if (ticket.current()) fail(reason);
    } finally {
      if (ticket.current()) {
        working.current = false;
        setBusy(false);
      }
      ticket.finish();
    }
  }
  if (locked)
    return (
      <section>
        <h1>财报文件</h1>
        <p role="alert">{error || "访问权限已变化，请重新核对"}</p>
      </section>
    );
  if (!active || !visible) return <section aria-hidden="true" />;
  return (
    <section className="page-section">
      <div className="section-heading">
        <h1>财报文件</h1>
        <button onClick={() => resource.reload()} disabled={busy}>
          刷新
        </button>
      </div>
      {(error || resource.error) && (
        <p role="alert">{error || resource.error}</p>
      )}
      {notice && <p role="status">{notice}</p>}
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          const search = new URLSearchParams();
          Object.entries(filters).forEach(([name, value]) => {
            if (value.trim()) search.set(name, value.trim());
          });
          setQuery(search.size ? "?" + search.toString() : "");
        }}
      >
        {(Object.keys(filters) as (keyof typeof filters)[]).map((name) => (
          <label key={name}>
            {labels[name]}
            <input
              value={filters[name]}
              maxLength={40}
              onChange={(event) =>
                setFilters({ ...filters, [name]: event.target.value })
              }
            />
          </label>
        ))}
        <button type="submit" disabled={busy}>
          筛选
        </button>
      </form>
      {pending && (
        <div className="panel">
          <p>操作结果待核对</p>
          <button disabled={busy} onClick={() => void recover()}>
            查询原操作
          </button>
          <button disabled={busy} onClick={() => void recover(true)}>
            关闭原操作
          </button>
        </div>
      )}
      <form
        className="panel"
        onSubmit={(event) => {
          event.preventDefault();
          void execute("upload");
        }}
      >
        <div className="form-grid">
          {(Object.keys(blank) as (keyof typeof blank)[]).map((name) => (
            <label key={name}>
              {labels[name]}
              <input
                value={fields[name]}
                required={!["companyName", "reportType"].includes(name)}
                maxLength={
                  name === "fiscalYear"
                    ? 4
                    : name === "companyName" || name === "reportType"
                      ? 500
                      : 40
                }
                inputMode={name === "fiscalYear" ? "numeric" : undefined}
                onChange={(event) =>
                  setFields({ ...fields, [name]: event.target.value })
                }
              />
            </label>
          ))}
        </div>
        <label>
          文件
          <input
            ref={fileInput}
            key={pending || "file"}
            type="file"
            accept=".pdf,.json,.csv"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
        </label>
        <button
          type="submit"
          disabled={!file || !resource.data || busy || !!pending}
        >
          上传
        </button>
      </form>
      <p>仅当前平台文件，历史覆盖未知；上传来源未核验。</p>
      {resource.data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>公司</th>
                <th>财年 / 报告期</th>
                <th>文件</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {resource.data.reports.map((report) => (
                <tr key={report.id}>
                  <td>
                    {report.companyName || report.companyCode}
                    <small>
                      {report.market} · {report.exchange}
                    </small>
                  </td>
                  <td>
                    {report.fiscalYear} / {report.fiscalPeriod}
                  </td>
                  <td>
                    <a href={report.fileUrl}>{report.fileName}</a>
                  </td>
                  <td>
                    <button
                      disabled={busy || !!pending}
                      onClick={() => setDeleting(report)}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {!resource.data.reports.length && (
                <tr>
                  <td colSpan={4}>暂无当前平台财报文件</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <ReportMediaAliases session={session} reports={listing?.reports ?? []} onDenied={fail} />
      {deleting && (
        <Dialog title="删除财报文件" onClose={() => setDeleting(null)}>
          <p>{deleting.fileName}</p>
          <div className="dialog-actions">
            <button onClick={() => setDeleting(null)}>取消</button>
            <button
              onClick={() => void execute("delete", deleting)}
              disabled={busy}
            >
              删除
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
