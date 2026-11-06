import { LoadingPlaceholder } from "./loading-placeholder";
import "./fund-sources.css";
import { SelectMenu } from "./select-menu";
import { PrivateAmount } from "./financial-display";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { requestId } from "./request-id";
import { cashKinds } from "./cash-flow-state";
import { brokerCurrencies, brokerAccountLabels } from "./broker-account-state";

type Account = {
  id: string;
  name: string;
  account_kind: string;
  holding_source: string;
  currency: string;
  currencies?: string[];
};
type Source = {
  id: string;
  requestId: string;
  accountId: string | null;
  accountKind: string;
  currency: string;
  revision: number;
  action: string;
  amount: string;
  delta: string;
  note: string;
  occurredAt: string;
  retired: boolean;
  retirementRequestId: string | null;
  canRetire: boolean;
};
type State = {
  sources: Source[];
  revision: number;
  partial: boolean;
  pagination: { limit: number; offset: number; total: number };
};
type Command = Record<string, unknown> & { requestId: string };
type Preview = {
  previewId: string;
  cashPreview: string;
  expiresAt: string;
  delta: string | null;
  balanceBefore?: string | null;
  balanceAfter: string | null;
  registeredBalanceAfter: string | null;
  currency: string;
  accountKind: string;
  reconciliationEvidence?: { reference: string | null; observedAt: string };
  kind: string;
};
type Receipt = {
  requestId: string;
  state: string;
  executed?: boolean;
  source?: Source;
  delta?: string;
  currency?: string;
  registeredBalanceAfter?: string | null;
  balanceAfter?: string | null;
};
const root = "/account/fund-sources";
export function FundSourcesPanel(props: {
  session: Session;
  accounts: Account[];
  generation: string;
  onChanged: () => void;
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
  accounts,
  generation,
  onChanged,
}: {
  session: Session;
  accounts: Account[];
  generation: string;
  onChanged: () => void;
}) {
  const key =
    "fund-sources:" +
    JSON.stringify([
      session.instance_id,
      session.user.id,
      session.user.role,
      session.receipt_scope,
    ]);
  const [state, setState] = useState<State | null>(null),
    [kind, setKind] = useState("real"),
    [accountId, setAccountId] = useState(""),
    [currency, setCurrency] = useState("USD"),
    [action, setAction] = useState(""),
    [amount, setAmount] = useState(""),
    [when, setWhen] = useState(""),
    [note, setNote] = useState(""),
    [basis, setBasis] = useState(""),
    [reference, setReference] = useState(""),
    [observedAt, setObservedAt] = useState("");
  const [retiring, setRetiring] = useState<Source | null>(null),
    [receipt, setReceipt] = useState<Receipt | null>(null),
    [proof, setProof] = useState<{
      value: Preview;
      command: Command;
      epoch: number;
    } | null>(null),
    [ack, setAck] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
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
  const [offset, setOffset] = useState(0);
  const revision = useRef<number | null>(null);
  const epoch = useRef(0),
    alive = useRef(true);
  function invalidate() {
    epoch.current++;
    setProof(null);
    setAck(false);
    setReceipt(null);
  }
  const report = useCallback(
    (failure: unknown) => {
      if (failure instanceof ApiError && [401, 403].includes(failure.status)) {
        epoch.current++;
        setState(null);
        setProof(null);
        setReceipt(null);
        setRetiring(null);
        setAccountId("");
        setAmount("");
        setNote("");
        setReference("");
        setObservedAt("");
        setPending(null);
        try {
          sessionStorage.removeItem(key);
        } catch {
          /* Retire content. */
        }
      }
      setError(failure instanceof Error ? failure.message : "资金来源操作失败");
    },
    [key],
  );
  const load = useCallback(async () => {
    const run = epoch.current;
    try {
      const value = await api<State>(
        root +
          "?limit=25&offset=" +
          offset +
          (offset && revision.current !== null
            ? "&revision=" + revision.current
            : ""),
      );
      if (alive.current && run === epoch.current) {
        revision.current = value.revision;
        setState(value);
      }
    } catch (failure) {
      if (alive.current && run === epoch.current) {
        if (failure instanceof ApiError && failure.status === 409 && offset) {
          revision.current = null;
          setOffset(0);
        }
        setState(null);
        report(failure);
      }
    }
  }, [report, offset]);
  useEffect(() => {
    alive.current = true;
    epoch.current++;
    setProof(null);
    setAck(false);
    setState(null);
    void load();
    const visibility = () => {
      epoch.current++;
      setProof(null);
      setAck(false);
      setReceipt(null);
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      alive.current = false;
      epoch.current++;
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [load, generation]);
  useEffect(() => {
    if (!proof) return;
    const timer = window.setTimeout(
      () => {
        if (epoch.current === proof.epoch) {
          invalidate();
          setError("资金来源预览已过期");
        }
      },
      Math.max(0, Date.parse(proof.value.expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [proof]);
  function remember(id: string | null) {
    try {
      if (id) sessionStorage.setItem(key, id);
      else sessionStorage.removeItem(key);
      setPending(id);
      return true;
    } catch {
      if (!id) setPending(null);
      else setError("无法保留原请求编号，未提交资金变更");
      return !id;
    }
  }
  const selected = accounts.find((row) => row.id === accountId),
    currencies =
      selected?.currencies ||
      (selected ? [selected.currency] : [...brokerCurrencies]);
  async function prepare() {
    if (busy || pending || document.hidden) return;
    setError("");
    if (!when || !Number.isFinite(Date.parse(when))) {
      setError("请填写实际发生时间");
      return;
    }
    const request = requestId();
    let command: Command;
    if (retiring)
      command = {
        kind: "delete",
        requestId: request,
        sourceId: retiring.id,
        sourceRevision: retiring.revision,
        occurredAt: new Date(when).toISOString(),
        note,
      };
    else {
      if (!action || !amount.trim() || !currencies.includes(currency)) {
        setError("请选择操作、原币与实际金额");
        return;
      }
      if (action === "opening" && !basis) {
        setError("请明确期初来源");
        return;
      }
      if (
        action === "reconcile_balance" &&
        (!reference.trim() ||
          !observedAt ||
          !Number.isFinite(Date.parse(observedAt)))
      ) {
        setError("请填写本人余额观察依据与时间");
        return;
      }
      command = {
        kind: "create",
        requestId: request,
        cash: {
          accountId: accountId || null,
          accountKind: kind,
          currency,
          action,
          amount,
          occurredAt: new Date(when).toISOString(),
          note,
          ...(action === "opening" ? { openingBasis: basis } : {}),
          ...(action === "reconcile_balance"
            ? {
                evidence: {
                  reference: reference.trim(),
                  observedAt: new Date(observedAt).toISOString(),
                },
              }
            : {}),
        },
      };
    }
    invalidate();
    setBusy(true);
    const run = epoch.current;
    try {
      const value = await api<Preview>(
        root + "/preview",
        { method: "POST", body: JSON.stringify(command) },
        session.csrf,
      );
      if (
        alive.current &&
        run === epoch.current &&
        Date.parse(value.expiresAt) > Date.now()
      )
        setProof({ value, command, epoch: run });
    } catch (failure) {
      if (alive.current && run === epoch.current) report(failure);
    } finally {
      setBusy(false);
    }
  }
  function accept(value: Receipt, id: string) {
    if (
      value.requestId !== id ||
      !(
        value.state === "completed" ||
        (value.state === "closed" && value.executed === false)
      )
    )
      throw new Error("原资金请求仍待核对");
    remember(null);
    setProof(null);
    setAck(false);
    setReceipt(value);
    if (value.state === "completed") {
      setRetiring(null);
      setAmount("");
      void load();
      onChanged();
    }
  }
  async function commit() {
    const current = proof;
    if (
      !current ||
      !ack ||
      busy ||
      pending ||
      document.hidden ||
      current.epoch !== epoch.current ||
      Date.parse(current.value.expiresAt) <= Date.now()
    )
      return;
    if (!remember(current.command.requestId)) return;
    const run = epoch.current;
    setBusy(true);
    setError("");
    try {
      const value = await api<Receipt>(
        root + "/operations",
        {
          method: "POST",
          body: JSON.stringify({
            previewId: current.value.previewId,
            command: current.command,
            cashPreview: current.value.cashPreview,
            confirm: true,
          }),
        },
        session.csrf,
      );
      if (alive.current && run === epoch.current)
        accept(value, current.command.requestId);
    } catch (failure) {
      if (alive.current && run === epoch.current) {
        report(failure);
        setProof(null);
        setAck(false);
      }
    } finally {
      setBusy(false);
    }
  }
  async function resolve(close = false) {
    if (!pending || busy || document.hidden) return;
    const id = pending,
      run = epoch.current;
    setBusy(true);
    setError("");
    try {
      const value = await api<Receipt>(
        root + "/operations/" + id + (close ? "/close" : ""),
        close ? { method: "POST", body: "{}" } : {},
        close ? session.csrf : undefined,
      );
      if (alive.current && run === epoch.current) accept(value, id);
    } catch (failure) {
      if (alive.current && run === epoch.current) report(failure);
    } finally {
      setBusy(false);
    }
  }
  async function readReceipt(id: string) {
    const run = epoch.current;
    setError("");
    try {
      const value = await api<Receipt>(root + "/operations/" + id);
      if (value.requestId !== id) throw new Error("原请求回执不匹配");
      if (alive.current && run === epoch.current && !document.hidden)
        setReceipt(value);
    } catch (failure) {
      if (alive.current && run === epoch.current) report(failure);
    }
  }
  const current = proof && proof.epoch === epoch.current ? proof : null;
  const accountLabels = brokerAccountLabels(accounts);
  const visibleSources =
    state?.sources.filter((row) => row.accountKind === kind) || [];
  return (
    <div className="fund-sources-panel workspace-ui">
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="fund-sources-toolbar">
        <div>
          {state ? (
            <p role="status">
              共 {state.pagination.total} 条登记 · 本页 {visibleSources.length}{" "}
              条{kind === "real" ? "真实" : "模拟"}来源
            </p>
          ) : (
            !error && <LoadingPlaceholder label="正在读取资金来源" compact />
          )}
        </div>
        <SelectMenu
          label="资金账本"
          variant="compact"
          value={kind}
          disabled={busy || !!pending || !state}
          options={[
            { value: "real", label: "真实账本" },
            { value: "simulated", label: "模拟账本" },
          ]}
          onChange={(value) => {
            invalidate();
            setKind(value);
            setAccountId("");
            setRetiring(null);
          }}
        />
        <button
          className="button secondary"
          disabled={busy || !!pending}
          onClick={() => {
            invalidate();
            setState(null);
            revision.current = null;
            if (offset) setOffset(0);
            else void load();
          }}
        >
          重新读取
        </button>
      </div>
      <div className="workspace-table">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>原币</th>
              <th>本人登记来源</th>
              <th>原登记金额</th>
              <th>入账差额</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleSources.map((row) => (
              <tr key={row.id}>
                <td>{row.occurredAt}</td>
                <td>{row.currency}</td>
                <td>
                  {row.accountId
                    ? accounts.find((value) => value.id === row.accountId)
                        ?.name || "账户待核对"
                    : "未分配原币资金"}{" "}
                  · {cashKinds[row.action] || row.action}
                </td>
                <td data-label="原登记金额">
                  <PrivateAmount>{row.amount}</PrivateAmount>
                </td>
                <td data-label="入账差额">
                  <PrivateAmount>{row.delta}</PrivateAmount>
                </td>
                <td>{row.retired ? "已反向入账，原记录保留" : "本人登记"}</td>
                <td>
                  <button
                    disabled={busy}
                    onClick={() => void readReceipt(row.requestId)}
                  >
                    原回执
                  </button>
                  {row.retirementRequestId && (
                    <button
                      disabled={busy}
                      onClick={() => void readReceipt(row.retirementRequestId!)}
                    >
                      撤销回执
                    </button>
                  )}
                  <button
                    disabled={busy || !!pending || !row.canRetire}
                    onClick={() => {
                      invalidate();
                      setRetiring(row);
                      setWhen("");
                      setNote("");
                    }}
                  >
                    预览撤销
                  </button>
                </td>
              </tr>
            ))}
            {state && visibleSources.length === 0 && (
              <tr>
                <td colSpan={7} className="fund-sources-empty">
                  本页暂无该账本的资金来源
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {state && (state.partial || offset > 0) && (
        <div className="portfolio-actions">
          <button
            disabled={busy || !!pending || offset === 0}
            onClick={() => {
              invalidate();
              setOffset(Math.max(0, offset - state.pagination.limit));
            }}
          >
            上一页
          </button>
          <button
            disabled={busy || !!pending || !state.partial}
            onClick={() => {
              invalidate();
              setOffset(offset + state.pagination.limit);
            }}
          >
            下一页
          </button>
        </div>
      )}
      {retiring ? (
        <p>
          撤销{cashKinds[retiring.action] || retiring.action} ·{" "}
          {retiring.occurredAt} · 原差额{" "}
          <PrivateAmount>{retiring.delta}</PrivateAmount> {retiring.currency}
          <button
            onClick={() => {
              invalidate();
              setRetiring(null);
            }}
            disabled={busy || !!pending}
          >
            取消撤销
          </button>
        </p>
      ) : (
        <fieldset
          className="fund-source-form"
          disabled={busy || !!pending || !state}
        >
          <legend>登记资金来源</legend>
          <div className="form-grid">
            <label>
              归属
              <select
                value={accountId}
                onChange={(event) => {
                  invalidate();
                  setAccountId(event.target.value);
                  const account = accounts.find(
                    (row) => row.id === event.target.value,
                  );
                  setCurrency(account?.currency || "USD");
                  setBasis("");
                }}
              >
                <option value="">未分配原币资金</option>
                {accounts
                  .filter(
                    (row) =>
                      row.account_kind === kind &&
                      row.holding_source === "manual",
                  )
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {accountLabels.get(row.id) || row.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              操作
              <select
                value={action}
                onChange={(event) => {
                  invalidate();
                  setAction(event.target.value);
                }}
              >
                <option value="">请选择</option>
                {[
                  "opening",
                  "external_deposit",
                  "external_withdrawal",
                  "reconcile_balance",
                ].map((value) => (
                  <option key={value} value={value}>
                    {cashKinds[value]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              原币
              <select
                value={currency}
                onChange={(event) => {
                  invalidate();
                  setCurrency(event.target.value);
                }}
              >
                {currencies.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {action === "reconcile_balance" ? "核对后的目标余额" : "实际金额"}
              <input
                value={amount}
                inputMode="decimal"
                onChange={(event) => {
                  invalidate();
                  setAmount(event.target.value);
                }}
              />
            </label>
            {action === "opening" && (
              <label>
                期初来源
                <select
                  value={basis}
                  onChange={(event) => {
                    invalidate();
                    setBasis(event.target.value);
                  }}
                >
                  <option value="">请选择</option>
                  <option value="new_external_opening">新增外部期初</option>
                  {accountId && (
                    <option value="allocate_verified_unallocated_checkpoint">
                      分配已核实未分配资金
                    </option>
                  )}
                </select>
              </label>
            )}
            {action === "reconcile_balance" && (
              <>
                <label>
                  本人观察依据
                  <input
                    maxLength={300}
                    value={reference}
                    onChange={(event) => {
                      invalidate();
                      setReference(event.target.value);
                    }}
                  />
                </label>
                <label>
                  观察时间
                  <input
                    type="datetime-local"
                    value={observedAt}
                    onChange={(event) => {
                      invalidate();
                      setObservedAt(event.target.value);
                    }}
                  />
                </label>
              </>
            )}
          </div>
        </fieldset>
      )}
      <label>
        {retiring ? "实际撤销时间" : "实际发生时间"}
        <input
          type="datetime-local"
          disabled={busy || !!pending || !state}
          value={when}
          onChange={(event) => {
            invalidate();
            setWhen(event.target.value);
          }}
        />
      </label>
      <label>
        备注
        <input
          maxLength={500}
          disabled={busy || !!pending || !state}
          value={note}
          onChange={(event) => {
            invalidate();
            setNote(event.target.value);
          }}
        />
      </label>
      <button
        disabled={busy || !!pending || !state}
        onClick={() => void prepare()}
      >
        核对{retiring ? "反向入账" : "资金变更"}
      </button>
      {current && (
        <>
          <dl className="portfolio-proof">
            <div>
              <dt>账本 / 原币</dt>
              <dd>
                {current.value.accountKind === "real" ? "真实" : "模拟"} ·{" "}
                {current.value.currency}
              </dd>
            </div>
            <div>
              <dt>核对前余额</dt>
              <dd>{current.value.balanceBefore ?? "未知"}</dd>
            </div>
            <div>
              <dt>入账差额</dt>
              <dd>{current.value.delta ?? "未知"}</dd>
            </div>
            <div>
              <dt>核对后余额</dt>
              <dd>{current.value.balanceAfter ?? "未知"}</dd>
            </div>
            <div>
              <dt>登记余额（变更后）</dt>
              <dd>{current.value.registeredBalanceAfter ?? "未知"}</dd>
            </div>
          </dl>
          <label>
            <input
              type="checkbox"
              checked={ack}
              onChange={(event) => setAck(event.target.checked)}
              disabled={busy || !!pending}
            />
            {current.value.kind === "delete"
              ? "确认反向入账并保留原资金流水"
              : "确认本人登记的资金变更"}
          </label>
          <button
            disabled={busy || !!pending || !ack}
            onClick={() => void commit()}
          >
            确认登记
          </button>
        </>
      )}
      {receipt && (
        <details open>
          <summary>原请求回执</summary>
          <p>
            {receipt.requestId} ·{" "}
            {receipt.state === "completed"
              ? "已完成"
              : receipt.state === "closed"
                ? "已关闭，未执行"
                : "待核对"}
          </p>
          {receipt.delta !== undefined && (
            <p>
              入账差额 {receipt.delta} {receipt.currency}
            </p>
          )}
          {receipt.balanceAfter !== undefined && (
            <p>当时核对后余额 {receipt.balanceAfter ?? "未知"}</p>
          )}
        </details>
      )}
      {pending && (
        <div>
          <p role="status">资金结果待核对</p>
          <code>{pending}</code>
          <button disabled={busy} onClick={() => void resolve()}>
            查询原请求
          </button>
          <button disabled={busy} onClick={() => void resolve(true)}>
            关闭未执行请求
          </button>
        </div>
      )}
    </div>
  );
}
