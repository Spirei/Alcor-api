import { WorkspaceEmpty, PageHeader, WorkspaceTabs } from "./workspace-ui";
import {
  RefreshCw,
  Settings2,
  ChevronRight,
  ChevronLeft,
  Search,
  Pencil,
  ChevronUp,
  ChevronDown,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { requestId } from "./request-id";
import { Dialog } from "./dialog";
import { SettingsSurface, FormActions, ToggleSwitch } from "./workspace-forms";
import {
  disclosedExact as exact,
  disclosedText,
  disclosureChart,
  disclosureScope,
  disclosureReturnSummary,
  disclosedWeightSegments,
  disclosureReasonText,
} from "./celebs-display";
import "./celebs.css";
type DecimalValue = string | null;
type Holding = {
  quantity?: DecimalValue;
  shares?: DecimalValue;
  value?: DecimalValue;
  cusip?: string | null;
  issuer?: string | null;
  putCall?: string | null;
  valueReported?: DecimalValue;
  valueUnit?: string | null;
  sharesType?: string | null;
  securityType?: string | null;
  reportedValueCurrency?: string | null;
  code: string;
  name: string;
  market: string | null;
  currency: string | null;
  asOf: string | null;
  qty: DecimalValue;
  cost: DecimalValue;
  weight: DecimalValue;
  weightDelta?: DecimalValue;
  isNew?: boolean;
  price: DecimalValue;
  changePct: DecimalValue;
  target: DecimalValue;
  marketCap?: DecimalValue;
};
type Trade = {
  code: string;
  name: string;
  action: string;
  changePct: DecimalValue;
  [key: string]: unknown;
};
type Celeb = {
  reportDate?: string | null;
  reportQuarter?: string | null;
  sourceUrl?: string | null;
  id: string;
  name: string;
  title: string;
  avatar: string;
  enabled: boolean;
  sort: number;
  sourceKind: string;
  cik: string;
  entity: string;
  sourceLabel: string;
  holdings: Holding[];
  trades: Trade[];
  returns: Record<string, unknown>;
  stockIcons: Record<string, string>;
  refreshHours: number;
  revision: number;
  createdAt?: string;
  updatedAt?: string;
  dataSource?: string;
  dataAuthority?: string;
  positionAuthority?: string;
  gain250: null;
};
type Listing = {
  celebs: Celeb[];
  scopeRevision: string | number;
  source: string;
  collectionOnRead: false;
  detail?: Record<
    string,
    {
      revision: number;
      sourceEvidence: unknown;
      reportedHoldings: unknown;
      reportedTrades: unknown;
      reportedReturns: unknown;
      performanceState: string;
    }
  >;
};
type Returns = {
  dates: string[];
  values: DecimalValue[];
  benchmarks: {
    code: string;
    name: string;
    values: DecimalValue[];
    state: string;
    provenance: unknown;
  }[];
  state: "observed" | "partial" | "unknown" | "sample";
  disclosedSummary: {
    y1: DecimalValue;
    y3: DecimalValue;
    y5: DecimalValue;
    spxY1: DecimalValue;
  };
  provenance: unknown;
  unknownReasons: unknown[];
  syntheticHistory: false;
  portfolioPerformanceKnown: false;
};
type Receipt = {
  requestId: string;
  state: string;
  result?: { celeb?: Celeb; ok?: boolean };
  revision?: number;
  scopeRevision?: string;
  message?: string;
};
const url = (raw: string) => {
  try {
    const value = new URL(raw);
    return ["https:", "http:"].includes(value.protocol) &&
      !value.username &&
      !value.password
      ? value.href
      : null;
  } catch {
    return null;
  }
};
const returnsAllowed = (value: Returns) =>
  ["observed", "partial"].includes(value.state) &&
  !(
    value.provenance &&
    typeof value.provenance === "object" &&
    "sourceIntegrity" in value.provenance &&
    value.provenance.sourceIntegrity &&
    typeof value.provenance.sourceIntegrity === "object" &&
    "state" in value.provenance.sourceIntegrity &&
    value.provenance.sourceIntegrity.state === "retained_unavailable"
  );
function SourceDetails({
  value,
  expanded = false,
}: {
  value: unknown;
  expanded?: boolean;
}) {
  const object = (item: unknown): Record<string, unknown> =>
    item && typeof item === "object" && !Array.isArray(item)
      ? (item as Record<string, unknown>)
      : {};
  const row = object(value),
    evidence = object(row.sourceEvidence || row.provenance || value),
    integrity = object(row.sourceIntegrity || evidence.sourceIntegrity);
  const revision = row.revision ?? evidence.revision;
  return (
    <SettingsSurface title="来源依据" expanded={expanded} open={false}>
      <dl className="celeb-source-summary">
        <div>
          <dt>资料范围</dt>
          <dd>公开披露与登记，未关联本人账户</dd>
        </div>
        <div>
          <dt>登记修订</dt>
          <dd>
            {typeof revision === "number" || typeof revision === "string"
              ? String(revision)
              : "未提供"}
          </dd>
        </div>
        <div>
          <dt>原件核对</dt>
          <dd>
            {integrity.state === "retained_unavailable"
              ? "当前不可核对"
              : integrity.state === "verified" ||
                  integrity.state === "verified_original"
                ? "本次原件可核对"
                : "未附独立原件核对结果"}
          </dd>
        </div>
        {typeof evidence.source === "string" && (
          <div>
            <dt>来源说明</dt>
            <dd>{evidence.source}</dd>
          </div>
        )}
        {Array.isArray(row.reportedHoldings) && (
          <div>
            <dt>登记内容</dt>
            <dd>
              {row.reportedHoldings.length}项持仓 ·{" "}
              {Array.isArray(row.reportedTrades)
                ? row.reportedTrades.length
                : "未知"}
              项操作
            </dd>
          </div>
        )}
      </dl>
      <details className="celeb-source-original">
        <summary>原始来源字段</summary>
        <pre>
          {value === null || value === undefined
            ? "未知"
            : JSON.stringify(value, null, 2)}
        </pre>
      </details>
    </SettingsSurface>
  );
}
export function ReturnsView({ value }: { value: Returns }) {
  return (
    <section>
      <p role="status">
        {
          (
            {
              observed: "已有日期来源观察",
              partial: "部分日期观察",
              unknown: "收益范围未知",
              sample: "示例声明（非实际账户收益）",
            } as Record<string, string>
          )[value.state]
        }
      </p>
      {value.portfolioPerformanceKnown === false && (
        <p>原声明收益未经独立核验，不代表完整账户收益。</p>
      )}
      <dl className="celebs-summary">
        {[
          ["y1", "原声明一年"],
          ["y3", "原声明三年"],
          ["y5", "原声明五年"],
          ["spxY1", "原声明基准一年"],
        ].map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>
              {exact(
                value.disclosedSummary[
                  key as keyof Returns["disclosedSummary"]
                ],
              )}
              {exact(
                value.disclosedSummary[
                  key as keyof Returns["disclosedSummary"]
                ],
              ) !== "未知"
                ? " %"
                : ""}
            </dd>
          </div>
        ))}
      </dl>
      {!!value.unknownReasons.length && (
        <p className="celeb-source-note">
          {[...new Set(value.unknownReasons.map(disclosureReasonText))].join(
            "；",
          )}
        </p>
      )}
      {returnsAllowed(value) && value.dates.length > 0 && (
        <>
          <ObservedReturns
            dates={value.dates}
            values={value.values}
            label="已保存来源序列"
          />
          {value.benchmarks.map((benchmark) => (
            <details key={benchmark.code}>
              <summary>
                {benchmark.name} · {benchmark.code} · {benchmark.state}
              </summary>
              <ObservedReturns
                dates={value.dates}
                values={benchmark.values}
                label={benchmark.name}
              />
              <SourceDetails value={benchmark.provenance} />
            </details>
          ))}
          <details>
            <summary>精确日期观察</summary>
            <div className="workspace-table">
              <table>
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>来源序列值</th>
                    {value.benchmarks.map((benchmark) => (
                      <th key={benchmark.code}>{benchmark.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {value.dates.map((date, index) => (
                    <tr key={date + ":" + index}>
                      <td>{date}</td>
                      <td>{exact(value.values[index])}</td>
                      {value.benchmarks.map((benchmark) => (
                        <td key={benchmark.code}>
                          {exact(benchmark.values[index])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
      <SourceDetails
        value={{
          provenance: value.provenance,
          unknownReasons: value.unknownReasons,
        }}
      />
    </section>
  );
}
export function ObservedReturns({
  dates,
  values,
  label,
}: {
  dates: string[];
  values: DecimalValue[];
  label: string;
}) {
  const chart = disclosureChart(dates, values);
  if (chart.state === "invalid")
    return <p>日期与序列值未完整对应或日期不可核对，图形不可用</p>;
  if (chart.state === "unknown") return <p>当前日期范围无已核实序列值</p>;
  if (chart.state === "unrepresentable")
    return <p>保留精确值，当前图形范围不可表示</p>;
  return (
    <figure>
      <svg
        viewBox="0 0 600 180"
        role="img"
        aria-label={label + "，按实际日期间隔显示，不补缺失值"}
      >
        <path
          d={chart.path}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        {chart.dots.length === 1 && (
          <circle
            cx={chart.dots[0].x}
            cy={chart.dots[0].y}
            r="3"
            fill="currentColor"
          />
        )}
      </svg>
      <figcaption>
        {label} · {dates[0]} — {dates[dates.length - 1]} · 已知 {chart.known}/
        {chart.total} 个日期观察 · 未提供值处断开，不补每日值
      </figcaption>
    </figure>
  );
}
export function DisclosureNotice({
  authority,
  detail,
}: {
  authority: unknown;
  detail: unknown;
}) {
  const scope = disclosureScope(authority, detail);
  return (
    <p role="status" data-disclosure-state={scope.state}>
      {scope.label}
    </p>
  );
}
type Draft = {
  id: string;
  name: string;
  title: string;
  enabled: boolean;
  sourceKind: string;
  cik: string;
  entity: string;
  sourceLabel: string;
  sourceUrl: string | null;
  reportDate: string | null;
  reportQuarter: string | null;
  refreshHours: string;
  holdings: Holding[];
  trades: Trade[];
  returns: Record<string, unknown>;
};
const emptyDraft = (): Draft => ({
  id: "",
  name: "",
  title: "",
  enabled: false,
  sourceKind: "none",
  cik: "",
  entity: "",
  sourceLabel: "",
  sourceUrl: null,
  reportDate: null,
  reportQuarter: null,
  refreshHours: "0",
  holdings: [],
  trades: [],
  returns: {
    y1: null,
    y3: null,
    y5: null,
    spxY1: null,
    dates: [],
    values: [],
    benchmarks: [],
  },
});
const holdingDraft = (): Holding => ({
  code: "",
  name: "",
  market: null,
  currency: null,
  asOf: null,
  qty: null,
  cost: null,
  weight: null,
  price: null,
  changePct: null,
  target: null,
});
function exactObject(raw: string) {
  const value = JSON.parse(raw);
  function check(item: unknown): void {
    if (typeof item === "number")
      throw new Error("请将金额、比例与观察值写为精确字符串，未知写null");
    if (item && typeof item === "object")
      for (const next of Object.values(item)) check(next);
  }
  check(value);
  return value;
}
const mediaPath = (value: string | undefined) =>
  value &&
  /^\/uploads\/(ico|background|logo|login|asset)\/[A-Za-z0-9._/-]+(?:\?sha256=[a-f0-9]{64})?$/.test(
    value,
  ) &&
  !value.includes("..")
    ? value
    : undefined;
export function CelebsPage({
  session,
  active = true,
}: {
  session: Session;
  active?: boolean;
}) {
  return (
    <Page
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
function Page({ session, active }: { session: Session; active: boolean }) {
  const [personFilter, setPersonFilter] = useState("");
  const storage =
    "celebs-operation:" +
    JSON.stringify([
      session.instance_id,
      session.user.id,
      session.user.role,
      session.receipt_scope,
    ]);
  const [listing, setListing] = useState<Listing | null>(null),
    [selected, setSelected] = useState<Celeb | null>(null),
    [detail, setDetail] = useState<unknown>(null),
    [returns, setReturns] = useState<Returns | null>(null),
    [detailView, setDetailView] = useState("holdings"),
    [manage, setManage] = useState<Listing | null>(null),
    [adminOpen, setAdminOpen] = useState(false),
    [editing, setEditing] = useState(false),
    [edited, setEdited] = useState<Celeb | null>(null),
    [draft, setDraft] = useState<Draft>(emptyDraft),
    [tradesJson, setTradesJson] = useState("[]"),
    [returnsJson, setReturnsJson] = useState("{}"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmDelete, setConfirmDelete] = useState<Celeb | null>(null),
    [file, setFile] = useState<File | null>(null),
    [mediaPerson, setMediaPerson] = useState(""),
    [iconCode, setIconCode] = useState(""),
    [iconUrl, setIconUrl] = useState("");
  const [pending, setPending] = useState<string | null>(() => {
    try {
      const id = sessionStorage.getItem(storage);
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
  const tradeFields = useMemo(() => {
    try {
      const value: unknown = JSON.parse(tradesJson);
      return Array.isArray(value) &&
        value.every(
          (row) => row && typeof row === "object" && !Array.isArray(row),
        )
        ? (value as Record<string, unknown>[])
        : null;
    } catch {
      return null;
    }
  }, [tradesJson]);
  const returnFields = useMemo(() => {
    try {
      const value: unknown = JSON.parse(returnsJson);
      return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }, [returnsJson]);
  const epoch = useRef(0),
    live = useRef(true),
    reads = useRef(0),
    controllers = useRef(new Set<AbortController>()),
    input = useRef<HTMLInputElement>(null);
  function clear() {
    epoch.current++;
    reads.current++;
    for (const c of controllers.current) c.abort();
    controllers.current.clear();
    setListing(null);
    setSelected(null);
    setReturns(null);
    setDetail(null);
    setManage(null);
    setEditing(false);
    setEdited(null);
    setDraft(emptyDraft());
    setTradesJson("[]");
    setReturnsJson("{}");
    setConfirmDelete(null);
    setFile(null);
    setMediaPerson("");
    setIconCode("");
    setIconUrl("");
    if (input.current) input.current.value = "";
    setBusy(false);
  }
  function current(run: number) {
    return active && live.current && !document.hidden && epoch.current === run;
  }
  function fail(reason: unknown) {
    if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
      clear();
      try {
        sessionStorage.removeItem(storage);
      } catch {
        /* Retire private admin state. */
      }
      setPending(null);
    }
    setError(reason instanceof Error ? reason.message : "公开持仓服务暂不可用");
  }
  useEffect(() => {
    live.current = active;
    if (active && !document.hidden) void read();
    else clear();
    const hide = () => {
      if (document.hidden) clear();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      live.current = false;
      epoch.current++;
      for (const c of controllers.current) c.abort();
      controllers.current.clear();
      document.removeEventListener("visibilitychange", hide);
    };
  }, [active]);
  async function read(admin = false) {
    if (!active || document.hidden) return;
    const run = epoch.current,
      c = new AbortController();
    controllers.current.add(c);
    setBusy(true);
    setError("");
    try {
      const value = await api<Listing>(admin ? "/celebs/manage" : "/celebs", {
        signal: c.signal,
      });
      if (current(run)) {
        if (admin) {
          setManage(value);
          setAdminOpen(true);
        } else setListing(value);
      }
    } catch (reason) {
      if (!c.signal.aborted && current(run)) fail(reason);
    } finally {
      controllers.current.delete(c);
      if (current(run)) setBusy(false);
    }
  }
  async function open(person: Celeb) {
    if (busy) return;
    setDetailView("holdings");
    setSelected(person);
    setDetail(null);
    setReturns(null);
    const sequence = ++reads.current,
      run = epoch.current,
      c = new AbortController();
    controllers.current.add(c);
    setBusy(true);
    setError("");
    try {
      const [item, series] = await Promise.allSettled([
        api<{ celeb: Celeb; detail: unknown }>(
          "/celebs/" + encodeURIComponent(person.id),
          { signal: c.signal },
        ),
        api<Returns>("/celebs/" + encodeURIComponent(person.id) + "/returns", {
          signal: c.signal,
        }),
      ]);
      if (current(run) && sequence === reads.current) {
        if (item.status === "fulfilled") {
          setSelected(item.value.celeb);
          setDetail(item.value.detail);
        } else throw item.reason;
        if (series.status === "fulfilled") setReturns(series.value);
        else fail(series.reason);
      }
    } catch (reason) {
      if (!c.signal.aborted && current(run) && sequence === reads.current)
        fail(reason);
    } finally {
      controllers.current.delete(c);
      if (current(run) && sequence === reads.current) setBusy(false);
    }
  }
  function remember(id: string | null) {
    try {
      if (id) sessionStorage.setItem(storage, id);
      else sessionStorage.removeItem(storage);
      setPending(id);
      return true;
    } catch {
      setError("无法保留原请求编号，未提交人物目录变更");
      return false;
    }
  }
  function accept(value: Receipt, id: string) {
    if (value.requestId !== id || value.state !== "completed")
      throw new Error("原人物目录请求仍待核对");
    remember(null);
    setNotice("原请求 " + id + " 已完成");
    setEditing(false);
    setConfirmDelete(null);
    setFile(null);
    if (input.current) input.current.value = "";
    void read(true).then(() => read());
  }
  async function mutate(
    path: string,
    method: string,
    body: Record<string, unknown> | FormData,
  ) {
    if (
      session.user.role !== "admin" ||
      busy ||
      pending ||
      !active ||
      document.hidden
    )
      return;
    const id = requestId();
    if (!remember(id)) return;
    const run = epoch.current;
    setBusy(true);
    setError("");
    setNotice("");
    if (body instanceof FormData) {
      body.set("requestId", id);
      setFile(null);
      if (input.current) input.current.value = "";
    }
    try {
      const value = await api<Receipt>(
        path,
        {
          method,
          body:
            body instanceof FormData
              ? body
              : JSON.stringify({ ...body, requestId: id }),
        },
        session.csrf,
        60000,
      );
      if (current(run)) accept(value, id);
    } catch (reason) {
      if (current(run)) {
        fail(reason);
        if (
          reason instanceof ApiError &&
          [400, 404, 405, 409, 413, 415, 422, 429].includes(reason.status)
        ) {
          try {
            const value = await api<Receipt>("/celebs/operations/" + id);
            if (current(run)) accept(value, id);
          } catch (lookup) {
            if (current(run)) {
              if (lookup instanceof ApiError && lookup.status === 404) {
                remember(null);
                setNotice("请求已明确拒绝，未按成功处理");
              } else if (
                lookup instanceof ApiError &&
                [401, 403].includes(lookup.status)
              )
                fail(lookup);
            }
          }
        }
      }
    } finally {
      if (current(run)) setBusy(false);
    }
  }
  async function query() {
    if (!pending || busy || !active || document.hidden) return;
    const id = pending,
      run = epoch.current;
    setBusy(true);
    try {
      const value = await api<Receipt>("/celebs/operations/" + id);
      if (current(run)) accept(value, id);
    } catch (reason) {
      if (current(run)) fail(reason);
    } finally {
      if (current(run)) setBusy(false);
    }
  }
  function edit(person?: Celeb) {
    setEdited(person || null);
    const next = Object.assign(
      emptyDraft(),
      person
        ? Object.fromEntries(
            Object.keys(emptyDraft()).map((key) => [
              key,
              (person as unknown as Record<string, unknown>)[key] ??
                (emptyDraft() as unknown as Record<string, unknown>)[key],
            ]),
          )
        : {},
    );
    if (!person) next.id = requestId();
    next.refreshHours = String(person?.refreshHours ?? 0);
    setDraft(next);
    setTradesJson(JSON.stringify(next.trades, null, 2));
    setReturnsJson(JSON.stringify(next.returns, null, 2));
    setEditing(true);
    setError("");
  }
  function save() {
    try {
      const trades = exactObject(tradesJson),
        declaredReturns = exactObject(returnsJson);
      if (
        !Array.isArray(trades) ||
        !declaredReturns ||
        typeof declaredReturns !== "object" ||
        Array.isArray(declaredReturns)
      )
        throw new Error("公开操作须是数组，收益声明须是对象");
      const { refreshHours, ...fields } = draft;
      void mutate("/celebs", edited ? "PUT" : "POST", {
        ...fields,
        trades,
        returns: declaredReturns,
        refreshHours: Number(refreshHours),
        expectedRevision: edited?.revision ?? 0,
      });
    } catch (reason) {
      fail(reason);
    }
  }
  function reorder(person: Celeb, offset: number) {
    if (!manage) return;
    const order = manage.celebs.map((row) => row.id),
      index = order.indexOf(person.id),
      next = index + offset;
    if (index < 0 || next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]];
    void mutate("/celebs", "PUT", {
      reorder: order,
      expectedRevision: manage.scopeRevision,
    });
  }
  const disabled = busy || !!pending || !active;
  const mediaRecord = manage?.celebs.find(
    (person) => person.id === mediaPerson,
  );
  return (
    <section className="celebs-page workspace-ui">
      <PageHeader
        title={selected ? `${selected.name}持仓` : "名人持仓"}
        tools={
          session.user.role === "admin" ? (
            <button
              type="button"
              className="icon-button"
              aria-label="名人管理"
              disabled={disabled}
              onClick={() => void read(true)}
            >
              <Settings2 size={17} />
            </button>
          ) : undefined
        }
        actions={
          selected ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                reads.current++;
                setSelected(null);
                setReturns(null);
                setDetail(null);
                setBusy(false);
              }}
            >
              <ChevronLeft size={15} />
              返回
            </button>
          ) : (
            <button
              type="button"
              className="icon-button"
              aria-label="刷新名人持仓"
              disabled={busy}
              onClick={() => void read()}
            >
              <RefreshCw size={17} />
            </button>
          )
        }
      />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {pending && (
        <div>
          <p role="status">目录操作结果待核对</p>
          <code>{pending}</code>
          <button disabled={busy} onClick={() => void query()}>
            查询原请求
          </button>
        </div>
      )}
      {!listing && !error && <p role="status">正在读取…</p>}
      {listing && !selected && (
        <>
          {!!listing.celebs.length && (
            <div className="celebs-filter">
              <label className="input-search">
                <Search size={16} />
                <input
                  type="search"
                  aria-label="查找公开人物"
                  placeholder="搜索人物或持仓证券"
                  value={personFilter}
                  onChange={(e) => setPersonFilter(e.target.value)}
                />
              </label>
              <span>{listing.celebs.length} 位人物</span>
            </div>
          )}
          {!listing.celebs.length && (
            <div className="celeb-empty-list">
              <WorkspaceEmpty
                title="暂无人物持仓"
                description={
                  session.user.role === "admin"
                    ? "可在名人管理中添加人物及披露来源。"
                    : "公开人物持仓将在这里显示。"
                }
                actions={
                  session.user.role === "admin" ? (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => void read(true)}
                    >
                      添加人物
                    </button>
                  ) : undefined
                }
              />
            </div>
          )}
          <div className="celebs-list">
            {listing.celebs
              .filter((person) =>
                JSON.stringify([person.name, person.title, person.holdings])
                  .toLocaleLowerCase()
                  .includes(personFilter.trim().toLocaleLowerCase()),
              )
              .map((person) => {
                const scope = disclosureScope(
                  person.dataAuthority,
                  listing.detail?.[person.id],
                );
                const summary = disclosureReturnSummary(
                  listing.detail?.[person.id]?.reportedReturns ??
                    person.returns,
                  scope.state === "unavailable",
                );
                return (
                  <button
                    type="button"
                    className="celeb-summary-card"
                    key={person.id}
                    disabled={busy}
                    aria-label={`${person.name}：查看公开持仓`}
                    onClick={() => void open(person)}
                  >
                    <span className="celeb-summary-main">
                      <span className="celeb-summary-title">
                        <strong>{person.name}持仓</strong>
                        <span
                          className="celeb-source-badge"
                          title={scope.label}
                        >
                          {scope.state === "sample"
                            ? "示例"
                            : scope.state === "unavailable"
                              ? "历史登记"
                              : scope.state === "partial"
                                ? "部分披露"
                                : person.sourceLabel || "公开目录"}
                        </span>
                      </span>
                      <span className="celeb-summary-subtitle">
                        {person.title}
                      </span>
                      <span className="celeb-return">
                        <strong>
                          {summary.value === null ? "—" : `${summary.value}%`}
                        </strong>
                        <span>{summary.label}</span>
                      </span>
                      <span className="celebs-holdings-preview">
                        {person.holdings.slice(0, 3).map((holding, index) => (
                          <span key={index}>
                            {typeof holding === "object" && holding !== null
                              ? String(
                                  (holding as Record<string, unknown>).name ||
                                    (holding as Record<string, unknown>)
                                      .symbol ||
                                    (holding as Record<string, unknown>).code ||
                                    "持仓声明",
                                )
                              : "持仓声明"}
                          </span>
                        ))}
                      </span>
                      <span className="celeb-details-link">
                        查看明细
                        <ChevronRight size={13} />
                      </span>
                    </span>
                    <span className="celeb-summary-aside">
                      <DisclosureRing person={person} />
                      <small>已披露 {person.holdings.length} 项</small>
                    </span>
                  </button>
                );
              })}
          </div>
          {!!personFilter.trim() &&
            !listing.celebs.some((person) =>
              JSON.stringify([person.name, person.title, person.holdings])
                .toLocaleLowerCase()
                .includes(personFilter.trim().toLocaleLowerCase()),
            ) && <p role="status">当前已读目录中没有匹配的人物</p>}
        </>
      )}
      {adminOpen && manage && session.user.role === "admin" && (
        <Dialog
          title="名人管理"
          className="celeb-manage-dialog"
          onClose={() => {
            if (!busy) setAdminOpen(false);
          }}
        >
          <div className="dialog-content">
            <button
              className="button"
              disabled={disabled}
              onClick={() => edit()}
            >
              新建人物
            </button>
            <div className="portfolio-table celeb-management-table">
              <table>
                <thead>
                  <tr>
                    <th>人物</th>
                    <th>来源登记</th>
                    <th>公开</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {manage.celebs.map((person, index) => (
                    <tr key={person.id}>
                      <td title={`登记修订 ${person.revision}`}>
                        <strong>{person.name}</strong>
                        <small>{person.title}</small>
                      </td>
                      <td>
                        {(
                          {
                            none: "手动声明",
                            sample: "示例资料",
                            "13f": "13F 披露",
                            form4: "Form 4 披露",
                            sec13f: "13F 原件",
                            secform4: "Form 4 原件",
                          } as Record<string, string>
                        )[person.sourceKind] || "未分类来源"}
                        <small>{person.sourceLabel || "未填写来源说明"}</small>
                      </td>
                      <td>
                        <ToggleSwitch
                          label={`${person.name}公开显示`}
                          checked={person.enabled}
                          disabled={disabled}
                          onChange={(enabled) =>
                            void mutate("/celebs", "PUT", {
                              id: person.id,
                              enabled,
                              expectedRevision: person.revision,
                            })
                          }
                        />
                      </td>
                      <td>
                        <div className="celebs-actions">
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`编辑${person.name}`}
                            title="编辑"
                            disabled={disabled}
                            onClick={() => edit(person)}
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`上移${person.name}`}
                            title="上移"
                            disabled={disabled || index === 0}
                            onClick={() => reorder(person, -1)}
                          >
                            <ChevronUp size={16} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`下移${person.name}`}
                            title="下移"
                            disabled={
                              disabled || index === manage.celebs.length - 1
                            }
                            onClick={() => reorder(person, 1)}
                          >
                            <ChevronDown size={16} />
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={`删除${person.name}`}
                            title="删除"
                            disabled={disabled}
                            onClick={() => setConfirmDelete(person)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CelebSourceControls
              session={session}
              people={manage.celebs}
              blocked={disabled}
              active={active}
              onChanged={() => {
                void read(true).then(() => read());
              }}
            />
            <details>
              <summary>头像与人物专属证券图标</summary>
              <div className="celebs-fields">
                <label>
                  人物
                  <select
                    value={mediaPerson}
                    disabled={disabled}
                    onChange={(event) => {
                      setMediaPerson(event.target.value);
                      setFile(null);
                      if (input.current) input.current.value = "";
                    }}
                  >
                    <option value="">选择人物</option>
                    {manage.celebs.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  人物或证券原图
                  <input
                    ref={input}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    disabled={disabled || !mediaRecord}
                    onChange={(event) => {
                      const next = event.target.files?.[0];
                      if (next && (!next.size || next.size > 2 * 1024 * 1024)) {
                        setFile(null);
                        event.target.value = "";
                        setError("请选择1字节至2MiB的头像原图");
                        return;
                      }
                      setFile(next || null);
                    }}
                  />
                </label>
                <button
                  disabled={disabled || !mediaRecord || !file}
                  onClick={() => {
                    const form = new FormData();
                    form.set("file", file!);
                    form.set("id", mediaRecord!.id);
                    form.set("expectedRevision", String(mediaRecord!.revision));
                    void mutate("/celebs/avatar", "POST", form);
                  }}
                >
                  上传头像原件
                </button>
                <button
                  disabled={disabled || !mediaRecord}
                  onClick={() =>
                    void mutate("/celebs", "PUT", {
                      id: mediaRecord!.id,
                      avatar: "",
                      expectedRevision: mediaRecord!.revision,
                    })
                  }
                >
                  清空人物头像引用
                </button>
                <label>
                  证券代码
                  <input
                    value={iconCode}
                    disabled={disabled}
                    maxLength={40}
                    onChange={(event) => setIconCode(event.target.value)}
                  />
                </label>
                <label>
                  已登记公开素材版本URL
                  <input
                    value={iconUrl}
                    disabled={disabled}
                    onChange={(event) => setIconUrl(event.target.value)}
                    placeholder="/uploads/asset/…?sha256=…"
                  />
                </label>
                <button
                  disabled={
                    disabled ||
                    !mediaRecord ||
                    !iconCode.trim() ||
                    !iconUrl.trim()
                  }
                  onClick={() =>
                    void mutate("/celebs/stock-icon", "POST", {
                      id: mediaRecord!.id,
                      code: iconCode,
                      url: iconUrl,
                      expectedRevision: mediaRecord!.revision,
                    })
                  }
                >
                  保存人物专属证券图标
                </button>
                <button
                  disabled={
                    disabled || !mediaRecord || !iconCode.trim() || !file
                  }
                  onClick={() => {
                    const form = new FormData();
                    form.set("file", file!);
                    form.set("id", mediaRecord!.id);
                    form.set("code", iconCode);
                    form.set("revision", String(mediaRecord!.revision));
                    void mutate("/celebs/stock-icon", "POST", form);
                  }}
                >
                  上传人物专属证券图标原件
                </button>
                <button
                  disabled={disabled || !mediaRecord || !iconCode.trim()}
                  onClick={() => {
                    const stockIcons = { ...mediaRecord!.stockIcons };
                    if (!(iconCode in stockIcons)) {
                      setError("请填写已登记图标的准确证券代码");
                      return;
                    }
                    delete stockIcons[iconCode];
                    void mutate("/celebs", "PUT", {
                      id: mediaRecord!.id,
                      stockIcons,
                      expectedRevision: mediaRecord!.revision,
                    });
                  }}
                >
                  清空该证券图标引用
                </button>
              </div>
            </details>
          </div>
        </Dialog>
      )}
      {editing && (
        <Dialog
          title={edited ? "编辑公开人物与披露" : "新建公开人物"}
          className="celeb-editor-dialog"
          onClose={() => {
            if (!busy) {
              setEditing(false);
              setDraft(emptyDraft());
              setEdited(null);
            }
          }}
        >
          <div className="dialog-content celebs-fields">
            {(["name", "title", "cik", "entity", "sourceLabel"] as const).map(
              (key) => (
                <label key={key}>
                  {
                    (
                      {
                        id: "稳定人物编号",
                        name: "名称",
                        title: "身份说明",
                        cik: "SEC CIK（如有）",
                        entity: "披露实体",
                        sourceLabel: "来源说明",
                      } as Record<string, string>
                    )[key]
                  }
                  <input
                    value={draft[key]}
                    disabled={disabled}
                    onChange={(event) =>
                      setDraft({ ...draft, [key]: event.target.value })
                    }
                  />
                </label>
              ),
            )}
            <label className="celeb-enabled-row">
              <input
                type="checkbox"
                checked={draft.enabled}
                disabled={disabled}
                onChange={(event) =>
                  setDraft({ ...draft, enabled: event.target.checked })
                }
              />
              公开显示
            </label>
            <label>
              登记来源类型
              <select
                value={draft.sourceKind}
                disabled={disabled}
                onChange={(event) =>
                  setDraft({ ...draft, sourceKind: event.target.value })
                }
              >
                <option value="none">手动公开声明（未核验原件）</option>
                <option value="13f">13F 披露来源登记</option>
                <option value="form4">Form 4 披露来源登记</option>
              </select>
            </label>
            {(["reportDate", "reportQuarter", "sourceUrl"] as const).map(
              (key) => (
                <label key={key}>
                  {
                    (
                      {
                        reportDate: "披露报告日期",
                        reportQuarter: "报告季度（如有）",
                        sourceUrl: "公开披露原始URL",
                      } as Record<string, string>
                    )[key]
                  }
                  <input
                    type={key === "reportDate" ? "date" : "text"}
                    value={draft[key] || ""}
                    disabled={disabled}
                    onChange={(event) =>
                      setDraft({ ...draft, [key]: event.target.value || null })
                    }
                  />
                </label>
              ),
            )}
            <label>
              登记刷新间隔小时（0为不启用）
              <input
                type="number"
                min="0"
                max="8760"
                value={draft.refreshHours}
                disabled={disabled}
                onChange={(event) =>
                  setDraft({ ...draft, refreshHours: event.target.value })
                }
              />
            </label>
            <p>来源登记不等于已接入采集或已核实该人物实际账户</p>
            <h3>公开披露持仓</h3>
            <button
              disabled={disabled || draft.holdings.length >= 2000}
              onClick={() =>
                setDraft({
                  ...draft,
                  holdings: [...draft.holdings, holdingDraft()],
                })
              }
            >
              添加披露证券
            </button>
            {draft.holdings.map((row, index) => (
              <fieldset key={index} disabled={disabled}>
                <legend>披露行 {index + 1}</legend>
                {(
                  [
                    "code",
                    "name",
                    "cusip",
                    "issuer",
                    "market",
                    "currency",
                    "asOf",
                    "quantity",
                    "qty",
                    "shares",
                    "value",
                    "cost",
                    "weight",
                    "price",
                    "changePct",
                    "target",
                    "putCall",
                  ] as const
                ).map((key) => (
                  <label key={key}>
                    {
                      (
                        {
                          code: "证券代码（未确认可留空）",
                          name: "名称",
                          cusip: "原CUSIP（如有）",
                          issuer: "原披露发行实体",
                          quantity: "披露数量（quantity）",
                          shares: "原披露shares",
                          value: "原披露value（不猜单位）",
                          putCall: "原披露看涨/看跌标记",
                          market: "市场（未知留空）",
                          currency: "币种（未知留空）",
                          asOf: "该项披露截至日期",
                          qty: "披露数量（qty）",
                          cost: "披露成本（未知留空）",
                          weight: "披露权重 %",
                          price: "披露或声明价格",
                          changePct: "原声明变动 %",
                          target: "原声明目标价",
                        } as Record<string, string>
                      )[key]
                    }
                    <input
                      type={key === "asOf" ? "date" : "text"}
                      inputMode={
                        [
                          "quantity",
                          "qty",
                          "shares",
                          "value",
                          "cost",
                          "weight",
                          "price",
                          "changePct",
                          "target",
                        ].includes(key)
                          ? "decimal"
                          : undefined
                      }
                      value={row[key] ?? ""}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          holdings: previous.holdings.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  [key]: ["code", "name"].includes(key)
                                    ? event.target.value
                                    : event.target.value || null,
                                }
                              : item,
                          ),
                        }))
                      }
                    />
                  </label>
                ))}
                <button
                  onClick={() =>
                    setDraft({
                      ...draft,
                      holdings: draft.holdings.filter((_, i) => i !== index),
                    })
                  }
                >
                  移除此披露行
                </button>
              </fieldset>
            ))}
            <section className="celeb-editor-section">
              <div className="workspace-section-heading">
                <h3>公开操作披露</h3>
                <button
                  type="button"
                  className="button secondary"
                  disabled={
                    disabled || !tradeFields || tradeFields.length >= 2000
                  }
                  onClick={() =>
                    setTradesJson(
                      JSON.stringify([
                        ...(tradeFields || []),
                        { code: "", name: "", action: "", changePct: null },
                      ]),
                    )
                  }
                >
                  添加操作
                </button>
              </div>
              {!tradeFields && (
                <p role="alert">操作原文格式无效，请在原始字段中核对。</p>
              )}
              {tradeFields?.map((row, index) => (
                <fieldset key={index} disabled={disabled}>
                  <legend>操作 {index + 1}</legend>
                  {(
                    [
                      ["code", "证券代码"],
                      ["name", "证券名称"],
                      ["action", "披露操作"],
                      ["changePct", "原声明变动 %"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        inputMode={key === "changePct" ? "decimal" : undefined}
                        placeholder={key === "changePct" ? "未知" : undefined}
                        value={
                          typeof row[key] === "string"
                            ? (row[key] as string)
                            : ""
                        }
                        onChange={(event) =>
                          setTradesJson(
                            JSON.stringify(
                              tradeFields.map((item, i) =>
                                i === index
                                  ? {
                                      ...item,
                                      [key]:
                                        key === "changePct"
                                          ? event.target.value || null
                                          : event.target.value,
                                    }
                                  : item,
                              ),
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() =>
                      setTradesJson(
                        JSON.stringify(
                          tradeFields.filter((_, i) => i !== index),
                        ),
                      )
                    }
                  >
                    移除此操作
                  </button>
                </fieldset>
              ))}
              {tradeFields?.length === 0 && (
                <p className="muted">暂无已登记操作</p>
              )}
            </section>
            <section className="celeb-editor-section">
              <h3>原声明收益</h3>
              <p>仅登记来源明示的比例，未知留空。</p>
              <div className="workspace-form-grid">
                {(
                  [
                    ["y1", "近1年 %"],
                    ["y3", "近3年 %"],
                    ["y5", "近5年 %"],
                    ["spxY1", "标普近1年 %"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      inputMode="decimal"
                      placeholder="未知"
                      disabled={disabled || !returnFields}
                      value={
                        typeof returnFields?.[key] === "string"
                          ? (returnFields[key] as string)
                          : ""
                      }
                      onChange={(event) =>
                        setReturnsJson(
                          JSON.stringify({
                            ...returnFields,
                            [key]: event.target.value || null,
                          }),
                        )
                      }
                    />
                  </label>
                ))}
              </div>
            </section>
            <details className="celeb-editor-raw">
              <summary>原始字段与日期观察</summary>
              <label>
                登记编号
                <input
                  value={draft.id}
                  disabled={disabled || !!edited}
                  onChange={(event) =>
                    setDraft({ ...draft, id: event.target.value })
                  }
                />
              </label>
              <label>
                公开操作披露JSON（数值为精确字符串，未知null）
                <textarea
                  value={tradesJson}
                  disabled={disabled}
                  onChange={(event) => setTradesJson(event.target.value)}
                />
              </label>
              <label>
                原声明收益与真实日期观察JSON（不补缺失日期）
                <textarea
                  value={returnsJson}
                  disabled={disabled}
                  onChange={(event) => setReturnsJson(event.target.value)}
                />
              </label>
            </details>
            <FormActions>
              <button
                className="button primary"
                disabled={disabled || !draft.id.trim() || !draft.name.trim()}
                onClick={save}
              >
                保存公开资料与披露
              </button>
            </FormActions>
          </div>
        </Dialog>
      )}
      {confirmDelete && (
        <Dialog title="确认删除目录项" onClose={() => setConfirmDelete(null)}>
          <p>{confirmDelete.name}</p>
          <p>停止此目录项展示，保留原披露修订与回执</p>
          <FormActions>
            <button
              type="button"
              className="button secondary"
              disabled={disabled}
              onClick={() => setConfirmDelete(null)}
            >
              取消
            </button>
            <button
              className="button secondary"
              disabled={disabled}
              onClick={() =>
                void mutate("/celebs", "DELETE", {
                  id: confirmDelete.id,
                  expectedRevision: confirmDelete.revision,
                })
              }
            >
              确认删除目录项
            </button>
          </FormActions>
        </Dialog>
      )}
      {selected && (
        <section className="celeb-detail">
          <div className="celeb-detail-summary">
            <DisclosureRing person={selected} />
            <div>
              <h2>{selected.name}</h2>
              <p>{selected.title}</p>
              <p>
                {selected.reportDate || "报告日期未知"}{" "}
                {selected.reportQuarter || ""}
              </p>
            </div>
          </div>
          <p>
            {selected.dataAuthority === "example_data"
              ? "示例数据"
              : selected.dataAuthority === "verified_disclosure_original"
                ? "保留公开披露原件"
                : selected.dataAuthority ===
                    "registered_disclosure_source_retained_unavailable"
                  ? "披露来源当前不可核对"
                  : "管理员登记的公开声明"}{" "}
            · 本人金融账户未关联
          </p>
          <DisclosureNotice
            authority={selected.dataAuthority}
            detail={detail}
          />
          <p>
            目录记录更新{" "}
            {selected.updatedAt &&
            Number.isFinite(Date.parse(selected.updatedAt)) ? (
              <time dateTime={selected.updatedAt} title={selected.updatedAt}>
                {new Date(selected.updatedAt).toLocaleString("zh-CN")}
              </time>
            ) : (
              "未知"
            )}{" "}
            · 披露报告 {selected.reportDate || "日期未知"}{" "}
            {selected.reportQuarter || ""}
          </p>
          {selected.sourceUrl && url(selected.sourceUrl) && (
            <a
              href={url(selected.sourceUrl)!}
              target="_blank"
              rel="noreferrer noopener"
            >
              打开披露来源
            </a>
          )}
          <WorkspaceTabs
            label="公开持仓详情"
            value={detailView}
            onChange={setDetailView}
            items={[
              {
                value: "holdings",
                label: `披露持仓 · ${selected.holdings.length}`,
              },
              {
                value: "trades",
                label: `操作披露 · ${selected.trades.length}`,
              },
              { value: "returns", label: "收益观察" },
              { value: "source", label: "来源依据" },
            ]}
          />
          {detailView === "holdings" && <DisclosedHoldings person={selected} />}
          {detailView === "trades" && (
            <section className="celeb-detail-section">
              {!selected.trades.length && (
                <WorkspaceEmpty
                  title="暂无操作披露"
                  description="未登记的交易继续保持未知。"
                />
              )}
              {selected.trades.map((trade, index) => (
                <p key={index}>
                  {trade.name} · {trade.code} · {trade.action} · 原声明变动{" "}
                  {exact(trade.changePct)} %
                </p>
              ))}
            </section>
          )}
          {detailView === "returns" &&
            (returns ? (
              <ReturnsView value={returns} />
            ) : (
              <p>收益来源未读取成功或暂无可核对观察</p>
            ))}
          {detailView === "source" && <SourceDetails value={detail} expanded />}
        </section>
      )}
    </section>
  );
}
export function DisclosedHoldings({ person }: { person: Celeb }) {
  if (!person.holdings.length)
    return (
      <WorkspaceEmpty
        title="暂无已登记披露持仓"
        description="未登记的持仓继续保持未知。"
      />
    );
  return (
    <div className="portfolio-table celeb-holdings-table">
      <table>
        <thead>
          <tr>
            <th>披露证券</th>
            <th>市场 / 原币</th>
            <th>数量 / 成本</th>
            <th>权重</th>
            <th>原声明价格 / 目标</th>
            <th>披露截至</th>
          </tr>
        </thead>
        <tbody>
          {person.holdings.map((holding, index) => (
            <tr key={index}>
              <td>
                <PublicImage
                  path={person.stockIcons[holding.code]}
                  label={holding.name || holding.code}
                />
                {disclosedText(holding.name)} ·{" "}
                {holding.code?.trim() ? holding.code : "证券代码未知"}
                {holding.cusip && <small>原 CUSIP {holding.cusip}</small>}
              </td>
              <td>
                {disclosedText(holding.market)} /{" "}
                {disclosedText(holding.currency)}
              </td>
              <td>
                数量 {exact(holding.quantity)} · qty {exact(holding.qty)}
                <small>
                  披露shares {exact(holding.shares)} · 成本{" "}
                  {exact(holding.cost)}
                </small>
                {holding.value != null && (
                  <small>
                    原 value {exact(holding.value)} · 单位{" "}
                    {holding.valueUnit || "未知"} ·{" "}
                    {holding.reportedValueCurrency || "币种未知"}
                  </small>
                )}
                {holding.valueReported != null && (
                  <small>
                    原披露值 {exact(holding.valueReported)} · 单位{" "}
                    {holding.valueUnit || "未知"} ·{" "}
                    {holding.reportedValueCurrency || "币种未知"}
                  </small>
                )}
              </td>
              <td>{exact(holding.weight)} %</td>
              <td>
                {exact(holding.price)} / {exact(holding.target)}
                <small>非实时价格</small>
              </td>
              <td>{disclosedText(holding.asOf)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function DisclosureRing({ person }: { person: Celeb }) {
  const ring = useMemo(
    () => disclosedWeightSegments(person.holdings),
    [person.holdings],
  );
  const colors = [
    "#5689e8",
    "#d99344",
    "#57a98d",
    "#a87bc8",
    "#d86e84",
    "#6c9cae",
  ];
  return (
    <span
      className="celeb-ring"
      title={
        ring.invalid
          ? "披露权重无法绘制，原值保留在明细"
          : ring.segments.length > 12
            ? "前12项披露权重，未显示部分留空"
            : "公开披露权重，未注明部分留空"
      }
    >
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle
          cx="50"
          cy="50"
          r="44"
          pathLength="100"
          fill="none"
          stroke="var(--edge)"
          strokeWidth="6"
        />
        {ring.segments.slice(0, 12).map((row) => (
          <circle
            key={row.index}
            cx="50"
            cy="50"
            r="44"
            pathLength="100"
            fill="none"
            stroke={colors[row.index % colors.length]}
            strokeWidth="6"
            strokeDasharray={`${row.weight} ${100 - row.weight}`}
            strokeDashoffset={-row.offset}
            transform="rotate(-90 50 50)"
          />
        ))}
      </svg>
      <span className="celeb-ring-avatar">
        <PublicImage path={person.avatar} label={person.name} />
      </span>
    </span>
  );
}
function PublicImage({
  path,
  label,
}: {
  path: string | undefined;
  label: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [path]);
  const src = mediaPath(path);
  return src && !failed ? (
    <img
      className="celebs-image"
      src={src}
      alt={label}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="celebs-image-placeholder" aria-label={label}>
      {failed ? "图片不可读" : label.slice(0, 1)}
    </span>
  );
}
type SecTarget = {
  id: string;
  celebId: string;
  cik: string;
  sourceKind: string;
  provider: string;
  licenseRevision: string;
  expiresAt: string;
};
type SecOperation = {
  scheduled?: boolean;
  refreshHours?: number;
  requestId: string;
  jobId: string;
  taskId: string;
  celebId: string;
  revision: number;
  state: string;
  createdAt: string;
  errorCode: string | null;
  result: null | {
    state: string;
    reason?: string;
    sourcePageId?: string;
    observedFilings?: number;
    childRequestId?: string;
    result?: unknown;
  };
};
function CelebSourceControls({
  session,
  people,
  blocked,
  active,
  onChanged,
}: {
  session: Session;
  people: Celeb[];
  blocked: boolean;
  active: boolean;
  onChanged: () => void;
}) {
  const storage =
      "celeb-source:" +
      JSON.stringify([
        session.instance_id,
        session.user.id,
        session.user.role,
        session.receipt_scope,
      ]),
    root = "/celebs/sources";
  const [targets, setTargets] = useState<SecTarget[] | null>(null),
    [selected, setSelected] = useState(""),
    [scheduled, setScheduled] = useState(false),
    [operation, setOperation] = useState<SecOperation | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(() => {
    try {
      const id = sessionStorage.getItem(storage);
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
    live = useRef(true),
    controller = useRef<AbortController | null>(null),
    changed = useRef(onChanged);
  changed.current = onChanged;
  function clear() {
    epoch.current++;
    controller.current?.abort();
    setTargets(null);
    setOperation(null);
    setBusy(false);
  }
  useEffect(() => {
    live.current = active;
    if (!active) clear();
    const hidden = () => {
      if (document.hidden) clear();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      live.current = false;
      epoch.current++;
      controller.current?.abort();
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [active]);
  function current(run: number) {
    return live.current && active && !document.hidden && epoch.current === run;
  }
  function remember(id: string | null) {
    try {
      if (id) sessionStorage.setItem(storage, id);
      else sessionStorage.removeItem(storage);
      setPending(id);
      return true;
    } catch {
      setError("无法保留原来源请求编号，未采集");
      return false;
    }
  }
  function fail(reason: unknown) {
    if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
      clear();
      remember(null);
    }
    setError(reason instanceof Error ? reason.message : "披露来源暂不可用");
  }
  function accept(value: SecOperation, id: string) {
    if (value.requestId !== id) throw new Error("原披露来源请求归属待核对");
    setOperation(value);
    if (
      [
        "completed",
        "partial",
        "unavailable",
        "failed",
        "rejected",
        "cancelled",
      ].includes(value.state)
    ) {
      remember(null);
      if (value.state === "completed" || value.state === "partial")
        changed.current();
    }
  }
  async function sources() {
    if (busy || !active || document.hidden) return;
    const run = epoch.current,
      c = new AbortController();
    controller.current = c;
    setBusy(true);
    setError("");
    try {
      const value = await api<{ targets: SecTarget[]; state: string }>(
        root + "/targets",
        { signal: c.signal },
      );
      if (current(run)) setTargets(value.targets);
    } catch (reason) {
      if (!c.signal.aborted && current(run)) fail(reason);
    } finally {
      if (current(run)) setBusy(false);
    }
  }
  async function collect() {
    const target = targets?.find((item) => item.id === selected),
      person = people.find((item) => item.id === target?.celebId);
    if (
      !target ||
      !person ||
      busy ||
      blocked ||
      pending ||
      !active ||
      document.hidden
    )
      return;
    if (scheduled && person.refreshHours <= 0) {
      setError("定时授权须先明确登记大于0的刷新间隔");
      return;
    }
    const id = requestId();
    if (!remember(id)) return;
    const run = epoch.current;
    setBusy(true);
    setError("");
    try {
      const value = await api<SecOperation>(
        root + "/collect",
        {
          method: "POST",
          body: JSON.stringify({
            requestId: id,
            celebId: person.id,
            revision: person.revision,
            targetId: target.id,
            ...(scheduled ? { scheduled: true } : {}),
          }),
        },
        session.csrf,
      );
      if (current(run)) accept(value, id);
    } catch (reason) {
      if (current(run)) {
        fail(reason);
        if (
          reason instanceof ApiError &&
          [400, 404, 409, 413, 415, 422, 429].includes(reason.status)
        ) {
          try {
            const value = await api<SecOperation>(root + "/operations/" + id);
            if (current(run)) accept(value, id);
          } catch (lookup) {
            if (
              current(run) &&
              lookup instanceof ApiError &&
              lookup.status === 404
            )
              remember(null);
          }
        }
      }
    } finally {
      if (current(run)) setBusy(false);
    }
  }
  async function query() {
    if (!pending || busy || !active || document.hidden) return;
    const id = pending,
      run = epoch.current;
    setBusy(true);
    setError("");
    try {
      const value = await api<SecOperation>(root + "/operations/" + id);
      if (current(run)) accept(value, id);
    } catch (reason) {
      if (current(run)) fail(reason);
    } finally {
      if (current(run)) setBusy(false);
    }
  }
  async function download(page: string) {
    if (busy || !active || document.hidden) return;
    const run = epoch.current,
      c = new AbortController();
    controller.current = c;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api" + root + "/originals/" + encodeURIComponent(page),
        {
          credentials: "same-origin",
          headers: { "X-CSRF-Token": session.csrf },
          signal: c.signal,
        },
      );
      if (!response.ok) throw new ApiError(response.status, "披露原件暂不可读");
      const blob = await response.blob();
      if (!current(run)) return;
      const value = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = value;
      anchor.download = "celeb-source-" + page;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(value), 0);
    } catch (reason) {
      if (!c.signal.aborted && current(run)) fail(reason);
    } finally {
      if (current(run)) setBusy(false);
    }
  }
  return (
    <details>
      <summary>明确采集已安装披露来源</summary>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy} onClick={() => void sources()}>
        读取已安装 SEC 来源
      </button>
      {targets && !targets.length && (
        <p>未配置可用披露来源，不自动安装或采集</p>
      )}
      <label>
        人物来源
        <select
          value={selected}
          disabled={busy || blocked || !!pending}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">选择已安装来源</option>
          {targets?.map((target) => (
            <option key={target.id} value={target.id}>
              {people.find((person) => person.id === target.celebId)?.name ||
                target.celebId}{" "}
              · {target.sourceKind} · CIK {target.cik} ·{" "}
              {target.licenseRevision} · 到期 {target.expiresAt}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={scheduled}
          disabled={busy || blocked || !!pending}
          onChange={(event) => setScheduled(event.target.checked)}
        />
        本次同时授权按已登记间隔定时采集（间隔需大于0）
      </label>
      <button
        disabled={busy || blocked || !!pending || !selected}
        onClick={() => void collect()}
      >
        {scheduled ? "明确采集并登记定时授权" : "明确登记一次披露采集任务"}
      </button>
      {pending && (
        <div>
          <p role="status">
            {operation?.state === "queued"
              ? "采集任务已登记，尚未完成"
              : "披露来源请求待核对"}
          </p>
          <code>{pending}</code>
          <button disabled={busy} onClick={() => void query()}>
            读取原请求
          </button>
        </div>
      )}
      {operation && (
        <div>
          <p>
            来源状态{" "}
            {(
              {
                queued: "等待执行",
                running: "执行中",
                completed: "本次采集完成",
                partial: "部分披露已登记，未解析部分保留且停止自动续取",
                unavailable: "本次来源不可用",
                unknown: "结果未知，仅核对原请求",
                failed: "失败",
              } as Record<string, string>
            )[operation.state] || operation.state}{" "}
            · 人物 {operation.celebId} · 请求 {operation.requestId}
          </p>
          {operation.scheduled && (
            <p>
              本次已明确授权定时 · 间隔 {operation.refreshHours ?? "未知"} 小时
              {["partial", "unknown", "unavailable", "failed"].includes(
                operation.state,
              )
                ? " · 当前已停止自动续取"
                : ""}
            </p>
          )}
          {operation.result?.reason && <p>{operation.result.reason}</p>}
          {operation.result?.observedFilings !== undefined && (
            <p>
              本次已观察披露 {operation.result.observedFilings}{" "}
              份，不作为完整交易历史
            </p>
          )}
          {operation.result?.childRequestId && (
            <small>派生目录回执 {operation.result.childRequestId}</small>
          )}
          {operation.result?.sourcePageId && (
            <button
              disabled={busy}
              onClick={() => void download(operation.result!.sourcePageId!)}
            >
              下载保留披露原件
            </button>
          )}
        </div>
      )}
    </details>
  );
}
