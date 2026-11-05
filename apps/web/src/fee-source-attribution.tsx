import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { requestId } from "./request-id";
import { SettingsSurface } from "./workspace-forms";
import { RefreshCw } from "lucide-react";

type Account = {
  id: string;
  name: string;
  accountKind: string;
  holdingSource: string;
  revision: number;
};
type RecordRow = {
  id: string;
  name: string;
  market: string;
  code: string;
  brokerAccountId: string | null;
  revision: number;
};
type Original = {
  orderId: string;
  originalRecordId: string;
  status: string;
  feeAuthority: string | null;
  sourceInputHash: string;
  originalCashAttribution: unknown;
  input: {
    market: string | null;
    code: string | null;
    accountKind: string | null;
    side: string;
    quantity: string | number | null;
    price: string | number | null;
    fees: string | number | null;
    currency: string | null;
    occurredAt: string | null;
  };
};
type Listing = {
  state: string;
  inventoryRevision?: string;
  sourceRevision: number | null;
  sourceDigest: string | null;
  sourceVerified: boolean;
  sourceComplete?: boolean;
  sourceOwner?: string;
  sourceInstance?: string;
  orders: Original[];
  accounts: Account[];
  records: RecordRow[];
  pagination: {
    offset: number;
    limit: number;
    total: number | null;
    nextOffset: number | null;
  };
};
type Command = {
  requestId: string;
  sourceRevision: number;
  sourceDigest: string;
  orderId: string;
  recordId: string;
  recordRevision: number;
  brokerAccountId: string;
  brokerRevision: number;
  basis: {
    documentDigest: string;
    historicalAccountConfirmed: true;
    completeOrderHistoryConfirmed: true;
  };
};
type Proof = {
  preview: string;
  expiresAt: string;
  orderId: string;
  proposedBrokerAccountId: string;
  recordId: string;
  sourceInputHash: string;
  originalAccountKind: string | null;
  targetAccountKind: string;
  financialApplied: false;
  cashEffect: null;
  ledgerWrites: 0;
  confirmationAuthority: string;
};
type Receipt = {
  requestId: string;
  state: string;
  kind?: string;
  message?: string;
  orderId?: string;
  brokerAccountId?: string;
  recordId?: string;
  financialApplied?: boolean;
  ledgerWrites?: number;
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const sha = /^[a-f0-9]{64}$/;
function value(input: unknown) {
  return input === null || input === undefined ? "未知" : String(input);
}
export function FeeSourceAttributionPanel(props: {
  session: Session;
  active?: boolean;
  direct?: boolean;
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
  direct = false,
}: {
  session: Session;
  active?: boolean;
  direct?: boolean;
}) {
  const scope =
    "alcor.fee-source-attribution:" +
    JSON.stringify([
      session.instance_id,
      session.user.id,
      session.user.role,
      session.receipt_scope,
    ]);
  const [expanded, setExpanded] = useState(false),
    [listing, setListing] = useState<Listing | null>(null),
    [orderId, setOrderId] = useState(""),
    [accountId, setAccountId] = useState(""),
    [recordId, setRecordId] = useState("");
  const [documentDigest, setDocumentDigest] = useState(""),
    [historical, setHistorical] = useState(false),
    [complete, setComplete] = useState(false),
    [proof, setProof] = useState<{ data: Command; result: Proof } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState<Receipt | null>(null),
    [queryId, setQueryId] = useState("");
  const [pending, setPending] = useState<string | null>(() => {
    try {
      const id = sessionStorage.getItem(scope);
      return id && uuid.test(id) ? id : null;
    } catch {
      return null;
    }
  });
  const [storageError, setStorageError] = useState("");
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );
  const epoch = useRef(0),
    live = useRef(active && visible),
    controllers = useRef(new Set<AbortController>());
  const mounted = useRef(true),
    proofRef = useRef(proof);
  proofRef.current = proof;
  function invalidate() {
    epoch.current++;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear();
    setBusy(false);
    setProof(null);
    setReceipt(null);
  }
  function retire() {
    invalidate();
    setListing(null);
    setOrderId("");
    setAccountId("");
    setRecordId("");
    setDocumentDigest("");
    setHistorical(false);
    setComplete(false);
    setQueryId("");
    setPending(null);
    try {
      sessionStorage.removeItem(scope);
    } catch {
      /* An unavailable journal is never a proof of completion. */
    }
  }
  function report(failure: unknown) {
    if (failure instanceof ApiError && [401, 403].includes(failure.status))
      retire();
    if (mounted.current && live.current)
      setError(failure instanceof Error ? failure.message : "归属核对失败");
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current++;
      for (const c of controllers.current) c.abort();
      controllers.current.clear();
    };
  }, []);
  useEffect(() => {
    const update = () => {
      setVisible(!document.hidden);
      live.current = active && !document.hidden;
      if (!live.current) invalidate();
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, [active]);
  function edit(action: () => void) {
    invalidate();
    setError("");
    action();
  }
  async function task<T>(
    run: (signal: AbortSignal) => Promise<T>,
    accept: (result: T) => void,
  ) {
    if (!live.current || busy) return;
    const generation = epoch.current,
      controller = new AbortController();
    controllers.current.add(controller);
    setBusy(true);
    setError("");
    try {
      const result = await run(controller.signal);
      if (mounted.current && live.current && generation === epoch.current)
        accept(result);
    } catch (failure) {
      if (failure instanceof ApiError && [401, 403].includes(failure.status))
        report(failure);
      else if (mounted.current && live.current && generation === epoch.current)
        report(failure);
    } finally {
      controllers.current.delete(controller);
      if (mounted.current && generation === epoch.current) setBusy(false);
    }
  }
  function read(offset = 0) {
    setProof(null);
    return task(
      (signal) =>
        api<Listing>(
          `/fees/source-attributions?limit=100&offset=${offset}${offset && listing?.sourceRevision ? `&sourceRevision=${listing.sourceRevision}&inventoryRevision=${encodeURIComponent(listing.inventoryRevision ?? "false")}` : ""}`,
          { signal },
          session.csrf,
        ),
      (result) => {
        setListing(result);
        setOrderId("");
        setAccountId("");
        setRecordId("");
        setHistorical(false);
        setComplete(false);
      },
    );
  }
  useEffect(() => {
    if (direct && active && visible && !pending) void read();
  }, [direct, active, visible]);
  const original = listing?.orders.find((row) => row.orderId === orderId);
  const accounts =
    listing?.accounts.filter(
      (row) =>
        row.holdingSource === "manual" &&
        ["real", "simulated"].includes(row.accountKind) &&
        (!original?.input.accountKind ||
          row.accountKind === original.input.accountKind),
    ) ?? [];
  const selectedAccount = accounts.find((row) => row.id === accountId);
  const records =
    listing?.records.filter(
      (row) =>
        row.market === original?.input.market &&
        row.code === original?.input.code &&
        (!row.brokerAccountId || row.brokerAccountId === accountId),
    ) ?? [];
  const selectedRecord = records.find((row) => row.id === recordId);
  const disabled = busy || !active || !visible || !!pending;
  const canPreview =
    !disabled &&
    listing?.sourceVerified &&
    listing.sourceRevision !== null &&
    !!listing.sourceDigest &&
    !!original &&
    !!selectedAccount &&
    !!selectedRecord &&
    sha.test(documentDigest) &&
    historical &&
    complete;
  function preview() {
    if (
      !canPreview ||
      !listing?.sourceRevision ||
      !listing.sourceDigest ||
      !original ||
      !selectedAccount ||
      !selectedRecord
    )
      return;
    const data: Command = {
      requestId: requestId(),
      sourceRevision: listing.sourceRevision,
      sourceDigest: listing.sourceDigest,
      orderId: original.orderId,
      recordId: selectedRecord.id,
      recordRevision: selectedRecord.revision,
      brokerAccountId: selectedAccount.id,
      brokerRevision: selectedAccount.revision,
      basis: {
        documentDigest,
        historicalAccountConfirmed: true,
        completeOrderHistoryConfirmed: true,
      },
    };
    void task(
      (signal) =>
        api<Proof>(
          "/fees/source-attributions/preview",
          { method: "POST", signal, body: JSON.stringify(data) },
          session.csrf,
        ),
      (result) => setProof({ data, result }),
    );
  }
  async function submit() {
    const current = proofRef.current;
    if (
      disabled ||
      !current ||
      Date.parse(current.result.expiresAt) <= Date.now()
    )
      return;
    try {
      sessionStorage.setItem(scope, current.data.requestId);
      if (sessionStorage.getItem(scope) !== current.data.requestId)
        throw new Error();
    } catch {
      setStorageError("无法保存原操作编号，未提交");
      return;
    }
    setPending(current.data.requestId);
    setQueryId(current.data.requestId);
    await task(
      (signal) =>
        api<Receipt>(
          "/fees/source-attributions/operations",
          {
            method: "POST",
            signal,
            body: JSON.stringify({
              data: current.data,
              preview: current.result.preview,
            }),
          },
          session.csrf,
        ),
      acceptReceipt,
    );
  }
  function acceptReceipt(result: Receipt) {
    if (result.kind && result.kind !== "legacy_fee_source_attribution") {
      setError("该编号属于其他证据操作，请核对操作类型");
      return;
    }
    setReceipt(result);
    setProof(null);
    if (["completed", "failed"].includes(result.state)) {
      try {
        sessionStorage.removeItem(scope);
      } catch {
        setStorageError("原操作编号清理失败，请核对回执");
        return;
      }
      setPending(null);
      setListing(null);
      setOrderId("");
      setAccountId("");
      setRecordId("");
    }
  }
  function query() {
    const id = pending ?? queryId.trim();
    if (!uuid.test(id)) return;
    void task(
      (signal) =>
        api<Receipt>(
          `/fees/source-attributions/operations/${encodeURIComponent(id)}`,
          { signal },
          session.csrf,
        ),
      acceptReceipt,
    );
  }
  async function material(file: File | null) {
    if (!file || disabled) return;
    const generation = epoch.current;
    if (file.size > 32 * 1024 * 1024) {
      setError("材料文件最大32MiB");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        await file.arrayBuffer(),
      );
      if (mounted.current && live.current && epoch.current === generation) {
        setDocumentDigest(
          Array.from(new Uint8Array(digest), (part) =>
            part.toString(16).padStart(2, "0"),
          ).join(""),
        );
        setProof(null);
      }
    } catch (failure) {
      if (mounted.current && live.current && generation === epoch.current)
        report(failure);
    } finally {
      if (mounted.current && generation === epoch.current) setBusy(false);
    }
  }
  return (
    <div className="fees-plan fees-source-panel">
      {direct && (
        <header className="fees-source-heading">
          <h2>原订单账户归属</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="刷新原订单"
            disabled={busy || !!pending}
            onClick={() => void read()}
          >
            <RefreshCw size={17} />
          </button>
        </header>
      )}
      <SettingsSurface
        title="原订单账户归属"
        expanded={direct}
        open={expanded}
        onOpenChange={(open) => {
          setExpanded(open);
          if (!open) invalidate();
        }}
      >
        {(direct || expanded) && (
          <>
            {error && <p role="alert">{error}</p>}
            {storageError && <p role="alert">{storageError}</p>}
            {pending && (
              <>
                <p role="status">待核对原操作 {pending}</p>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={query}
                >
                  查询原回执
                </button>
              </>
            )}

            {receipt && (
              <p role="status">
                {receipt.state === "completed"
                  ? "归属已登记；未修改现金或成交账本"
                  : receipt.state === "failed"
                    ? (receipt.message ?? "归属未登记")
                    : "结果未知，请查询原编号"}
              </p>
            )}
            {!direct && (
              <>
                <button
                  className="button"
                  disabled={busy || !!pending}
                  onClick={() => void read()}
                >
                  读取原订单
                </button>
              </>
            )}
            {listing && (
              <>
                {listing.state === "unavailable" ? (
                  <p role="status">原订单来源尚不可用</p>
                ) : (
                  <>
                    {!listing.sourceVerified && (
                      <p role="status">
                        来源许可未生效或已撤销，保留原件不可新增归属
                      </p>
                    )}
                    <details>
                      <summary>来源</summary>
                      <p>
                        {listing.sourceOwner} · {listing.sourceInstance}
                      </p>
                      <p>
                        版本 {listing.sourceRevision} · {listing.sourceDigest}
                      </p>
                      <p>
                        原范围{" "}
                        {listing.sourceComplete ? "已登记完整" : "未确认完整"}
                      </p>
                    </details>
                    <div className="fees-plan-fields">
                      <label>
                        原订单
                        <select
                          value={orderId}
                          disabled={disabled}
                          onChange={(event) =>
                            edit(() => {
                              setOrderId(event.target.value);
                              setAccountId("");
                              setRecordId("");
                              setHistorical(false);
                              setComplete(false);
                            })
                          }
                        >
                          <option value="">选择原订单</option>
                          {listing.orders.map((row) => (
                            <option key={row.orderId} value={row.orderId}>
                              {value(row.input.market)} {value(row.input.code)}{" "}
                              · {row.orderId}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        本人账户
                        <select
                          value={accountId}
                          disabled={disabled || !original}
                          onChange={(event) =>
                            edit(() => {
                              setAccountId(event.target.value);
                              setRecordId("");
                              setHistorical(false);
                            })
                          }
                        >
                          <option value="">选择账户</option>
                          {accounts.map((row) => (
                            <option key={row.id} value={row.id}>
                              {row.name} ·{" "}
                              {row.accountKind === "real" ? "真实" : "模拟"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        本人证券
                        <select
                          value={recordId}
                          disabled={disabled || !selectedAccount}
                          onChange={(event) =>
                            edit(() => setRecordId(event.target.value))
                          }
                        >
                          <option value="">选择证券</option>
                          {records.map((row) => (
                            <option key={row.id} value={row.id}>
                              {row.market} {row.code} · {row.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {original && (
                      <>
                        <p>
                          {original.input.side} · 数量{" "}
                          {value(original.input.quantity)} · 价格{" "}
                          {value(original.input.price)} · 费用{" "}
                          {value(original.input.fees)}{" "}
                          {value(original.input.currency)}
                        </p>
                        <p>
                          原账户性质{" "}
                          {original.input.accountKind === null
                            ? "未知"
                            : original.input.accountKind === "real"
                              ? "真实"
                              : "模拟"}{" "}
                          · {value(original.input.occurredAt)}
                        </p>
                      </>
                    )}
                    <div className="fees-plan-fields">
                      <label>
                        材料文件
                        <input
                          type="file"
                          disabled={disabled}
                          onChange={(event) => {
                            const file = event.target.files?.[0] ?? null;
                            event.target.value = "";
                            void material(file);
                          }}
                        />
                      </label>
                      <label>
                        材料 SHA-256
                        <input
                          value={documentDigest}
                          disabled={disabled}
                          onChange={(event) =>
                            edit(() =>
                              setDocumentDigest(
                                event.target.value.trim().toLowerCase(),
                              ),
                            )
                          }
                        />
                      </label>
                    </div>
                    <label>
                      <input
                        type="checkbox"
                        checked={historical}
                        disabled={disabled}
                        onChange={(event) =>
                          edit(() => setHistorical(event.target.checked))
                        }
                      />
                      本人已核对材料中的历史账户归属
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={complete}
                        disabled={disabled}
                        onChange={(event) =>
                          edit(() => setComplete(event.target.checked))
                        }
                      />
                      本人已核对该订单的完整历史范围
                    </label>
                    <div className="record-actions">
                      <button
                        className="button"
                        disabled={!canPreview}
                        onClick={preview}
                      >
                        预览归属
                      </button>
                    </div>
                    <div className="record-actions">
                      <button
                        className="button"
                        disabled={
                          busy || !!pending || listing.pagination.offset === 0
                        }
                        onClick={() =>
                          void read(
                            Math.max(
                              0,
                              listing.pagination.offset -
                                listing.pagination.limit,
                            ),
                          )
                        }
                      >
                        上一批
                      </button>
                      <span>
                        {listing.pagination.total === null
                          ? "范围未知"
                          : `${listing.pagination.offset + listing.orders.length} / ${listing.pagination.total}`}
                      </span>
                      <button
                        className="button"
                        disabled={
                          busy ||
                          !!pending ||
                          listing.pagination.nextOffset === null
                        }
                        onClick={() =>
                          void read(listing.pagination.nextOffset ?? 0)
                        }
                      >
                        下一批
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
            {proof && (
              <div className="fee-proof">
                <p>原订单 {proof.result.orderId}</p>
                <p>
                  目标账户 {proof.result.proposedBrokerAccountId} · 证券{" "}
                  {proof.result.recordId}
                </p>
                <p>仅登记本人确认的归属；现金和成交账本不变</p>
                <button
                  className="button"
                  disabled={
                    disabled || Date.parse(proof.result.expiresAt) <= Date.now()
                  }
                  onClick={() => void submit()}
                >
                  确认归属
                </button>
              </div>
            )}
            <details className="fees-source-receipts">
              <summary>归属操作回执</summary>
              <div className="fees-plan-fields">
                <label>
                  原操作编号
                  <input
                    value={queryId}
                    disabled={busy || !!pending}
                    onChange={(event) => setQueryId(event.target.value)}
                  />
                </label>
                <button
                  className="button"
                  disabled={busy || !uuid.test(pending ?? queryId.trim())}
                  onClick={query}
                >
                  查询回执
                </button>
              </div>
            </details>
          </>
        )}
      </SettingsSurface>
    </div>
  );
}
