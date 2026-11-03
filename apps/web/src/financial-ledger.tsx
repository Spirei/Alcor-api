import { PrivateAmount } from "./financial-display";
import { ImportedOrderDeclarations } from "./imported-order-declarations";
import {TradeAttachmentsEditor,TradeAttachmentsSummary,attachmentCommand,emptyLeg,type Leg} from "./trade-attachments";
import { OrderObservationPanel } from "./order-observations";
import { OrderIntentEditor } from "./order-intents";
import { TradeHistoryExchangePanel } from "./trade-history-exchange";
import { FinancingPolicyPanel } from "./financing-policy";
import { financingConfirmation } from "./financing-state";
import { TradeAmendmentPanel } from "./trade-amendment";
import { Activity, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { Session } from "./api";
import { Dialog } from "./dialog";
import { SelectMenu } from "./select-menu";
import { requestId } from "./request-id";
import { FundSourcesPanel } from "./fund-sources";
import { CashOverviewPanel } from "./cash-overview";
import { CashHistory } from "./cash-entries";
import { cashCommand } from "./cash-flow-state";
import { brokerCurrencyStatus } from "./broker-account-state";
import { financialSummary } from "./financial-view";

type Kind = "cash" | "trade" | "order";
type Broker = {
  id: string;
  name: string;
  account_kind: string;
  currency: string;
  currencies?: string[];
  holding_source: string;
};
type RecordRow = {
  id: string;
  name: string;
  code: string;
  market: string;
  brokerAccountId: string;
  revision: number;
};
type RecordPage = {
  records: RecordRow[];
  total: number;
  collectionRevision: number;
};
type Order = {
  id: string;
  recordId: string;
  accountId: string;
  side: string;
  quantity: string;
  limitPrice: string;
  currency: string;
  status: string;
  revision: number;
  reservedCash: string;
  executionEnabled: boolean;
};
type OrderPage = {
  items: Order[];
  total: number;
  revision: number;
  nextOffset: number | null;
};
type Fills = {
  items: {
    id: string;
    side: string;
    quantity: string;
    price: string;
    amount: string;
    fees: string | null;
    feeSource?: string;
    effectiveActive?: boolean;
    correction?: { state: string };
    currency: string;
    cash_delta: string | null;
    settlement_currency: string;
    occurred_at: string;
  }[];
  total: number;
  recordRevision: number;
  nextOffset: number | null;
};
type Cash = {
  accountId: string;
  revision: number;
  currencies: {
    currency: string;
    balance: string | null;
    registeredBalance: string | null;
    complete: boolean;
    ownerCashComplete: boolean;
    officialObservation?: { reportDate: string | null; state: string };
    sourceOnly?: boolean;
    configured?: boolean;
    opening: { opening_at: string; opening_basis: string } | null;
  }[];
};
type Proof = {
  kind: Kind;
  data: Record<string, unknown>;
  value: Record<string, unknown>;
  token: string;
  expires: number;
  label: string;
};
const path = { cash: "/cash", trade: "/trading", order: "/trading/orders" };
const currencyFor: Record<string, string> = {
  US: "USD",
  HK: "HKD",
  CN: "CNY",
  SG: "SGD",
  JP: "JPY",
  KR: "KRW",
  UK: "GBP",
};
const text = (value: unknown) =>
  value === null || value === undefined ? "未知" : String(value);
const kinds = [
  { value: "cash", label: "现金" },
  { value: "trade", label: "成交登记" },
  { value: "order", label: "内部委托" },
];
const proofLabels: Record<string, string> = {
  side: "方向",
  quantity: "委托数量",
  limitPrice: "委托限价",
  fees: "预留费用",
  accountId: "账户编号",
  accountKind: "账户类型",
  accountName: "账户",
  recordId: "记录编号",
  currency: "币种",
  cashCurrency: "结算币种",
  delta: "现金变动",
  balanceAfter: "账户现金（变更后）",
  ownerCashAfter: "同类账户现金合计（变更后）",
  cashBefore: "账户现金（变更前）",
  cashAfter: "账户现金（变更后）",
  cashDelta: "现金变动",
  quantityBefore: "数量（变更前）",
  quantityAfter: "数量（变更后）",
  costBefore: "摊薄成本（变更前）",
  costAfter: "摊薄成本（变更后）",
  realizedPnl: "本笔经济收益",
  realizedPnlCurrency: "收益币种",
  reservedCash: "预留现金",
  availableCashBefore: "可用现金（变更前）",
  availableQuantityBefore: "可用数量（变更前）",
  orderId: "委托编号",
};
const inputLabels: Record<string, string> = {
  amount: "实际金额",
  quantity: "数量",
  price: "成交价格",
  limitPrice: "限价",
  fees: "费用",
  settlementAmount: "实际净结算额",
  currency: "原币",
  settlementCurrency: "结算币种",
  occurredAt: "发生时间",
  note: "备注",
  side: "方向",
  openingBasis: "期初来源",
};
const human: Record<string, string> = {
  real: "真实",
  simulated: "模拟",
  buy: "买入",
  sell: "卖出",
  dividend: "股息",
  new_external_opening: "新增外部期初",
  allocate_verified_unallocated_checkpoint: "分配已核对的未归属现金",
};

export function FinancialLedger({
  session,
  brokers,
  generation,
  focusAccount,
  blocked,
  onSubmit,
}: {
  session: Session;
  brokers: Broker[] | null;
  generation: number;
  focusAccount?: { id: string; request: number };
  blocked: boolean;
  onSubmit: (
    kind: Kind | "trade_amendment" | "financing_policy",
    data: Record<string, unknown>,
    proof: string,
  ) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<Kind>("cash");
  const [fundsOpen,setFundsOpen] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [recordId, setRecordId] = useState("");
  const [page, setPage] = useState(1),
    [records, setRecords] = useState<RecordPage | null>(null);
  const recordSnapshot = useRef<number | null>(null);
  const [cash, setCash] = useState<Cash | null>(null),
    [orders, setOrders] = useState<OrderPage | null>(null);
  const [orderOffset, setOrderOffset] = useState(0);
  const [fills, setFills] = useState<Fills | null>(null),
    [fillOffset, setFillOffset] = useState(0);
  const fillSnapshot = useRef<number | null>(null);
  const orderSnapshot = useRef<number | null>(null);
  const [refresh, setRefresh] = useState(0),
    [error, setError] = useState("");
  const [editing, setEditing] = useState(false),
    [proof, setProof] = useState<Proof | null>(null),
    [busy, setBusy] = useState(false);
  const [draft, setDraftState] = useState({
    action: "",
    openingBasis: "",
    evidenceReference: "",
    evidenceObservedAt: "",
    side: "buy",
    quantity: "",
    price: "",
    amount: "",
    fees: "",
    settlementAmount: "",
    currency: "",
    settlementCurrency: "",
    occurredAt: "",
    note: "",
    confirmed: false,
  });
  const [tradeLegs,setTradeLegs]=useState<Record<string,Leg>>({takeProfit:emptyLeg(),stopLoss:emptyLeg()});
  const [attachmentSession,setAttachmentSession]=useState("REGULAR"),[attachmentTif,setAttachmentTif]=useState("day");
  const [financingIntent, setFinancingIntent] = useState({
    confirmed: false,
    statement: "",
  });
  const proofDraftEpoch = useRef(0);
  const setDraft = (value: Parameters<typeof setDraftState>[0]) => {
    proofDraftEpoch.current++;
    setProof(null);
    setFinancingIntent((old) => ({ ...old, confirmed: false }));
    setDraftState(value);
  };
  useEffect(() => {
    proofDraftEpoch.current++;
    setProof(null);
    setFinancingIntent({ confirmed: false, statement: "" });
  }, [
    kind,
    accountId,
    recordId,
    editing,
    session.user.id,
    session.user.role,
    session.instance_id,
    session.receipt_scope,
    session.csrf,
  ]);
  const active = useRef(false),
    epoch = useRef(0);
  useLayoutEffect(() => {
    if (!focusAccount?.id) return;
    setKind("cash");
    setAccountId(focusAccount.id);
    setRecordId("");
    setProof(null);
    setEditing(false);
    setDraft((d) => ({
      ...d,
      currency: "",
      action: "",
      openingBasis: "",
      amount: "",
      occurredAt: "",
      evidenceReference: "",
      evidenceObservedAt: "",
      note: "",
    }));
  }, [focusAccount]);
  const account = brokers?.find((b) => b.id === accountId);
  const record = records?.records.find((r) => r.id === recordId);
  const fail = (e: unknown) => {
    setError(e instanceof Error ? e.message : "读取失败");
    if (e instanceof ApiError && [401, 403].includes(e.status)) {
      ++epoch.current;
      active.current = false;
      setBusy(false);
      setCash(null);
      setOrders(null);
      setFills(null);
      setRecords(null);
      setProof(null);
      setEditing(false);
      setDraft((d) => ({
        ...d,
        amount: "",
        quantity: "",
        price: "",
        fees: "",
        settlementAmount: "",
        note: "",
        confirmed: false,
      }));
    }
  };
  useEffect(() => {
    if (document.hidden) return;
    active.current = true;
    const run = ++epoch.current;
    const controller = new AbortController();
    setProof(null);
    setCash(null);
    setOrders(null);
    setFills(null);
    setRecords(null);
    setError("");
    const revision =
      page > 1 && recordSnapshot.current !== null
        ? `&collectionRevision=${recordSnapshot.current}`
        : "";
    const orderRevision =
      orderOffset > 0 && orderSnapshot.current !== null
        ? `&revision=${orderSnapshot.current}`
        : "";
    const reads: Promise<unknown>[] = [];
    if (kind !== "cash")
      reads.push(
        api<RecordPage>(
          `/portfolio/records?page=${page}&pageSize=25${revision}${accountId ? `&brokerAccountId=${encodeURIComponent(accountId)}` : ""}`,
          { signal: controller.signal },
        ).then((r) => {
          if (active.current && epoch.current === run) {
            recordSnapshot.current = r.collectionRevision;
            setRecords(r);
          }
        }),
      );
    if (accountId && kind === "cash")
      reads.push(
        api<Cash>(`/cash/accounts/${encodeURIComponent(accountId)}`, {
          signal: controller.signal,
        }).then((r) => {
          if (active.current && epoch.current === run) setCash(r);
        }),
      );
    if (kind === "order")
      reads.push(
        api<OrderPage>(
          `/trading/orders?limit=25&offset=${orderOffset}${orderRevision}`,
          { signal: controller.signal },
        ).then((r) => {
          if (active.current && epoch.current === run) {
            orderSnapshot.current = r.revision;
            setOrders(r);
          }
        }),
      );
    if (recordId && kind === "trade")
      reads.push(
        api<Fills>(
          `/trading/fills?recordId=${encodeURIComponent(recordId)}&limit=25&offset=${fillOffset}${fillOffset > 0 && fillSnapshot.current !== null ? `&recordRevision=${fillSnapshot.current}` : ""}`,
          { signal: controller.signal },
        ).then((r) => {
          if (active.current && epoch.current === run) {
            fillSnapshot.current = r.recordRevision;
            setFills(r);
          }
        }),
      );
    Promise.all(reads).catch((e) => {
      if (!controller.signal.aborted && epoch.current === run) {
        if (e instanceof ApiError && e.status === 409) {
          recordSnapshot.current = null;
          orderSnapshot.current = null;
          setPage(1);
          setOrderOffset(0);
          fillSnapshot.current = null;
          setFillOffset(0);
          setFills(null);
        }
        fail(e);
      }
    });
    return () => {
      active.current = false;
      ++epoch.current;
      controller.abort();
      setProof(null);
      setCash(null);
      setOrders(null);
      setFills(null);
      setRecords(null);
      setBusy(false);
    };
  }, [
    kind,
    accountId,
    recordId,
    page,
    orderOffset,
    fillOffset,
    generation,
    refresh,
  ]);
  useEffect(() => {
    const changed = () => {
      setProof(null);
      ++epoch.current;
      if (document.hidden) {
        setCash(null);
        setOrders(null);
        setFills(null);
        setRecords(null);
        setBusy(false);
      } else {
        recordSnapshot.current = null;
        orderSnapshot.current = null;
        setPage(1);
        setOrderOffset(0);
        fillSnapshot.current = null;
        setFillOffset(0);
        setFills(null);
        setRefresh((v) => v + 1);
      }
    };
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    if (blocked) setProof(null);
  }, [blocked]);
  useEffect(() => {
    setProof(null);
  }, [kind]);
  useEffect(() => {
    if (!proof) return;
    const ms = proof.expires - Date.now();
    if (ms <= 0) {
      setProof(null);
      setError("预览已过期，请重新核对。");
      return;
    }
    const timer = setTimeout(() => {
      setProof(null);
      setError("预览已过期，请重新核对。");
    }, ms);
    return () => clearTimeout(timer);
  }, [proof]);
  const field = (name: keyof typeof draft, label: string, type = "text") => (
    <label key={name}>
      {label}
      <input
        type={type}
        required={name !== "note" && name !== "settlementAmount"}
        value={String(draft[name])}
        onChange={(e) => setDraft((d) => ({ ...d, [name]: e.target.value }))}
        inputMode={
          type === "text" && !["note", "occurredAt"].includes(name)
            ? "decimal"
            : undefined
        }
      />
    </label>
  );
  async function preview(cancel?: Order) {
    if (blocked || busy || !active.current || document.hidden) return;
    setError("");
    setBusy(true);
    const run = epoch.current;
    const draftRun = proofDraftEpoch.current;
    try {
      const id = requestId();
      let data: Record<string, unknown>;
      let operationKind = kind;
      let label = "";
      if (cancel) {
        operationKind = "order";
        data = {
          requestId: id,
          action: "cancel",
          orderId: cancel.id,
          orderRevision: cancel.revision,
        };
        label = "取消内部委托";
      } else if (kind === "cash") {
        data = cashCommand(
          account,
          {
            ...draft,
            financingConfirmed: financingIntent.confirmed,
            financingStatement: financingIntent.statement,
          },
          id,
        );
        label =
          (
            {
              opening: "登记现金期初",
              external_deposit: "登记入金",
              external_withdrawal: "登记出金",
              reconcile_balance: "核对现金余额",
            } as Record<string, string>
          )[draft.action] || "核对现金";
      } else {
        if (!record) throw new Error("请先选择本页的证券记录");
        if (!draft.confirmed)
          throw new Error(
            kind === "trade"
              ? "请确认登记的是实际已发生的成交"
              : "请确认仅建立内部预留",
          );
        if (kind === "trade") {
          if (!draft.occurredAt) throw new Error("请填写实际发生时间");
          const attachments=draft.side!=="dividend"?attachmentCommand(tradeLegs,attachmentSession,attachmentTif):undefined;
          data = {
            ...(attachments?{attachments}:{}),
            requestId: id,
            recordId: record.id,
            recordRevision: record.revision,
            side: draft.side,
            quantity: draft.side === "dividend" ? "0" : draft.quantity,
            price: draft.side === "dividend" ? "0" : draft.price,
            amount: draft.amount,
            fees: draft.fees,
            currency: draft.currency,
            settlementCurrency: draft.settlementCurrency,
            settlementAmount: draft.settlementAmount || null,
            occurredAt: new Date(draft.occurredAt).toISOString(),
            note: draft.note,
            confirmedActualFill: true,
            ...(financingIntent.confirmed
              ? {
                  allowFinancing: true,
                  financingConfirmation: financingConfirmation(
                    true,
                    financingIntent.statement,
                  ),
                }
              : {}),
          };
          label = "登记实际成交";
        } else {
          data = {
            requestId: id,
            action: "create",
            recordId: record.id,
            recordRevision: record.revision,
            side: draft.side,
            quantity: draft.quantity,
            limitPrice: draft.price,
            fees: draft.fees,
            note: draft.note,
            confirmedInternalOrder: true,
          };
          label = "建立内部预留";
        }
      }
      const value = await api<Record<string, unknown>>(
        `${path[operationKind]}/preview`,
        { method: "POST", body: JSON.stringify(data) },
        session.csrf,
      );
      if (
        !active.current ||
        epoch.current !== run ||
        proofDraftEpoch.current !== draftRun
      )
        return;
      const expires = Date.parse(String(value.expiresAt));
      if (
        !Number.isFinite(expires) ||
        expires <= Date.now() ||
        typeof value.preview !== "string"
      )
        throw new Error("预览无效，请重新核对");
      financialSummary(value);
      setProof({
        kind: operationKind,
        data,
        value,
        token: value.preview,
        expires,
        label,
      });
    } catch (e) {
      if (active.current && epoch.current === run && proofDraftEpoch.current === draftRun) fail(e);
    } finally {
      if (active.current && epoch.current === run) setBusy(false);
    }
  }
  async function confirm() {
    const current = proof;
    if (!current || blocked || busy || !active.current || document.hidden)
      return;
    if (current.expires <= Date.now()) {
      setProof(null);
      setError("预览已过期，请重新核对。");
      return;
    }
    setProof(null);
    setEditing(false);
    if (await onSubmit(current.kind, current.data, current.token)) {
      setDraft((d) => ({
        ...d,
        amount: "",
        quantity: "",
        price: "",
        fees: "",
        settlementAmount: "",
        note: "",
        confirmed: false,
      }));
      recordSnapshot.current = null;
      orderSnapshot.current = null;
      setPage(1);
      setOrderOffset(0);
      fillSnapshot.current = null;
      setFillOffset(0);
      setFills(null);
      setRefresh((v) => v + 1);
    }
  }
  function selectRecord(id: string) {
    setRecordId(id);
    setFillOffset(0);
    fillSnapshot.current = null;
    setFills(null);
    setProof(null);
    const r = records?.records.find((v) => v.id === id);
    setDraft((d) => ({
      ...d,
      currency: r ? currencyFor[r.market] || "" : "",
      settlementCurrency: "",
      confirmed: false,
    }));
  }
  return (
    <div>
      <div className="portfolio-actions">
        <SelectMenu
          label="账本视图"
          value={kind}
          onChange={(v) => {
            setKind(v as Kind);
            setEditing(false);
            setDraft((d) => ({ ...d, confirmed: false, side: "buy" }));
          }}
          options={kinds}
        />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {kind !== "cash" && <TradeHistoryExchangePanel session={session} recordId={recordId} generation={generation} onChanged={()=>setRefresh(value=>value+1)} onDenied={fail}/>}
      {kind === "cash" ? (
        <>
          <CashOverviewPanel session={session} generation={`${generation}:${refresh}`} onDenied={fail} />
          <details onToggle={event=>setFundsOpen(event.currentTarget.open)}><summary>本人登记资金来源</summary><Activity mode={fundsOpen?"visible":"hidden"}><FundSourcesPanel session={session} accounts={brokers || []} generation={`${generation}:${refresh}`} onChanged={()=>setRefresh(value=>value+1)} /></Activity></details>
          <SelectMenu
            variant="field"
            label="现金账户"
            value={accountId}
            onChange={(v) => {
              setAccountId(v);
              recordSnapshot.current = null;
              setPage(1);
              setRecordId("");
              setFillOffset(0);
              fillSnapshot.current = null;
              setFills(null);
              setProof(null);
              setEditing(false);
              setDraft((d) => ({
                ...d,
                currency: brokers?.find((b) => b.id === v)?.currency || "",
                action: "",
                openingBasis: "",
              }));
            }}
            options={[
              { value: "", label: "选择账户" },
              ...(brokers || []).map((b) => ({
                value: b.id,
                label: `${b.name} · ${human[b.account_kind] || "来源未核实"} · ${b.id}`,
              })),
            ]}
          />
          {account && ["real", "simulated"].includes(account.account_kind) && (
            <FinancingPolicyPanel
              session={session}
              accountKind={account.account_kind}
              generation={generation}
              blocked={blocked || busy}
              onSubmit={(data, token) =>
                onSubmit("financing_policy", data, token)
              }
            />
          )}
          {accountId && !cash ? (
            error ? null : (
              <p role="status">正在读取…</p>
            )
          ) : (
            cash && (
              <div className="portfolio-table">
                <table>
                  <thead>
                    <tr>
                      <th>币种</th>
                      <th>余额</th>
                      <th>核对状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cash.currencies.map((c) => (
                      <tr key={c.currency}>
                        <td>{c.currency}{c.sourceOnly && <small>未配置原币观察</small>}</td>
                        <td>
                          <PrivateAmount>{c.balance ?? "未知"}</PrivateAmount>
                          {(!c.complete || c.officialObservation) && c.registeredBalance !== null && (
                            <small>登记余额 <PrivateAmount>{c.registeredBalance}</PrivateAmount></small>
                          )}
                        </td>
                        <td>
                          {c.officialObservation ? <>
                            官方账单 · {c.officialObservation.reportDate ? `截至 ${c.officialObservation.reportDate}` : "报告日期未知"}
                            <small>{c.balance === null ? "报告余额未知" : "报告期末余额"} · 可提现金额未知</small>
                          </> : brokerCurrencyStatus(c)}
                          {c.opening && <small>{c.opening.opening_at}</small>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
          {cash && accountId && (
            <CashHistory
              accountId={accountId}
              currencies={cash.currencies.map((value) => value.currency)}
              revision={cash.revision}
              generation={`${generation}:${refresh}`}
              onRefresh={() => setRefresh((value) => value + 1)}
              onDenied={fail}
            />
          )}
          <div className="portfolio-actions">
            <button
              className="button"
              disabled={
                blocked ||
                busy ||
                !cash ||
                !account ||
                account.holding_source !== "manual" ||
                !["real", "simulated"].includes(account.account_kind)
              }
              onClick={() => {
                setProof(null);
                setDraft((value) => ({
                  ...value,
                  action: "",
                  openingBasis: "",
                  amount: "",
                  currency: "",
                  occurredAt: "",
                  note: "",
                }));
                setEditing(true);
              }}
            >
              登记现金变更
            </button>
          </div>
        </>
      ) : (
        <>
          <SelectMenu
            variant="field"
            label="交易账户"
            value={accountId}
            onChange={(value) => {
              ++epoch.current;
              setAccountId(value);
              recordSnapshot.current = null;
              fillSnapshot.current = null;
              orderSnapshot.current = null;
              setPage(1);
              setRecordId("");
              setFillOffset(0);
              setOrderOffset(0);
              setRecords(null);
              setFills(null);
              setOrders(null);
              setProof(null);
              setEditing(false);
              setDraft((current) => ({
                ...current,
                quantity: "",
                price: "",
                amount: "",
                fees: "",
                settlementAmount: "",
                currency: "",
                settlementCurrency: "",
                occurredAt: "",
                note: "",
                confirmed: false,
              }));
            }}
            options={[
              { value: "", label: "全部账户" },
              ...(brokers || []).map((value) => ({
                value: value.id,
                label: value.name,
              })),
            ]}
          />
          <SelectMenu
            variant="field"
            label="证券记录"
            value={recordId}
            onChange={selectRecord}
            options={[
              { value: "", label: "选择本页记录" },
              ...(records?.records || []).map((r) => ({
                value: r.id,
                label: `${r.name} · ${r.code} · ${r.id}`,
              })),
            ]}
          />
          <div className="portfolio-actions">
            <button
              className="button"
              disabled={page <= 1 || busy}
              onClick={() => {
                setPage((p) => p - 1);
                setRecordId("");
              }}
            >
              上一页记录
            </button>
            <span>{page}</span>
            <button
              className="button"
              disabled={!records || page * 25 >= records.total || busy}
              onClick={() => {
                setPage((p) => p + 1);
                setRecordId("");
              }}
            >
              下一页记录
            </button>
            {kind === "trade" && (
            <button
              className="button"
              disabled={!record || blocked || busy}
              onClick={() => {
                setProof(null);
                setDraft((value) => ({
                  ...value,
                  action: "",
                  openingBasis: "",
                  amount: "",
                  currency: "",
                  occurredAt: "",
                  note: "",
                }));
                setTradeLegs({takeProfit:emptyLeg(),stopLoss:emptyLeg()});
                setAttachmentSession("REGULAR");setAttachmentTif("day");
                setEditing(true);
              }}
            >
              {kind === "trade" ? "登记实际成交" : "建立内部预留"}
            </button>
            )}
          </div>
          {kind === "trade" && recordId && (
            <>
              <TradeAmendmentPanel
                key={JSON.stringify([
                  session.instance_id,
                  session.user.id,
                  session.user.role,
                  session.receipt_scope,
                  recordId,
                ])}
                session={session}
                recordId={recordId}
                generation={generation}
                blocked={blocked || busy}
                onSubmit={(data, proof) =>
                  onSubmit("trade_amendment", data, proof)
                }
              />
              <div className="portfolio-table">
                <table>
                  <thead>
                    <tr>
                      <th>发生时间</th>
                      <th>方向</th>
                      <th>数量</th>
                      <th>价格</th>
                      <th>实际金额</th>
                      <th>费用</th>
                      <th>现金变动</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fills?.items.map((f) => (
                      <tr key={f.id}>
                        <td>{f.occurred_at}</td>
                        <td>
                          {human[f.side] || f.side}
                          {f.effectiveActive === false && (
                            <small>
                              {" "}
                              ·{" "}
                              {f.correction?.state === "deleted"
                                ? "已删除"
                                : "已合并替代"}
                            </small>
                          )}
                        </td>
                        <td><PrivateAmount>{f.quantity}</PrivateAmount></td>
                        <td>
                          <PrivateAmount>{f.price}</PrivateAmount> {f.currency}
                        </td>
                        <td>
                          <PrivateAmount>{f.amount}</PrivateAmount> {f.currency}
                        </td>
                        <td>
                          <PrivateAmount>{f.fees === null
                            ? "未知"
                            : `${["rule_calculated", "owner_reconstructed"].includes(f.feeSource || "") ? "≈ " : ""}${f.fees}`}</PrivateAmount>{" "}
                          {f.currency}
                        </td>
                        <td>
                          <PrivateAmount>{f.effectiveActive === false
                            ? "已撤销有效影响"
                            : (f.cash_delta ?? "未知")}</PrivateAmount>{" "}
                          {f.settlement_currency}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {fills?.total === 0 && <p>暂无已登记成交</p>}
              <div className="portfolio-actions">
                <button
                  className="button"
                  disabled={fillOffset === 0 || busy}
                  onClick={() => setFillOffset((v) => Math.max(0, v - 25))}
                >
                  上一页成交
                </button>
                <button
                  className="button"
                  disabled={!fills || fills.nextOffset === null || busy}
                  onClick={() => setFillOffset(fills!.nextOffset!)}
                >
                  下一页成交
                </button>
              </div>
            </>
          )}
          {kind === "order" && (
            <>
              <ImportedOrderDeclarations session={session} generation={generation+refresh} onDenied={fail}/>
              <OrderIntentEditor session={session} generation={generation+refresh} onChanged={()=>setRefresh(value=>value+1)} onDenied={fail}/>
              <OrderObservationPanel session={session} generation={generation+refresh} onChanged={()=>setRefresh(value=>value+1)} onDenied={fail}/>
              <div className="portfolio-table">
                <table>
                  <thead>
                    <tr>
                      <th>记录编号</th>
                      <th>方向</th>
                      <th>数量</th>
                      <th>限价</th>
                      <th>预留现金</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders?.items.map((o) => (
                      <tr key={o.id}>
                        <td>{o.recordId}</td>
                        <td>{human[o.side] || o.side}</td>
                        <td><PrivateAmount>{o.quantity}</PrivateAmount></td>
                        <td>
                          <PrivateAmount>{o.limitPrice}</PrivateAmount> {o.currency}
                        </td>
                        <td><PrivateAmount>{o.reservedCash}</PrivateAmount></td>
                        <td>
                          {({cancelled:"已取消",expired:"已到期",filled:"已内部记账（非券商成交）",observed:"已观察条件，未代表券商成交",rejected:"已拒绝"} as Record<string,string>)[o.status] || (o.status === "pending" ? o.executionEnabled ? "内部执行已启用，非券商单" : "预留中 · 自动执行未启用" : o.status)}
                        </td>
                        <td>
                          {o.status === "pending" && (
                            <button
                              className="button"
                              disabled={blocked || busy}
                              onClick={() => void preview(o)}
                            >
                              取消委托
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {orders?.total === 0 && <p>暂无内部委托</p>}
              <div className="portfolio-actions">
                <button
                  className="button"
                  disabled={orderOffset === 0 || busy}
                  onClick={() => setOrderOffset((v) => Math.max(0, v - 25))}
                >
                  上一页委托
                </button>
                <button
                  className="button"
                  disabled={!orders || orders.nextOffset === null || busy}
                  onClick={() => setOrderOffset(orders!.nextOffset!)}
                >
                  下一页委托
                </button>
              </div>
            </>
          )}
        </>
      )}
      {editing && !proof && (
        <Dialog
          title={
            kind === "cash"
              ? "登记现金变更"
              : kind === "trade"
                ? "登记实际成交"
                : "建立内部预留"
          }
          onClose={() => {
            if (!busy) setEditing(false);
          }}
        >
          <form
            className="portfolio-form"
            onSubmit={(e) => {
              e.preventDefault();
              void preview();
            }}
          >
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {kind === "cash" ? (
              <>
                <label>
                  操作
                  <SelectMenu
                    label="现金操作"
                    variant="field"
                    value={draft.action}
                    onChange={(action) => setDraft((d) => ({ ...d, action }))}
                    options={[
                      { value: "", label: "选择操作" },
                      { value: "opening", label: "登记期初" },
                      { value: "external_deposit", label: "登记入金" },
                      { value: "external_withdrawal", label: "登记出金" },
                      { value: "reconcile_balance", label: "核对余额" },
                    ]}
                  />
                </label>
                <label>
                  币种
                  <SelectMenu
                    label="现金币种"
                    variant="field"
                    value={draft.currency}
                    onChange={(currency) =>
                      setDraft((d) => ({ ...d, currency }))
                    }
                    options={[
                      { value: "", label: "选择币种" },
                      ...(account?.currencies || [account?.currency || ""])
                        .filter(Boolean)
                        .map((value) => ({ value, label: value })),
                    ]}
                  />
                </label>
                {draft.action === "opening" && (
                  <label>
                    期初来源
                    <SelectMenu
                      label="期初来源"
                      variant="field"
                      value={draft.openingBasis}
                      onChange={(openingBasis) =>
                        setDraft((d) => ({ ...d, openingBasis }))
                      }
                      options={[
                        { value: "", label: "选择来源" },
                        ...Object.entries(human)
                          .filter(
                            ([v]) =>
                              v.includes("opening") || v.includes("checkpoint"),
                          )
                          .map(([value, label]) => ({ value, label })),
                      ]}
                    />
                  </label>
                )}
                {draft.action === "reconcile_balance" && <>{field("evidenceReference", "本人余额核对依据")}{field("evidenceObservedAt", "实际观察时间", "datetime-local")}</>}
                {field(
                  "amount",
                  draft.action === "reconcile_balance" ? "核对后的目标余额" : "金额",
                )}
              </>
            ) : (
              <>
                <label>
                  方向
                  <SelectMenu
                    label="方向"
                    variant="field"
                    value={draft.side}
                    onChange={(side) => setDraft((d) => ({ ...d, side }))}
                    options={[
                      { value: "buy", label: "买入" },
                      { value: "sell", label: "卖出" },
                      ...(kind === "trade"
                        ? [{ value: "dividend", label: "股息" }]
                        : []),
                    ]}
                  />
                </label>
                {draft.side !== "dividend" && (
                  <>
                    {field("quantity", "数量")}
                    {field("price", kind === "order" ? "限价" : "成交价格")}
                  </>
                )}
                {field(
                  "fees",
                  kind === "order" ? "预留费用" : "实际费用（原币）",
                )}
                {kind === "trade" && (
                  <>
                    {field(
                      "amount",
                      draft.side === "dividend"
                        ? "实际股息金额"
                        : "实际成交金额",
                    )}
                    <label>
                      原币
                      <input
                        required
                        value={draft.currency}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            currency: e.target.value.toUpperCase(),
                          }))
                        }
                      />
                    </label>
                    <label>
                      结算币种
                      <input
                        required
                        value={draft.settlementCurrency}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            settlementCurrency: e.target.value.toUpperCase(),
                          }))
                        }
                      />
                    </label>
                    {field("settlementAmount", "实际净结算额（结算币种）")}
                  </>
                )}
              </>
            )}
            {kind !== "order" &&
              field("occurredAt", "实际发生时间", "datetime-local")}
            {((kind === "trade" && draft.side === "buy") ||
              (kind === "cash" &&
                draft.action === "reconcile_balance" &&
                draft.amount.trim().startsWith("-"))) && (
              <>
                <label className="ledger-confirmation">
                  <input
                    type="checkbox"
                    checked={financingIntent.confirmed}
                    onChange={(event) => {
                      proofDraftEpoch.current++;
                      setProof(null);
                      setFinancingIntent((old) => ({
                        ...old,
                        confirmed: event.target.checked,
                      }));
                    }}
                  />
                  本人已核实已发生融资或实际负余额，仅登记内部账本
                </label>
                {financingIntent.confirmed && (
                  <label>
                    本人核对依据
                    <textarea
                      value={financingIntent.statement}
                      maxLength={4096}
                      required
                      onChange={(event) => {
                        proofDraftEpoch.current++;
                        setProof(null);
                        setFinancingIntent((old) => ({
                          ...old,
                          statement: event.target.value,
                        }));
                      }}
                    />
                  </label>
                )}
              </>
            )}
            {kind === "trade" && draft.side !== "dividend" && <><label>附加意图时段<select value={attachmentSession} onChange={e=>{proofDraftEpoch.current++;setProof(null);setAttachmentSession(e.target.value);}}><option value="REGULAR">常规</option><option value="EXTENDED">扩展</option></select></label><label>附加意图有效期<select value={attachmentTif} onChange={e=>{proofDraftEpoch.current++;setProof(null);setAttachmentTif(e.target.value);}}><option value="day">当日</option><option value="gtc">持续有效</option></select></label><TradeAttachmentsEditor legs={tradeLegs} onChange={value=>{proofDraftEpoch.current++;setProof(null);setTradeLegs(value);}}/></>}
            {field("note", "备注")}
            {kind !== "cash" && (
              <label className="ledger-confirmation">
                <input
                  type="checkbox"
                  checked={draft.confirmed}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, confirmed: e.target.checked }))
                  }
                />
                {kind === "trade"
                  ? "登记实际已发生的成交"
                  : "仅建立内部预留，自动执行未启用"}
              </label>
            )}
            <button
              className="button primary"
              disabled={busy || blocked}
              type="submit"
            >
              {busy ? "正在核对…" : "核对变更"}
            </button>
          </form>
        </Dialog>
      )}
      {proof && (
        <Dialog title={proof.label} onClose={() => setProof(null)}>
          <dl className="portfolio-proof">
            {Object.entries(proof.data)
              .filter(
                ([k, v]) =>
                  inputLabels[k] &&
                  v !== null &&
                  v !== "" &&
                  !(k in financialSummary(proof.value)) &&
                  !(
                    k === "settlementCurrency" && "cashCurrency" in proof.value
                  ),
              )
              .map(([k, v]) => (
                <div key={`input-${k}`}>
                  <dt>
                    {k === "amount" && proof.kind === "cash" && proof.data.action === "reconcile_balance"
                      ? "核对后的目标余额"
                      : k === "amount" && proof.kind === "trade"
                      ? proof.data.side === "dividend"
                        ? "股息总额（不含费用）"
                        : "成交金额（不含费用）"
                      : inputLabels[k]}
                  </dt>
                  <dd>{human[String(v)] || text(v)}</dd>
                </div>
              ))}
            {Object.entries(financialSummary(proof.value))
              .filter(([k]) => proofLabels[k])
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{proofLabels[k]}</dt>
                  <dd>{human[String(v)] || text(v)}</dd>
                </div>
              ))}
          </dl>
          {proof.kind === "cash" && Boolean(proof.value.reconciliationEvidence) && typeof proof.value.reconciliationEvidence === "object" && <dl className="portfolio-proof"><div><dt>本人观察依据</dt><dd>{text((proof.value.reconciliationEvidence as Record<string, unknown>).reference)}</dd></div><div><dt>观察时间</dt><dd>{text((proof.value.reconciliationEvidence as Record<string, unknown>).observedAt)}</dd></div></dl>}
          {Boolean(proof.value.financing) &&
            typeof proof.value.financing === "object" && (
              <dl className="portfolio-proof">
                {(
                  [
                    ["debtBefore", "核对前负现金"],
                    ["debtAfter", "变更后负现金"],
                    ["debtChange", "负现金变化"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>
                      {String(
                        (proof.value.financing as Record<string, unknown>)[
                          key
                        ] ?? "未知",
                      )}{" "}
                      {String(
                        proof.value.currency ?? proof.value.cashCurrency ?? "",
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          {proof.kind === "cash" &&
            proof.value.balanceAfter === null &&
            typeof proof.value.registeredBalanceAfter === "string" && (
              <details>
                <summary>原登记变动</summary>
                <p>
                  登记余额（变更后） {proof.value.registeredBalanceAfter}{" "}
                  {String(proof.value.currency)}
                </p>
              </details>
            )}
          {proof.kind === "trade" && <TradeAttachmentsSummary value={proof.value.attachments}/>}
          {proof.kind === "order" && <p>仅更新内部预留，自动执行未启用。</p>}
          <button
            className="button primary"
            disabled={busy || blocked}
            onClick={() => void confirm()}
          >
            {proof.data.action === "cancel" ? "确认取消" : "确认登记"}
          </button>
        </Dialog>
      )}
    </div>
  );
}
