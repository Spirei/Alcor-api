import { FinancingSourcePolicy } from "./financing-source-policy";
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
  emptyFinancingDraft,
  financingCurrencies,
  financingCommand,
  type FinancingDraft,
  type FinancingHead,
} from "./financing-state";

type Proof = {
  previewRevision: string;
  expiresAt: string;
  usedDebt: FinancingHead["debt"];
  policy: FinancingHead["policy"];
};
type Receipt = {
  requestId: string;
  state: string;
  message?: string;
  policy?: FinancingHead["policy"];
};
const reasons: Record<string, string> = {
  whole_owner_financial_scope_unknown: "完整原账范围尚未核实",
  cash_opening_unrecorded: "现金期初未登记",
  account_currency_opening_unrecorded: "部分账户币种未登记期初",
  actual_cash_or_fee_unknown: "实际现金或费用尚未核实",
  recorded_exchange_rate_missing: "缺少已保存的实际汇率",
};
export function FinancingPolicyPanel({
  session,
  accountKind,
  generation,
  blocked,
  onSubmit,
}: {
  session: Session;
  accountKind: string;
  generation: number;
  blocked: boolean;
  onSubmit: (data: Record<string, unknown>, proof: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false),
    [visible, setVisible] = useState(
      typeof document === "undefined" ? true : !document.hidden,
    ),
    [head, setHead] = useState<FinancingHead | null>(null),
    [draft, setDraft] = useState<FinancingDraft>(emptyFinancingDraft),
    [proof, setProof] = useState<Proof | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [receiptId, setReceiptId] = useState(""),
    [receipt, setReceipt] = useState<Receipt | null>(null),
    [refresh, setRefresh] = useState(0);
  const scope = [
    session.user.id,
    session.user.role,
    session.instance_id,
    session.receipt_scope,
    session.csrf,
    accountKind,
  ].join(":");
  const live = useRef(false),
    epoch = useRef(0),
    body = useRef<Record<string, unknown> | null>(null),
    dirty = useRef(false);
  const clearProof = useCallback(() => {
    epoch.current++;
    body.current = null;
    setProof(null);
  }, []);
  const retire = useCallback(() => {
    setHead(null);
    setDraft(emptyFinancingDraft());
    dirty.current = false;
    setReceiptId("");
    setReceipt(null);
    clearProof();
  }, [clearProof]);
  const fail = useCallback(
    (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "读取失败");
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
        live.current = false;
        retire();
      }
    },
    [retire],
  );
  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useLayoutEffect(() => {
    retire();
    live.current = open && visible;
    return () => {
      live.current = false;
      retire();
    };
  }, [scope, retire]);
  useLayoutEffect(() => {
    live.current = open && visible;
    clearProof();
    return () => {
      live.current = false;
      setHead(null);
      setReceipt(null);
      clearProof();
    };
  }, [open, visible, clearProof]);
  useEffect(() => {
    if (!open || !visible || !["real", "simulated"].includes(accountKind))
      return;
    clearProof();
    const current = epoch.current,
      controller = new AbortController();
    setHead(null);
    setError("");
    api<FinancingHead>(
      `/financing/policy?accountKind=${encodeURIComponent(accountKind)}`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (live.current && epoch.current === current) {
          setHead(value);
          if (!dirty.current)
            setDraft(
              value.policy
                ? {
                    currency: value.policy.currency,
                    limit: value.policy.limit ?? "",
                    initialMargin: value.policy.initialMargin ?? "",
                    maintenanceMargin: value.policy.maintenanceMargin ?? "",
                  }
                : emptyFinancingDraft(),
            );
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted && epoch.current === current)
          fail(reason);
      });
    return () => controller.abort();
  }, [
    open,
    visible,
    accountKind,
    generation,
    refresh,
    scope,
    clearProof,
    fail,
  ]);
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
  const edit = (part: Partial<FinancingDraft>) => {
    dirty.current = true;
    clearProof();
    setDraft((old) => ({ ...old, ...part }));
  };
  async function preview() {
    if (!head || busy || blocked || !live.current) return;
    clearProof();
    const current = epoch.current;
    setBusy(true);
    setError("");
    try {
      const data = financingCommand(head, draft, session.user.id, requestId());
      const result = await api<Proof>(
        "/financing/policy/preview",
        { method: "POST", body: JSON.stringify(data) },
        session.csrf,
      );
      if (live.current && epoch.current === current) {
        body.current = data;
        setProof(result);
      }
    } catch (reason) {
      if (epoch.current === current) fail(reason);
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!proof || !body.current || busy || blocked || !live.current) return;
    if (Date.parse(proof.expiresAt) <= Date.now()) {
      clearProof();
      return;
    }
    const data = body.current,
      token = proof.previewRevision;
    setReceiptId(String(data.requestId));
    setReceipt(null);
    setBusy(true);
    try {
      const done = await onSubmit(data, token);
      if (live.current) {
        clearProof();
        if (done) {
          dirty.current = false;
          setRefresh((old) => old + 1);
        } else setError("请查询原请求回执");
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
      const result = await api<Receipt>(
        `/financing/policy/operations/${encodeURIComponent(receiptId)}`,
      );
      if (live.current && epoch.current === current) setReceipt(result);
    } catch (reason) {
      if (epoch.current === current) fail(reason);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>融资政策</summary>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {head && (
        <>
          <dl className="portfolio-proof">
            <div>
              <dt>账本</dt>
              <dd>{accountKind === "real" ? "真实" : "模拟"}</dd>
            </div>
            <div>
              <dt>同身份同币种净现金负值</dt>
              <dd>
                {head.debt.debtKnown
                  ? `${head.debt.debt} ${head.debt.currency}`
                  : "未知"}
              </dd>
            </div>
          </dl>
          {!head.policyKnown && <p role="status">原融资政策尚未迁入</p>}
          <FinancingSourcePolicy
            session={session}
            head={head}
            generation={generation}
            blocked={blocked || busy}
            onSubmit={onSubmit}
          />
          {head.debt.blockers.map((reason) => (
            <p role="status" key={reason}>
              {reasons[reason] || "融资现金范围尚未核实"}
            </p>
          ))}
          {head.exceedsLimit && <p role="status">当前净负现金超过已登记额度</p>}
          <div className="fees-plan-fields">
            <label>
              政策币种
              <select
                value={draft.currency}
                disabled={busy || blocked}
                onChange={(event) => edit({ currency: event.target.value })}
              >
                <option value="">选择币种</option>
                {financingCurrencies.map((code) => (
                  <option value={code} key={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            {(
              [
                ["limit", "总额度"],
                ["initialMargin", "初始保证金金额"],
                ["maintenanceMargin", "维持保证金金额"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  inputMode="decimal"
                  value={draft[key]}
                  disabled={busy || blocked}
                  onChange={(event) => edit({ [key]: event.target.value })}
                />
              </label>
            ))}
            <button
              className="button"
              disabled={busy || blocked}
              onClick={() => void preview()}
            >
              核对政策
            </button>
          </div>
        </>
      )}
      {proof && (
        <div className="portfolio-proof">
          <p>
            同身份同币种净现金负值{" "}
            {proof.usedDebt.debtKnown
              ? `${proof.usedDebt.debt} ${proof.usedDebt.currency}`
              : "未知"}
          </p>
          <p>
            总额度 {proof.policy?.limit ?? "未设置"} {proof.policy?.currency}
          </p>
          <p>
            初始保证金金额 {proof.policy?.initialMargin ?? "未设置"} ·
            维持保证金金额 {proof.policy?.maintenanceMargin ?? "未设置"}
          </p>
          <button
            className="button primary"
            disabled={busy || blocked}
            onClick={() => void confirm()}
          >
            确认政策
          </button>
        </div>
      )}
      <details>
        <summary>查询政策回执</summary>
        <label>
          原请求UUID
          <input
            value={receiptId}
            disabled={busy}
            onChange={(event) => {
              setReceiptId(event.target.value);
              setReceipt(null);
            }}
          />
        </label>
        <button className="button" disabled={busy} onClick={() => void query()}>
          查询回执
        </button>
        {receipt && (
          <p role="status">
            {receipt.state === "completed" ? "已完成" : "未完成"} ·{" "}
            {receipt.requestId}
            {receipt.message ? ` · ${receipt.message}` : ""}
          </p>
        )}
      </details>
    </details>
  );
}
