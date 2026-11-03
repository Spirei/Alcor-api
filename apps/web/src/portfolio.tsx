import {watchRecordsPath,allDisplayedRecordsSelected} from './watch-display-state';
import { PrivateAmount, MarketBadge } from "./financial-display";
import {PortfolioAnalysis} from "./portfolio-analysis";
import {WatchDisplaySettings,watchDisplayValue,type WatchDisplayState} from "./watch-display-settings";
import {RecordFiles} from "./record-files";
import {RecordBatchDelete} from "./record-batch-delete";
import { Activity, useCallback, useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Trash2, Pencil } from "lucide-react";
import { api, ApiError } from "./api";
import type { Session } from "./api";
import { requestId } from "./request-id";
import { Dialog } from "./dialog";
import { SelectMenu } from "./select-menu";
import "./portfolio.css";
import { FinancialLedger } from "./financial-ledger";
import {
  operationPath,
  restoreOperation,
  saveOperation,
  updateOperation,
} from "./operation-journal";
import type { PendingOperation } from "./operation-journal";
import {
  submissionDisposition,
  mayReleaseMissingReceipt,
  recordsPagePath,
  accountLabel,
  previewAccountLabel,
} from "./portfolio-operation";

import { AssetInstrumentSettings } from "./asset-instruments";
import { SharedBrokerSettings } from "./shared-brokers";
import { BrokerPositionTransferSettings } from "./broker-position-transfers";
import { BrokerIconSettings } from "./broker-icons";
import { BrokerHoldingSourceSettings } from "./broker-holding-source";
import { BrokerMetadataSettings } from "./broker-metadata";
import { BrokerBindingsSettings } from "./broker-bindings";
import { BrokerStatementPreview } from "./broker-statements";
import {
  brokerProviders,
  type BrokerAccount as Broker,
} from "./broker-account-state";
type RecordRow = {
  accountMarket?: string; source?: string; watchGroupId?: string; note?: string; registeredQty?: string|null; registeredCost?: string|null; registeredPrice?: string|null;
  id: string;
  name: string;
  code: string;
  market: string;
  qty: string | null;
  cost: string | null;
  price: string | null;
  brokerAccountId: string;
  revision: number;
  historyState: string;
  officialObservation?: { reportDate: string | null; state: string };
  costAuthority?: string;
  group: string;
};
type Listing = {
  displayRevision?: string|null;
  displayMode?: "all"|"watch";
  records: RecordRow[];
  total: number;
  page: number;
  collectionRevision: number;
};
type Preview = {
  previewId: string;
  before: RecordRow | null;
  after: Record<string, unknown> | null;
  kind: string;
  expiresAt: string;
};
const emptyDraft = {
  name: "",
  code: "",
  market: "US",
  qty: "",
  cost: "",
  price: "",
  brokerAccountId: "",
  group: "",
  note: "",
  accountMarket: "", source: "", watchGroupId: "",
};
const display = (value: string | null) => (value === null ? "—" : value);

export function PortfolioPage({ session }: { session: Session }) {
  const scope = JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  return <PortfolioSession key={scope} session={session} />;
}

