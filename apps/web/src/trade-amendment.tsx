import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, ApiError, type Session } from "./api";
import { requestId } from "./request-id";
import {
  amendmentCommand,
  emptyAmendmentDraft,
  type AmendmentHead,
  type AmendmentDraft,
} from "./trade-amendment-state";
type Preview = {
  previewRevision: string;
  expiresAt: string;
  quantityBefore: string;
  quantityAfter: string;
  costBefore: string | null;
  costAfter: string | null;
  realizedBefore: string | null;
  realizedAfter: string | null;
  cashEffect: {
    currency: string;
    brokerBefore: string;
    brokerAfter: string;
    delta: string;
  };
};
type Receipt = {
  requestId: string;
  state: string;
  message?: string;
  amendmentId?: string;
  data?: Preview;
};
export function TradeAmendmentPanel({
  session,
  recordId,
  generation,
  blocked,
  onSubmit,
}: {
  session: Session;
  recordId: string;
  generation: number;
  blocked: boolean;
  onSubmit: (data: Record<string, unknown>, proof: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false),
    [visible, setVisible] = useState(
      typeof document === "undefined" ? true : !document.hidden,
    ),
    [head, setHead] = useState<AmendmentHead | null>(null),
    [selected, setSelected] = useState("");
  const [action, setAction] = useState<"amend" | "merge" | "delete">("amend"),
    [members, setMembers] = useState<string[]>([]);
  const [draft, setDraft] = useState<AmendmentDraft>(emptyAmendmentDraft),
    [proof, setProof] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [receiptId, setReceiptId] = useState(""),
    [receipt, setReceipt] = useState<Receipt | null>(null),
    [refresh, setRefresh] = useState(0);
  const live = useRef(false),
    epoch = useRef(0),
    proofBody = useRef<Record<string, unknown> | null>(null);
  const clearProof = useCallback(() => {
    ++epoch.current;
    setProof(null);
    proofBody.current = null;
  }, []);
  const fail = useCallback(
    (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "读取失败");
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
        live.current = false;
        setHead(null);
        setSelected("");
        setDraft(emptyAmendmentDraft());
        setReceiptId("");
        setReceipt(null);
        clearProof();
      }
    },
    [clearProof],
  );
  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useLayoutEffect(() => {
    live.current = open && visible;
    clearProof();
    return () => {
      live.current = false;
      setHead(null);
      setReceipt(null);
      clearProof();
    };
  }, [open, visible, recordId, clearProof]);
  useEffect(() => {
    if (!open || !visible) return;
    clearProof();
    const current = epoch.current;
    const controller = new AbortController();
    setHead(null);
    setError("");
    api<AmendmentHead>(
      `/trading/corrections?recordId=${encodeURIComponent(recordId)}`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (live.current && epoch.current === current) setHead(value);
      })
      .catch((reason) => {
        if (!controller.signal.aborted && epoch.current === current)
          fail(reason);
      });
    return () => controller.abort();
  }, [open, visible, recordId, generation, refresh, clearProof, fail]);
  useEffect(() => {
    if (blocked) clearProof();
  }, [blocked, clearProof]);
  useEffect(() => {
    if (!proof) return;
    const ms = Date.parse(proof.expiresAt) - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) {
      clearProof();
      return;
    }
    const timer = setTimeout(clearProof, ms);
    return () => clearTimeout(timer);
  }, [proof, clearProof]);
  const edit = (value: Partial<AmendmentDraft>) => {
    clearProof();
    setDraft((old) => ({ ...old, ...value }));
  };
  async function preview() {
    if (!head || blocked || busy || !live.current) return;
    clearProof();
    const current = epoch.current;
    setBusy(true);
    setError("");
    try {
      const data = amendmentCommand(
        head,
        selected,
        draft,
        session.user.id,
        requestId(),
        { action, members },
      );
      const value = await api<Preview>(
        "/trading/corrections/preview",
        { method: "POST", body: JSON.stringify(data) },
        session.csrf,
      );
      if (live.current && epoch.current === current) {
        proofBody.current = data;
        setProof(value);
      }
    } catch (reason) {
      if (epoch.current === current) fail(reason);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!proof || !proofBody.current || blocked || busy || !live.current)
      return;
    if (Date.parse(proof.expiresAt) <= Date.now()) {
      clearProof();
      setError("预览已过期，请重新核对");
      return;
    }
    const data = proofBody.current,
      token = proof.previewRevision;
    setReceiptId(String(data.requestId));
    setReceipt(null);
    setBusy(true);
    try {
      const done = await onSubmit(data, token);
      if (live.current) {
        clearProof();
        if (done) {
          setDraft(emptyAmendmentDraft());
          setSelected("");
          setRefresh((value) => value + 1);
        } else setError("请先查询原请求回执");
      }
    } finally {
      setBusy(false);
    }
  }
  async function query() {
    if (
      !live.current ||
      busy ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        receiptId,
      )
    ) {
      setError("请填写原请求UUID");
      return;
    }
    const current = epoch.current;
    setBusy(true);
    setError("");
    try {
      const value = await api<Receipt>(
        `/trading/corrections/operations/${encodeURIComponent(receiptId)}`,
      );
      if (live.current && epoch.current === current) setReceipt(value);
    } catch (reason) {
      if (epoch.current === current) fail(reason);
    } finally {
      setBusy(false);
    }
  }
  const item = head?.items.find((row) => row.tradeId === selected);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>成交更正</summary>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {head && (
        <>
          <label>
            操作
            <select
              value={action}
              disabled={blocked || busy}
              onChange={(event) => {
                clearProof();
                setAction(event.target.value as "amend" | "merge" | "delete");
                setMembers([]);
                setSelected("");
                setDraft(emptyAmendmentDraft());
              }}
            >
              <option value="amend">单笔更正</option>
              {head.mergeReady && <option value="merge">合并成交</option>}
              {head.deleteReady && <option value="delete">删除有效成交</option>}
            </select>
          </label>
          <label>
            {action === "merge" ? "时间来源原成交" : "原成交"}
            <select
              value={selected}
              disabled={blocked || busy}
              onChange={(event) => {
                clearProof();
                setSelected(event.target.value);
                setMembers([]);
                const row = head.items.find(
                  (item) => item.tradeId === event.target.value,
                );
                setDraft({
                  ...emptyAmendmentDraft(),
                  quantity:
                    action === "merge" ? "" : (row?.event?.quantity ?? ""),
                  price: action === "merge" ? "" : (row?.event?.price ?? ""),
                  occurredAt: row?.event?.occurred_at ?? "",
                });
              }}
            >
              <option value="">选择原成交</option>
              {head.items
                .filter((row) => row.event !== null)
                .map((row) => (
                  <option value={row.tradeId} key={row.tradeId}>
                    {row.event!.side === "buy" ? "买入" : "卖出"} ·{" "}
                    {row.event!.occurred_at} · {row.tradeId}
                  </option>
                ))}
            </select>
          </label>
          {item?.event && (
            <>
              {item.blocker && <p role="status">{item.blocker}</p>}
              <details>
                <summary>原始依据</summary>
                <p>
                  当前登记费用 {item.event.fees} {item.event.currency} · 实付{" "}
                  {item.actualFeeKnown ? item.event.fees : "未知"}
                </p>
                <p>原登记回执 {item.registrationRequestId}</p>
                {item.sourceAuthority && (
                  <>
                    <p>来源原单 {item.sourceAuthority.sourceOrderId}</p>
                    <p>
                      原始回执{" "}
                      {item.sourceAuthority.originalRequestId ?? "未记录"}
                    </p>
                    <p>
                      来源清单 {item.sourceAuthority.manifestId} ·{" "}
                      {item.sourceAuthority.sourceRevision}
                    </p>
                  </>
                )}
                {item.currentAmendmentId && (
                  <p>上次更正 {item.currentAmendmentId}</p>
                )}
              </details>
              {action === "merge" && item.canAmend && (
                <fieldset disabled={blocked || busy}>
                  <legend>合并其他原成交</legend>
                  {head.items
                    .filter(
                      (row) =>
                        row.tradeId !== selected &&
                        row.canAmend &&
                        row.event?.side === item.event?.side &&
                        row.event?.currency === item.event?.currency,
                    )
                    .map((row) => (
                      <label className="checkbox-line" key={row.tradeId}>
                        <input
                          type="checkbox"
                          checked={members.includes(row.tradeId)}
                          onChange={(event) => {
                            clearProof();
                            setMembers((old) =>
                              event.target.checked
                                ? [...old, row.tradeId]
                                : old.filter((id) => id !== row.tradeId),
                            );
                          }}
                        />
                        {row.event!.occurred_at} · {row.event!.quantity} ×{" "}
                        {row.event!.price} · {row.tradeId}
                      </label>
                    ))}
                </fieldset>
              )}
              {item.canAmend && (
                <div className="fees-plan-fields">
                  {action !== "delete" &&
                    (
                      [
                        ["quantity", "数量"],
                        ["price", "价格"],
                        ["fees", "实付费用"],
                        ["occurredAt", "成交时间（带时区）"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key}>
                        {label}
                        {key === "fees" || key === "price"
                          ? `（${item.event!.currency}）`
                          : ""}
                        <input
                          value={draft[key]}
                          inputMode={
                            key === "occurredAt" ? undefined : "decimal"
                          }
                          disabled={
                            blocked ||
                            busy ||
                            (action === "merge" && key === "occurredAt")
                          }
                          onChange={(event) =>
                            edit({ [key]: event.target.value })
                          }
                        />
                      </label>
                    ))}
                  <label>
                    更正依据
                    <textarea
                      value={draft.statement}
                      maxLength={4096}
                      rows={3}
                      disabled={blocked || busy}
                      onChange={(event) =>
                        edit({ statement: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={draft.actual}
                      disabled={blocked || busy}
                      onChange={(event) =>
                        edit({ actual: event.target.checked })
                      }
                    />
                    本人已核实实际成交及实付费用
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={draft.ledger}
                      disabled={blocked || busy}
                      onChange={(event) =>
                        edit({ ledger: event.target.checked })
                      }
                    />
                    确认仅更正内部账本
                  </label>
                  <label>
                    <input type="checkbox" checked={draft.financing ?? false} disabled={blocked || busy}
                      onChange={(event) => edit({ financing: event.target.checked, financingStatement: "" })} />
                    更正涉及已核实的实际融资
                  </label>
                  {draft.financing && <label>实际融资依据
                    <textarea value={draft.financingStatement ?? ""} maxLength={4096} rows={3} disabled={blocked || busy}
                      onChange={(event) => edit({ financingStatement: event.target.value })} />
                  </label>}
                  <button
                    className="button"
                    disabled={
                      blocked ||
                      busy ||
                      (draft.financing && !draft.financingStatement?.trim()) ||
                      !draft.actual ||
                      !draft.ledger ||
                      !draft.fees.trim() ||
                      !draft.statement.trim()
                    }
                    onClick={() => void preview()}
                  >
                    预览更正
                  </button>
                </div>
              )}
            </>
          )}
          {proof && (
            <div>
              <p>
                数量 {proof.quantityBefore} → {proof.quantityAfter}
              </p>
              <p>
                成本 {proof.costBefore ?? "未知"} → {proof.costAfter ?? "未知"}
              </p>
              <p>
                实际收益 {proof.realizedBefore ?? "未知"} →{" "}
                {proof.realizedAfter ?? "未知"}
              </p>
              <p>
                账户余额 {proof.cashEffect.brokerBefore} →{" "}
                {proof.cashEffect.brokerAfter} {proof.cashEffect.currency} ·
                差额 {proof.cashEffect.delta}
              </p>
              <button
                className="button primary"
                disabled={blocked || busy}
                onClick={() => void commit()}
              >
                确认更正
              </button>
            </div>
          )}
        </>
      )}
      <details>
        <summary>查询更正回执</summary>
        <label>
          原请求UUID
          <input
            value={receiptId}
            onChange={(event) => {
              setReceiptId(event.target.value);
              setReceipt(null);
            }}
          />
        </label>
        <button
          className="button"
          disabled={busy || !receiptId.trim()}
          onClick={() => void query()}
        >
          查询原回执
        </button>
        {receipt && (
          <>
            <p>
              {receipt.state === "completed"
                ? "已完成"
                : receipt.state === "failed"
                  ? (receipt.message ?? "未完成")
                  : "结果待核对"}{" "}
              · {receipt.requestId}
            </p>
            {receipt.data && (
              <p>
                账户差额 {receipt.data.cashEffect.delta}{" "}
                {receipt.data.cashEffect.currency}
              </p>
            )}
          </>
        )}
      </details>
    </details>
  );
}