function PortfolioSession({ session }: { session: Session }) {
  const [instrumentRecord,setInstrumentRecord] = useState<string | null>(null);
  const [sharedBrokersOpen,setSharedBrokersOpen] = useState(false);
  const [transferAccount,setTransferAccount] = useState<string | null>(null);
  const [iconAccount,setIconAccount] = useState<Broker | null>(null);
  const [sourceAccount,setSourceAccount] = useState<string | null>(null);
  const [section, setSection] = useState<"records" | "brokers" | "ledger">(
    "records",
  );
  const [watchDisplay,setWatchDisplay]=useState<WatchDisplayState|null>(null);
  const [onlyFollowed,setOnlyFollowed]=useState(true);
  const [selectedRecords,setSelectedRecords]=useState<Set<string>>(new Set());
  useEffect(()=>setSelectedRecords(new Set()),[watchDisplay,onlyFollowed]);
  const [records, setRecords] = useState<Listing | null>(null);
  useEffect(()=>setSelectedRecords(new Set()),[records]);
  const [brokers, setBrokers] = useState<Broker[] | null>(null);
  const [page, setPage] = useState(1);
  const [brokerFilter, setBrokerFilter] = useState("");
  const collectionRevision = useRef<number | null>(null);
  const displayRevision = useRef<string|null>(null);
  const [error, setError] = useState("");
  const [receiptMessage, setReceiptMessage] = useState("");
  const [recordsError, setRecordsError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingRecord,setEditingRecord]=useState<RecordRow|null>(null);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [preview, setPreview] = useState<Preview | null>(null);
  const receiptScope = JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  const [initialReceipt] = useState(() => {
    try {
      return {
        pending: restoreOperation(sessionStorage, receiptScope),
        error: "",
      };
    } catch {
      return {
        pending: null,
        error: "无法读取原操作编号，请先恢复浏览器存储后刷新核对。",
      };
    }
  });
  const [pending, setPending] = useState<PendingOperation | null>(
    initialReceipt.pending,
  );
  const pendingRef = useRef(pending);
  const [journalError, setJournalError] = useState(initialReceipt.error);
  const changeReceipt = (
    id: string,
    value: PendingOperation | null,
  ): boolean => {
    if (pendingRef.current?.id !== id) return false;
    try {
      if (!updateOperation(sessionStorage, receiptScope, id, value))
        throw new Error("receipt changed");
      pendingRef.current = value;
      setPending(value);
      setJournalError("");
      return true;
    } catch {
      setJournalError("无法保存原操作状态，请恢复浏览器存储后继续查询原请求。");
      return false;
    }
  };
  const beginReceipt = (
    kind: PendingOperation["kind"],
    preparedId?: string,
  ): string | null => {
    if (
      pendingRef.current ||
      journalError ||
      document.hidden ||
      !active.current
    )
      return null;
    const id = preparedId || requestId();
    setReceiptMessage("");
    const value = { id, kind };
    try {
      saveOperation(sessionStorage, receiptScope, value);
    } catch {
      setJournalError("无法保留操作编号，请检查浏览器存储后重试。");
      return null;
    }
    pendingRef.current = value;
    setPending(value);
    return id;
  };
  const [brokerEditing, setBrokerEditing] = useState<Broker | null>(null);
  const [ledgerAccount, setLedgerAccount] = useState({ id: "", request: 0 });
  const [newBroker, setNewBroker] = useState(false);
  const [bindingAccount, setBindingAccount] = useState<string | null>(null);
  const [statementAccount, setStatementAccount] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const active = useRef(false);
  const epoch = useRef(0);
  const report = (value: unknown) => {
    setError(value instanceof Error ? value.message : "操作失败");
    if (value instanceof ApiError && [401, 403].includes(value.status)) {
      ++epoch.current;
      active.current = false;
      setBusy(false);
      setRecords(null);
      setBrokers(null);
      setPreview(null);
      setEdit(false);
      setNewBroker(false);
      setInstrumentRecord(null);
      setTransferAccount(null);
      setSourceAccount(null);
      setIconAccount(null);
      setBindingAccount(null);
      setStatementAccount(null);
      setDraft(emptyDraft);
      setEditingRecord(null);
      setBrokerEditing(null);
      setReceiptMessage("");
    }
  };
  const refresh = useCallback(() => {
    setPreview(null);
    setRecords(null);
    setBrokers(null);
    collectionRevision.current = null;
    displayRevision.current = null;
    setPage(1);
    setGeneration((v) => v + 1);
  }, []);
  useEffect(() => {
    if (document.hidden) return;
    if(page>1&&(collectionRevision.current===null||(onlyFollowed&&!displayRevision.current))){setPage(1);return;}
    active.current = true;
    try {
      const stored = restoreOperation(sessionStorage, receiptScope);
      pendingRef.current = stored;
      setPending(stored);
      setJournalError("");
    } catch {
      setJournalError("操作编号无法读取，请先核对原请求。");
    }
    const current = ++epoch.current;
    const controller = new AbortController();
    setPreview(null);
    setRecords(null);
    setBrokers(null);
    setError("");
    setRecordsError("");
    const revision = collectionRevision.current;
    Promise.allSettled([
      api<Listing>(watchRecordsPath(recordsPagePath(page, revision, brokerFilter),onlyFollowed,displayRevision.current), {
        signal: controller.signal,
      }),
      api<{ items: Broker[] }>("/broker-accounts", {
        signal: controller.signal,
      }),
    ]).then(([listing, directory]) => {
      if (
        controller.signal.aborted ||
        !active.current ||
        epoch.current !== current
      )
        return;
      const denied = [listing, directory].find(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof ApiError &&
          [401, 403].includes(result.reason.status),
      );
      if (denied?.status === "rejected") {
        report(denied.reason);
        return;
      }
      if (directory.status === "fulfilled") setBrokers(directory.value.items);
      if (listing.status === "fulfilled") {
        if(onlyFollowed&&(listing.value.displayMode!=="watch"||!listing.value.displayRevision||!/^[a-f0-9]{64}$/.test(listing.value.displayRevision))){setRecordsError("关注显示版本待核对，请重新读取");return;}
        displayRevision.current=listing.value.displayRevision??null;
        collectionRevision.current = listing.value.collectionRevision;
        setRecords(listing.value);
      } else {
        // Only a stale pagination snapshot merits a single fresh first-page read.
        // Persistent coverage conflicts must remain visible without a request loop.
        if (
          listing.reason instanceof ApiError &&
          listing.reason.status === 409 &&
          page > 1 &&
          revision !== null
        ) {
          collectionRevision.current = null;
          displayRevision.current = null;
          setPage(1);
        }
        setRecordsError(
          listing.reason instanceof Error
            ? listing.reason.message
            : "资产记录读取失败",
        );
      }
      if (directory.status === "rejected") report(directory.reason);
    });
    return () => {
      active.current = false;
      ++epoch.current;
      controller.abort();
      setBusy(false);
      setPreview(null);
      setRecords(null);
      setBrokers(null);
    };
  }, [page, generation, brokerFilter,onlyFollowed]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        ++epoch.current;
        setBusy(false);
        setPreview(null);
        setRecords(null);
        setBrokers(null);
      } else {
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refresh]);
  useEffect(() => {
    if (!preview) return;
    const remaining = Date.parse(preview.expiresAt) - Date.now();
    const expire = () => {
      setPreview(null);
      setError("预览已过期，请重新核对。");
    };
    if (!Number.isFinite(remaining) || remaining <= 0) {
      expire();
      return;
    }
    const timer = setTimeout(expire, remaining);
    return () => clearTimeout(timer);
  }, [preview]);
  const prepare = async (kind: "create" | "update" | "delete", row?: RecordRow) => {
    if (
      document.hidden ||
      !active.current ||
      pendingRef.current ||
      journalError
    )
      return;
    setBusy(true);
    setError("");
    setPreview(null);
    const current = epoch.current;
    try {
      const result = await api<Preview>(
        "/portfolio/records/preview",
        {
          method: "POST",
          body: JSON.stringify(
            kind !== "delete"
              ? {
                  kind,
                  ...(kind === "update" && editingRecord ? {recordId:editingRecord.id,revision:editingRecord.revision}:{}),
                  data: {
                    ...draft,
                    qty: draft.qty || null,
                    cost: draft.cost || null,
                    price: draft.price || null,
                  },
                }
              : { kind, recordId: row!.id, revision: row!.revision },
          ),
        },
        session.csrf,
      );
      if (active.current && current === epoch.current) setPreview(result);
    } catch (e) {
      if (active.current && current === epoch.current) report(e);
    } finally {
      if (active.current && current === epoch.current) setBusy(false);
    }
  };
  const startRecordEdit = async (row:RecordRow) => {
    if(busy||pendingRef.current||document.hidden||!active.current)return;
    const run=epoch.current;setBusy(true);setError("");setPreview(null);
    try{const result=await api<{record:RecordRow}>("/portfolio/records/"+encodeURIComponent(row.id));if(!active.current||epoch.current!==run||document.hidden)return;const current=result.record;const registered=(name:"qty"|"cost"|"price")=>{const key=({qty:"registeredQty",cost:"registeredCost",price:"registeredPrice"} as const)[name];return (Object.prototype.hasOwnProperty.call(current,key)?current[key]:current[name])??"";};setEditingRecord(current);setDraft({...emptyDraft,name:current.name,code:current.code,market:current.market,qty:registered("qty"),cost:registered("cost"),price:registered("price"),group:current.group,note:current.note||"",brokerAccountId:current.brokerAccountId,accountMarket:current.accountMarket||"",source:current.source||"",watchGroupId:current.watchGroupId||""});setEdit(true);}catch(e){if(epoch.current===run)report(e);}finally{if(epoch.current===run)setBusy(false);}
  };
  const confirm = async () => {
    if (!preview || pendingRef.current) return;
    if (!(Date.parse(preview.expiresAt) > Date.now())) {
      setPreview(null);
      setError("预览已过期，请重新核对。");
      return;
    }
    const id = beginReceipt("record");
    if (!id) return;
    setBusy(true);
    setError("");
    const proof = preview.previewId;
    setPreview(null);
    setEdit(false);
    try {
      const result=await api<{requestId:string;state:string}>(
        "/portfolio/records/confirm",
        {
          method: "POST",
          body: JSON.stringify({ previewId: proof, requestId: id }),
        },
        session.csrf,
      );
      if(result.requestId!==id||result.state!=="completed")throw new Error("原记录操作仍待核对");
      if (!changeReceipt(id, null)) return;
      setEditingRecord(null);
      setEdit(false);
      setDraft(emptyDraft);
      refresh();
    } catch (e) {
      if (
        submissionDisposition(e instanceof ApiError ? e.status : undefined) ===
        "rejected"
      )
        changeReceipt(id, null);
      else
        changeReceipt(id, {
          id,
          kind: "record",
          submissionStatus: e instanceof ApiError ? e.status : undefined,
        });
      report(e);
    } finally {
      setBusy(false);
    }
  };
  const checkReceipt = async (close = false) => {
    const original = pendingRef.current;
    if (!original || busy || !active.current || document.hidden || (close && original.kind !== "cash")) return;
    const current = epoch.current;
    setBusy(true);
    setError("");
    setReceiptMessage("");
    try {
      const result = await api<{
        state?: string;
        requestId?: string;
        executed?: boolean;
        message?: string;
        error?: { message?: string };
      }>(`${operationPath(original.kind)}/operations/${original.id}${close ? "/close" : ""}`,close ? { method: "POST",body: "{}" } : {},close ? session.csrf : undefined);
      if (!active.current || epoch.current !== current || document.hidden) return;
      if (["record","cash","trade","order","trade_amendment"].includes(original.kind) && result.requestId !== original.id)
        throw new Error("原请求回执仍待核对");
      if (result.state !== "failed" && result.state !== "completed" && !(original.kind === "cash" && result.state === "closed" && result.executed === false))
        throw new Error("原请求尚无最终回执，请稍后继续查询。");
      if (result.state === "failed") {
        if (!changeReceipt(original.id, null)) return;
        setError(result.error?.message || result.message || "操作被拒绝");
        return;
      }
      if (!changeReceipt(original.id, null)) return;
      if (result.state === "closed") setReceiptMessage("原请求已关闭，未执行");
      else if (original.kind === "cash") setReceiptMessage("原现金请求已完成");
      setEdit(false);
      setNewBroker(false);
      refresh();
    } catch (e) {
      if (!active.current || epoch.current !== current || document.hidden) return;
      if (e instanceof ApiError && e.status === 404) {
        if (original.kind !== "cash" && mayReleaseMissingReceipt(original.submissionStatus)) {
          if (changeReceipt(original.id, null)) refresh();
        } else setError("原请求尚无最终回执，请稍后继续查询。");
      } else report(e);
    } finally {
      if (active.current && current === epoch.current) setBusy(false);
    }
  };
  const editBroker = (id: string) => {
    if (busy || pendingRef.current || journalError || !active.current || document.hidden) return;
    const row = brokers?.find(account => account.id === id);
    if (!row) { setError("账户已变化，请重新读取"); return; }
    setBrokerEditing(row);
    setNewBroker(true);
  };
  const submitFinancial = async (
    kind: "cash" | "trade" | "order" | "trade_amendment" | "financing_policy",
    data: Record<string, unknown>,
    proof: string,
  ): Promise<boolean> => {
    const id = beginReceipt(kind, String(data.requestId));
    if (!id) return false;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ state?: string; requestId?: string }>(
        `${operationPath(kind)}/operations`,
        { method: "POST", body: JSON.stringify({ data, preview: proof }) },
        session.csrf,
      );
      if (result.state !== "completed" || result.requestId !== id) throw new Error("操作结果待核对");
      if (!changeReceipt(id, null)) return false;
      refresh();
      return true;
    } catch (e) {
      if (
        submissionDisposition(e instanceof ApiError ? e.status : undefined) ===
        "rejected"
      )
        changeReceipt(id, null);
      else
        changeReceipt(id, {
          id,
          kind,
          submissionStatus: e instanceof ApiError ? e.status : undefined,
        });
      report(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const displayedRecords=records?.records??[];
  return (
    <section className="portfolio-page">
      <div className="page-heading">
        <h1>资产记录</h1>
        <button
          className="icon-button"
          aria-label="刷新资产记录"
          onClick={refresh}
          disabled={busy}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      <div className="portfolio-tabs" role="group" aria-label="资产视图">
        <button
          className={section === "records" ? "button primary" : "button"}
          onClick={() => setSection("records")}
        >
          持仓与自选
        </button>
        <button
          className={section === "brokers" ? "button primary" : "button"}
          onClick={() => setSection("brokers")}
        >
          券商账户
        </button>
        <button
          className={section === "ledger" ? "button primary" : "button"}
          onClick={() => setSection("ledger")}
        >
          现金与交易
        </button>
      </div>
      {section === "records" && recordsError && (
        <p role="alert" className="error">
          {recordsError}
        </p>
      )}
      {(journalError || error) && (
        <p role="alert" className="error">
          {journalError || error}
        </p>
      )}
      {receiptMessage && <p role="status">{receiptMessage}</p>}
      {pending && (
        <div role="status" className="portfolio-receipt">
          <span>操作结果待核对</span>
          <button
            className="button"
            disabled={busy}
            onClick={() => void checkReceipt()}
          >
            查询原请求
          </button>
          {pending.kind === "cash" && <button className="button" disabled={busy} onClick={() => void checkReceipt(true)}>关闭未执行请求</button>}
        </div>
      )}
      <Activity mode={section === "ledger" ? "visible" : "hidden"}>
        <FinancialLedger
          session={session}
          brokers={brokers}
          generation={generation}
          focusAccount={ledgerAccount}
          blocked={!!pending || !!journalError || busy}
          onSubmit={submitFinancial}
        />
      </Activity>
      {section === "records" ? (
        <>
          <div className="portfolio-actions">
            <SelectMenu
              label="查看账户"
              variant="field"
              value={brokerFilter}
              onChange={(value) => {
                collectionRevision.current = null;
                setPage(1);
                setPreview(null);
                setBrokerFilter(value);
              }}
              options={[
                { value: "", label: "全部账户" },
                ...(brokers || []).map((b) => ({ value: b.id, label: b.name })),
              ]}
              disabled={busy || !brokers}
            />
            <button
              className="button"
              onClick={() => {setEditingRecord(null);setDraft(emptyDraft);setEdit(true);}}
              disabled={!!pending || !!journalError || busy || !brokers}
            >
              <Plus size={16} />
              添加记录
            </button>
          </div>
          <PortfolioAnalysis session={session} active={section==="records"} generation={generation} onDenied={report}/>
          <WatchDisplaySettings session={session} records={records?.records||[]} complete={!!records&&records.total===records.records.length&&!brokerFilter} active={section==="records"} blocked={busy||!!pending||!!journalError} onState={setWatchDisplay} onChanged={refresh} onDenied={report}/>
          <label><input type="checkbox" checked={onlyFollowed} onChange={e=>{setOnlyFollowed(e.target.checked);refresh();}}/>仅显示关注记录</label>
          <RecordFiles session={session} records={records?.records||[]} brokers={brokers||[]} generation={generation} blocked={busy||!!pending||!!journalError} onChanged={refresh} onDenied={report}/>
          <RecordBatchDelete session={session} records={(records?.records||[]).filter(row=>selectedRecords.has(row.id))} collectionRevision={records?.collectionRevision??0} generation={generation} blocked={busy||!!pending||!!journalError||!records} onChanged={refresh} onDenied={report}/>
          {records&&records.records.some(row=>watchDisplayValue(watchDisplay,"hidden",row.id)===true)&&<p>本页已取消关注 {records.records.filter(row=>watchDisplayValue(watchDisplay,"hidden",row.id)===true).length} 条；持仓与原记录保留</p>}
          {!records ? (
            !error ? (
              <p role="status">正在读取…</p>
            ) : null
          ) : records.total === 0 ? (
            <p>暂无记录</p>
          ) : (
            <>
              <div className="portfolio-table">
                <table>
                  <thead>
                    <tr>
                      <th><input type="checkbox" aria-label="选择本页全部记录" checked={allDisplayedRecordsSelected(displayedRecords,selectedRecords)} disabled={busy||!!pending||!!journalError} onChange={event=>setSelectedRecords(event.target.checked?new Set(displayedRecords.map(row=>row.id)):new Set())}/></th>
                      <th>证券</th>
                      <th>市场</th>
                      <th>数量</th>
                      <th>成本</th>
                      <th>价格</th>
                      <th>账户</th>
                      <th>
                        <span className="sr-only">操作</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedRecords.map((row) => (
                      <tr key={row.id}>
                        <td><input type="checkbox" aria-label={`选择 ${row.name}`} checked={selectedRecords.has(row.id)} disabled={busy||!!pending||!!journalError} onChange={event=>setSelectedRecords(previous=>{const next=new Set(previous);if(event.target.checked)next.add(row.id);else next.delete(row.id);return next;})}/></td>
                        <td>
                          {typeof watchDisplayValue(watchDisplay,'aliases',row.id)==='string'&&String(watchDisplayValue(watchDisplay,'aliases',row.id)).trim()?String(watchDisplayValue(watchDisplay,'aliases',row.id)):row.name}
                          <small>{row.code}{watchDisplayValue(watchDisplay,'pinned',row.id)===true?' · 置顶':''}{watchDisplayValue(watchDisplay,'hidden',row.id)===true?' · 已取消关注':''}</small>
                          {typeof watchDisplayValue(watchDisplay,'notes',row.id)==='string'&&<small>显示备注 · {String(watchDisplayValue(watchDisplay,'notes',row.id))}</small>}
                          {row.officialObservation && <small>官方账单 · {row.officialObservation.reportDate ? `截至 ${row.officialObservation.reportDate}` : "报告日期未知"}</small>}
                        </td>
                        <td><MarketBadge market={row.market}/></td>
                        <td><PrivateAmount>{row.officialObservation ? row.qty ?? "未知" : display(row.qty)}</PrivateAmount></td>
                        <td><PrivateAmount>{row.officialObservation ? row.cost ?? "未知" : display(row.cost)}</PrivateAmount>
                          {row.costAuthority === "official_reported_cost_basis" && <small>报告成本基础 · 非实付费用确认</small>}
                        </td>
                        <td><PrivateAmount>{row.officialObservation ? row.price ?? "未知" : display(row.price)}</PrivateAmount><small>{row.officialObservation ? "报告价格" : "登记价格"}</small></td>
                        <td>{accountLabel(row.brokerAccountId, brokers)}</td>
                        <td>
                          <button className="icon-button" aria-label={`编辑 ${row.name}`} disabled={busy||!!pending||!!journalError} onClick={()=>void startRecordEdit(row)}><Pencil size={16}/></button>
                          <button className="button" disabled={busy || !!pending || !!journalError} onClick={()=>setInstrumentRecord(row.id)}>证券声明</button>
                          <button
                            className="icon-button"
                            aria-label={`删除 ${row.name}`}
                            disabled={busy || !!pending || !!journalError}
                            onClick={() => void prepare("delete", row)}
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="portfolio-actions">
                <button
                  className="button"
                  disabled={page === 1 || busy}
                  onClick={() => setPage((v) => v - 1)}
                >
                  上一页
                </button>
                <span>
                  {page} / {Math.ceil(records.total / 25)}
                </span>
                <button
                  className="button"
                  disabled={page * 25 >= records.total || busy}
                  onClick={() => setPage((v) => v + 1)}
                >
                  下一页
                </button>
              </div>
            </>
          )}
        </>
      ) : section === "brokers" ? (
        <>
          <div className="portfolio-actions">
            <button
              className="button"
              onClick={() => {
                setBrokerEditing(null);
                          setNewBroker(true);
              }}
              disabled={!!pending || !!journalError || busy || !brokers}
            >
              <Plus size={16} />
              添加账户
            </button>
          </div>
          {!brokers ? (
            <p role="status">正在读取…</p>
          ) : brokers.length === 0 ? (
            <p>暂无账户</p>
          ) : (
            <ul className="portfolio-brokers">
              {brokers.map((b) => (
                <li key={b.id}>
                  <span>{b.name}<small>{b.holding_source === "official" ? "官方账单" : b.holding_source === "manual" ? "手工登记" : "来源未核实"}</small></span>
                  <span>
                    {b.account_kind === "real"
                      ? "真实"
                      : b.account_kind === "simulated"
                        ? "模拟"
                        : "来源未核实"}{" "}
                    · {b.currencies.join(" · ")} ·{" "}
                    {brokerProviders.find(
                      (value) => value.value === b.provider_id,
                    )?.label ??
                      b.provider_id ??
                      "未指定机构"}
                  </span>
                  <span className="broker-row-actions">
                    {b.holding_source === "manual" && ["real","simulated"].includes(b.account_kind) && <button className="button" disabled={busy || !!pending || !!journalError} onClick={()=>setTransferAccount(b.id)}>持仓转仓</button>}
                    <button className="button" disabled={busy || !!pending || !!journalError} onClick={()=>setIconAccount(b)}>图标</button>
                    {b.holding_source === "official" && <button className="button" disabled={busy || !!pending || !!journalError} onClick={()=>setSourceAccount(b.id)}>持仓来源</button>}
                    <button
                      className="button"
                      onClick={() => {
                        setLedgerAccount((value) => ({
                          id: b.id,
                          request: value.request + 1,
                        }));
                        setSection("ledger");
                      }}
                    >
                      原币现金
                    </button>
                    <button className="button" disabled={busy || !!pending || !!journalError || b.holding_source !== "manual" || !["real","simulated"].includes(b.account_kind)} onClick={() => setBindingAccount(b.id)}>记录归属</button>
                    <button className="button" disabled={busy || !!pending || !!journalError} onClick={() => setStatementAccount(b.id)}>账单预览</button>
                    <button
                      className="icon-button"
                      aria-label={`编辑账户 ${b.name}`}
                      disabled={
                        busy ||
                        !!pending ||
                        !!journalError ||
                        b.holding_source !== "manual"
                      }
                      onClick={() => void editBroker(b.id)}
                    >
                      <Pencil size={16} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {session.user.role === "admin" && <details onToggle={event=>setSharedBrokersOpen(event.currentTarget.open)}><summary>共享券商目录</summary><Activity mode={sharedBrokersOpen ? "visible" : "hidden"}><SharedBrokerSettings session={session}/></Activity></details>}
        </>
      ) : null}
      {edit && !preview && (
        <Dialog
          title={editingRecord?"编辑记录":"添加记录"}
          onClose={() => {
            if (!busy) setEdit(false);
          }}
        >
          <form
            className="portfolio-form"
            onSubmit={(e) => {
              e.preventDefault();
              void prepare(editingRecord?"update":"create");
            }}
          >
            {section === "records" && recordsError && (
              <p role="alert" className="error">
                {recordsError}
              </p>
            )}
            {(journalError || error) && (
              <p role="alert" className="error">
                {journalError || error}
              </p>
            )}
            {(["name", "code"] as const).map((key) => (
              <label key={key}>
                {key === "name" ? "名称" : "代码"}
                <input
                  required
                  value={draft[key]}
                  maxLength={key === "name" ? 100 : 40}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: e.target.value })
                  }
                />
              </label>
            ))}
            <label>
              市场
              <SelectMenu
                label="市场"
                variant="field"
                value={draft.market}
                onChange={(market) => setDraft({ ...draft, market })}
                options={["US", "HK", "CN", "SG", "JP", "KR", "UK"].map(
                  (value) => ({ value, label: value }),
                )}
              />
            </label>
            <label>
              账户
              <SelectMenu
                label="账户"
                variant="field"
                value={draft.brokerAccountId}
                onChange={(brokerAccountId) =>
                  setDraft({ ...draft, brokerAccountId })
                }
                options={[
                  { value: "", label: "未归属" },
                  ...(brokers || [])
                    .filter(
                      (b) =>
                        b.holding_source === "manual" &&
                        b.account_kind !== "unknown",
                    )
                    .map((b) => ({
                      value: b.id,
                      label: `${b.name} · ${b.account_kind === "simulated" ? "模拟" : "真实"}`,
                    })),
                ]}
              />
            </label>
            {draft.market === "HK" && <label>账户市场<SelectMenu label="账户市场" variant="field" value={draft.accountMarket} onChange={value=>setDraft({...draft,accountMarket:value})} options={[{value:"",label:"HK"},{value:"CN",label:"CN · 港股通"}]}/></label>}
            {(["qty", "cost", "price"] as const).map((key) => (
              <label key={key}>
                {key === "qty" ? "数量" : key === "cost" ? "成本" : "登记价格"}
                <input
                  inputMode="decimal"
                  value={draft[key]}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: e.target.value })
                  }
                />
              </label>
            ))}
            <label>分组<input value={draft.group} maxLength={100} onChange={e=>setDraft({...draft,group:e.target.value})}/></label>
            {editingRecord&&<p>原记录 {editingRecord.id} · 来源 {draft.source||"未知"} · 历史 {editingRecord.historyState}</p>}
            <label>
              备注
              <input
                value={draft.note}
                maxLength={500}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </label>
            <button
              className="button primary"
              disabled={busy || !!pending || !!journalError}
            >
              核对变更
            </button>
          </form>
        </Dialog>
      )}
      {preview && (
        <Dialog
          title={preview.kind === "delete" ? "确认删除" : "确认记录"}
          onClose={() => setPreview(null)}
        >
          <dl className="portfolio-proof">
            {Object.entries(preview.after || preview.before || {})
              .filter(([key]) =>
                [
                  "name",
                  "code",
                  "market",
                  "qty",
                  "cost",
                  "price",
                  "brokerAccountId",
                ].includes(key),
              )
              .map(([key, value]) => (
                <div key={key}>
                  <dt>
                    {
                      {
                        name: "名称",
                        code: "代码",
                        market: "市场",
                        qty: "数量",
                        cost: "成本",
                        price: "登记价格",
                        brokerAccountId: "账户",
                      }[key]
                    }
                  </dt>
                  <dd>
                    {key === "brokerAccountId"
                      ? previewAccountLabel(
                          value,
                          (preview.after || preview.before || {}) as Record<
                            string,
                            unknown
                          >,
                        )
                      : value === null
                        ? "未提供"
                        : String(value)}
                  </dd>
                </div>
              ))}
          </dl>
          <button
            className="button primary"
            disabled={busy || !!pending || !!journalError}
            onClick={() => void confirm()}
          >
            确认{preview.kind === "delete" ? "删除" : "保存"}
          </button>
        </Dialog>
      )}
      {newBroker && (
        <Dialog
          title={brokerEditing ? "编辑账户" : "添加账户"}
          onClose={() => {
            if (!busy) setNewBroker(false);
          }}
        >
          <BrokerMetadataSettings
            session={session}
            initialAccountId={brokerEditing?.id || ""}
            onChanged={() => {
              setNewBroker(false);
              setBrokerEditing(null);
              refresh();
            }}
          />
        </Dialog>
      )}
      {instrumentRecord && <Dialog title="证券声明" onClose={()=>setInstrumentRecord(null)}><AssetInstrumentSettings session={session} recordId={instrumentRecord} onChanged={()=>{setInstrumentRecord(null);refresh();}} /></Dialog>}
      {transferAccount && <Dialog title="持仓转仓" onClose={()=>setTransferAccount(null)}><BrokerPositionTransferSettings session={session} accountId={transferAccount} onChanged={()=>{setTransferAccount(null);refresh();}} /></Dialog>}
      {iconAccount && <Dialog title="账户图标" onClose={()=>setIconAccount(null)}><BrokerIconSettings session={session} account={iconAccount} onChanged={()=>{setIconAccount(null);refresh();}} /></Dialog>}
      {sourceAccount && <Dialog title="持仓来源" onClose={()=>setSourceAccount(null)}><BrokerHoldingSourceSettings session={session} accountId={sourceAccount} onChanged={()=>{setSourceAccount(null);refresh();}} /></Dialog>}
      {bindingAccount && <Dialog title="记录归属" onClose={() => setBindingAccount(null)}><BrokerBindingsSettings session={session} initialAccountId={bindingAccount} onChanged={() => { setBindingAccount(null); refresh(); }} /></Dialog>}
      {statementAccount && <Dialog title="账单预览" onClose={() => setStatementAccount(null)}><BrokerStatementPreview session={session} initialAccountId={statementAccount} /></Dialog>}
    </section>
  );
}
