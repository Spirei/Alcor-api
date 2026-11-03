import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { requestId } from "./request-id";
import { PasswordField } from "./password-fields";
import { validMarketOperation } from "./market-history-model";

type Account = {
  id: string;
  name: string;
  account_kind: string;
  revision: number;
};
type Statement = {
  externalAccount: string;
  sourceSha256: string;
  fromDate: string;
  toDate: string;
  positions: { key: string; qty: string; price: string; cost: string }[];
  cash: { currency: string; endingCash: string }[];
  events: unknown[];
  warnings: string[];
};
type Comparison = {
  rows: {
    key: string;
    action: string;
    recordId: string | null;
    before: { qty: string | null } | null;
    qty: string;
    unassignedMatches: string[];
  }[];
  missing: {
    recordId: string;
    security: string;
    before: string | null;
    after: string | null;
    action: string;
  }[];
  blockers: { security: string; reason: string; field?: string }[];
  accountRevision: number;
  recordCollectionRevision: number;
  requiresUnassignedAcknowledgement: boolean;
};
type SourceState = {
  accountId: string;
  accountKind: string;
  accountRevision: number;
  connectionRevision: number;
  configured: boolean;
  externalAccount: string | null;
  targets: { id: string; label: string }[];
};
type Receipt = {
  previousRequestId?: string;
  connectionRevision?: number;
  preview?: Receipt;
  importId?: string;
  asOfDate?: string;
  positions?: number;
  newArchivedEvents?: number;
  cashLedgerChanged?: boolean;
  sourceSha256?: string;
  previewId?: string;
  applySupported?: boolean;
  expiresAt?: string;
  requestId: string;
  state: string;
  accountId?: string;
  accountKind?: string;
  originalId?: string;
  statement?: Statement;
  comparison?: Comparison;
};
type Pending = { id: string; kind: "preview" | "import" | "source" | "fetch" };
type Props = { session: Session; active?: boolean; initialAccountId?: string };
const root = "/account/broker-statements";

export function BrokerStatementPreview(props: Props) {
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
        props.initialAccountId,
      ])}
      {...props}
    />
  );
}
function Content({ session, active = true, initialAccountId = "" }: Props) {
  const storageKey =
    "alcor.statement-preview:" +
    JSON.stringify([
      session.instance_id,
      session.user.id,
      session.user.role,
      session.receipt_scope,
    ]);
  const [accounts, setAccounts] = useState<Account[]>([]),
    [accountId, setAccountId] = useState(initialAccountId);
  const [external, setExternal] = useState(""),
    [file, setFile] = useState<File | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null),
    [pending, setPending] = useState<Pending | null>(null);
  const [source, setSource] = useState<SourceState | null>(null),
    [sourceError, setSourceError] = useState(""),
    [sourceReload, setSourceReload] = useState(0);
  const [targetId, setTargetId] = useState(""),
    [queryId, setQueryId] = useState(""),
    [sourceToken, setSourceToken] = useState(""),
    [sourceExternal, setSourceExternal] = useState("");
  const [continuation, setContinuation] = useState<{
    id: string;
    accountId: string;
    revision: number;
  } | null>(null);
  const [confirmExternal, setConfirmExternal] = useState(""),
    [takeOver, setTakeOver] = useState(false),
    [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false),
    [locked, setLocked] = useState(false),
    [error, setError] = useState("");
  const [visible, setVisible] = useState(
    typeof document === "undefined" || !document.hidden,
  );
  const generation = useRef(0),
    controller = useRef<AbortController | null>(null),
    working = useRef(false),
    fileInput = useRef<HTMLInputElement>(null);
  function withdraw() {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    working.current = false;
    setFile(null);
    setSourceToken("");
    setQueryId("");
    setSourceExternal("");
    setSource(null);
    setContinuation(null);
    setExternal("");
    setConfirmExternal("");
    setTakeOver(false);
    setAcknowledge(false);
    setReceipt(null);
    setAccounts([]);
    setBusy(false);
    if (fileInput.current) fileInput.current.value = "";
  }
  function current(serial: number) {
    return (
      serial === generation.current &&
      active &&
      !document.hidden &&
      apiSessionSnapshot().csrf === session.csrf
    );
  }
  function failure(reason: unknown) {
    setError(reason instanceof Error ? reason.message : "账单预览失败");
    if (
      apiSessionSnapshot().csrf !== session.csrf ||
      (reason instanceof ApiError && [401, 403].includes(reason.status))
    ) {
      withdraw();
      setLocked(true);
    }
  }
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (!saved) setPending(null);
      else {
        const value: unknown = validMarketOperation(saved)
          ? { id: saved, kind: "preview" }
          : JSON.parse(saved);
        if (
          !value ||
          typeof value !== "object" ||
          Object.keys(value).sort().join(",") !== "id,kind" ||
          !("id" in value) ||
          typeof value.id !== "string" ||
          !validMarketOperation(value.id) ||
          !("kind" in value) ||
          !["preview", "import", "source", "fetch"].includes(String(value.kind))
        )
          throw Error("原操作编号无效");
        setPending(value as Pending);
      }
    } catch {
      setLocked(true);
      setError("原操作状态无法读取，请重新核对");
    }
    const visibility = () => {
      if (document.hidden) withdraw();
      setVisible(!document.hidden);
    };
    const changed = () => {
      withdraw();
      setLocked(true);
      setError("登录身份已变化，请重新打开账单预览");
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("alcor:session-changed", changed);
    window.addEventListener("alcor:session-expired", changed);
    return () => {
      generation.current++;
      controller.current?.abort();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("alcor:session-changed", changed);
      window.removeEventListener("alcor:session-expired", changed);
    };
  }, [storageKey]);
  useEffect(() => {
    if (!active || !visible || locked) {
      withdraw();
      return;
    }
    const serial = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    void api<{ accounts: Account[] }>("/account/broker-metadata", {
      signal: abort.signal,
    })
      .then((value) => {
        if (current(serial)) setAccounts(value.accounts);
      })
      .catch((reason) => {
        if (current(serial)) failure(reason);
      });
    return () => {
      generation.current++;
      abort.abort();
    };
  }, [active, visible, locked]);
  useEffect(() => {
    setSource(null);
    setSourceError("");
    setSourceToken("");
    setQueryId("");
    setSourceExternal("");
    setTargetId("");
    if (
      !active ||
      !visible ||
      locked ||
      !accountId ||
      (pending && !continuation)
    )
      return;
    const abort = new AbortController();
    void api<SourceState>(
      `${root}/accounts/${encodeURIComponent(accountId)}/source`,
      { signal: abort.signal },
    )
      .then((value) => {
        if (
          !abort.signal.aborted &&
          active &&
          !document.hidden &&
          apiSessionSnapshot().csrf === session.csrf &&
          value.accountId === accountId
        ) {
          setSource(value);
          setAccounts((items) =>
            items.map((item) =>
              item.id === value.accountId
                ? {
                    ...item,
                    revision: value.accountRevision,
                    account_kind: value.accountKind,
                  }
                : item,
            ),
          );
        }
      })
      .catch((reason) => {
        if (!abort.signal.aborted) {
          setSourceError(
            reason instanceof Error ? reason.message : "来源读取失败",
          );
          if (reason instanceof ApiError && [401, 403].includes(reason.status))
            failure(reason);
        }
      });
    return () => abort.abort();
  }, [accountId, active, visible, locked, pending, sourceReload, continuation]);
  function remember(value: Pending | null) {
    if (value) {
      const encoded = JSON.stringify(value);
      sessionStorage.setItem(storageKey, encoded);
      if (sessionStorage.getItem(storageKey) !== encoded)
        throw Error("原操作编号无法可靠保存，未提交");
    } else sessionStorage.removeItem(storageKey);
    setPending(value);
  }
  async function run(
    action:
      | "preview"
      | "import"
      | "source"
      | "fetch"
      | "disable"
      | "receipt"
      | "close",
  ) {
    if (
      working.current ||
      locked ||
      !active ||
      document.hidden ||
      (!["receipt", "close"].includes(action) &&
        pending &&
        !(action === "fetch" && continuation?.id === pending.id))
    )
      return;
    if (!["receipt", "close"].includes(action)) {
      try {
        if (
          sessionStorage.getItem(storageKey) !== null &&
          !(
            action === "fetch" &&
            continuation &&
            pending?.id === continuation.id &&
            pending.kind === "fetch"
          )
        )
          throw Error("已有原操作待核对，请重新打开账单");
      } catch (reason) {
        setLocked(true);
        setError(
          reason instanceof Error ? reason.message : "原操作状态无法读取",
        );
        return;
      }
    }
    const selected = accounts.find((a) => a.id === accountId);
    if (
      action === "preview" &&
      (!selected ||
        !["real", "simulated"].includes(selected.account_kind) ||
        !file ||
        !/^[A-Za-z0-9-]{2,40}$/.test(external))
    )
      return;
    if (
      action === "import" &&
      (!receipt?.previewId ||
        !receipt.applySupported ||
        !receipt.statement ||
        !receipt.comparison ||
        receipt.comparison.blockers.length ||
        !takeOver ||
        confirmExternal !== receipt.statement.externalAccount ||
        (receipt.comparison.requiresUnassignedAcknowledgement && !acknowledge))
    )
      return;
    if ((action === "receipt" || action === "close") && !pending) return;
    if (
      (action === "source" || action === "fetch" || action === "disable") &&
      (!source || source.accountId !== accountId)
    )
      return;
    if (action === "disable" && !source?.configured) return;
    if (
      action === "source" &&
      (!targetId ||
        !source?.targets.some((t) => t.id === targetId) ||
        !queryId ||
        !sourceToken ||
        !/^[A-Za-z0-9-]{2,40}$/.test(sourceExternal))
    )
      return;
    if (
      action === "fetch" &&
      (!source?.configured ||
        (continuation &&
          (continuation.accountId !== accountId ||
            continuation.revision !== source.connectionRevision)))
    )
      return;
    const originalPreview = receipt;
    const serial = ++generation.current,
      abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    working.current = true;
    setBusy(true);
    setError("");
    setReceipt(null);
    let operation = pending;
    let transmitted = false;
    try {
      let payload: object | undefined;
      if (action === "preview") {
        if (!file || file.size < 1 || file.size > 8 * 1024 * 1024)
          throw Error("请选择不超过 8MB 的 UTF-8 XML 文件");
        const bytes = await file.arrayBuffer();
        if (!current(serial)) return;
        const xml = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(bytes);
        operation = { id: requestId(), kind: "preview" };
        remember(operation);
        payload = {
          requestId: operation.id,
          accountId: selected!.id,
          accountKind: selected!.account_kind,
          revision: selected!.revision,
          externalAccount: external,
          xml,
        };
      }
      if (action === "import") {
        operation = { id: requestId(), kind: "import" };
        remember(operation);
        payload = {
          requestId: operation.id,
          previewId: originalPreview!.previewId,
          confirmExternalAccount: confirmExternal,
          takeOverOfficial: true,
          acknowledgeUnassigned: acknowledge,
        };
        setConfirmExternal("");
        setTakeOver(false);
        setAcknowledge(false);
      }
      if (action === "source" || action === "fetch" || action === "disable") {
        operation = {
          id: requestId(),
          kind: action === "disable" ? "source" : action,
        };
        remember(operation);
        payload =
          action === "source"
            ? {
                requestId: operation.id,
                accountKind: source!.accountKind,
                accountRevision: source!.accountRevision,
                connectionRevision: source!.connectionRevision,
                targetId,
                externalAccount: sourceExternal,
                queryId,
                token: sourceToken,
              }
            : action === "disable"
              ? {
                  requestId: operation.id,
                  connectionRevision: source!.connectionRevision,
                  accountRevision: source!.accountRevision,
                }
              : {
                  requestId: operation.id,
                  connectionRevision: source!.connectionRevision,
                  ...(continuation
                    ? { previousRequestId: continuation.id }
                    : {}),
                };
        setSourceToken("");
        setQueryId("");
        setSourceExternal("");
        setContinuation(null);
      }
      if (!operation || !current(serial)) return;
      const id = operation.id;
      const operationRoot = `${root}/${operation.kind === "import" ? "imports" : ["source", "fetch"].includes(operation.kind) ? "source-operations" : "operations"}`;
      transmitted = true;
      const value = await api<Receipt>(
        action === "preview"
          ? root + "/preview"
          : action === "source" || action === "fetch" || action === "disable"
            ? `${root}/accounts/${encodeURIComponent(accountId)}/${action === "fetch" ? "fetch" : "source"}`
            : action === "import"
              ? root + "/imports"
              : `${operationRoot}/${id}${action === "close" ? "/close" : ""}`,
        {
          method:
            action === "receipt"
              ? "GET"
              : action === "disable"
                ? "DELETE"
                : "POST",
          signal: abort.signal,
          ...(payload
            ? { body: JSON.stringify(payload) }
            : action === "close"
              ? { body: "{}" }
              : {}),
        },
        action === "receipt" ? undefined : session.csrf,
      );
      if (!current(serial)) return;
      if (value.requestId !== id) throw Error("原操作回执不匹配");
      setReceipt(value.preview ?? value);
      if (operation.kind === "fetch" && value.state === "pending") {
        const sourceAccount = value.accountId;
        if (!sourceAccount || typeof value.connectionRevision !== "number")
          throw Error("下载接续信息不完整，请核对原操作");
        setContinuation({
          id,
          accountId: sourceAccount,
          revision: value.connectionRevision,
        });
        setAccountId(sourceAccount);
      } else if (value.state === "unknown") {
        setContinuation(null);
        setError("外部请求结果未确认，只能核对原操作，不能重新获取。");
      } else {
        setContinuation(null);
        remember(null);
      }
      setSourceReload((v) => v + 1);
      setFile(null);
      setExternal("");
      setConfirmExternal("");
      setTakeOver(false);
      setAcknowledge(false);
      if (fileInput.current) fileInput.current.value = "";
    } catch (reason) {
      if (current(serial)) {
        if (
          action === "preview" &&
          (!transmitted ||
            (reason instanceof ApiError &&
              [400, 413, 415, 422, 429].includes(reason.status)))
        ) {
          try {
            remember(null);
          } catch {
            setLocked(true);
          }
        }
        failure(reason);
      }
    } finally {
      if (current(serial)) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  if (!active || !visible) return <section aria-hidden="true" />;
  if (locked) return <p role="alert">{error || "请重新核对当前登录身份"}</p>;
  const statement = receipt?.statement;
  return (
    <section className="panel">
      <h2>IBKR 账单</h2>
      <p>
        原件和官方流水会单独保存。预览不改变持仓或现金；外部账户编号目前仅作本人声明，尚未核实关联。
      </p>
      {error && <p role="alert">{error}</p>}
      {pending ? (
        <div>
          <p>
            结果待核对：<code>{pending.id}</code> ·{" "}
            {
              {
                import: "确认导入",
                preview: "保存预览",
                source: "配置来源",
                fetch: "获取账单",
              }[pending.kind]
            }
          </p>
          <button disabled={busy} onClick={() => void run("receipt")}>
            核对原操作
          </button>
          <button disabled={busy} onClick={() => void run("close")}>
            关闭未完成操作
          </button>
          {continuation && (
            <>
              <p>来源仍在准备账单，尚未生成预览。</p>
              <button
                disabled={
                  busy ||
                  !source ||
                  source.accountId !== continuation.accountId ||
                  source.connectionRevision !== continuation.revision
                }
                onClick={() => void run("fetch")}
              >
                继续获取
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="form-grid">
          <label>
            账户
            <select
              value={accountId}
              disabled={busy}
              onChange={(e) => {
                setAccountId(e.target.value);
                setReceipt(null);
              }}
            >
              <option value="">选择账户</option>
              {accounts
                .filter((a) => ["real", "simulated"].includes(a.account_kind))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ·{" "}
                    {a.account_kind === "real" ? "真实账本" : "模拟账本"}
                  </option>
                ))}
            </select>
          </label>
          {accountId && (
            <details>
              <summary>账单来源</summary>
              {sourceError && <p role="alert">{sourceError}</p>}
              {source ? (
                <div className="form-grid">
                  <p>
                    {source.configured
                      ? `已配置 · ${source.externalAccount ?? "外部账户未知"}`
                      : "尚未配置"}
                  </p>
                  <label>
                    已安装目标
                    <select
                      disabled={busy}
                      value={targetId}
                      onChange={(e) => setTargetId(e.target.value)}
                    >
                      <option value="">选择目标</option>
                      {source.targets.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    外部账户编号
                    <input
                      value={sourceExternal}
                      maxLength={40}
                      disabled={busy}
                      onChange={(e) => setSourceExternal(e.target.value)}
                    />
                  </label>
                  <label>
                    查询编号
                    <PasswordField
                      id={"statement-query-" + accountId}
                      aria-label="查询编号"
                      value={queryId}
                      onChange={(e) => setQueryId(e.target.value)}
                      autoComplete="off"
                      disabled={busy}
                    />
                  </label>
                  <label>
                    访问令牌
                    <PasswordField
                      id={"statement-token-" + accountId}
                      aria-label="访问令牌"
                      value={sourceToken}
                      onChange={(e) => setSourceToken(e.target.value)}
                      autoComplete="off"
                      disabled={busy}
                    />
                  </label>
                  <button
                    disabled={
                      busy ||
                      !targetId ||
                      !queryId ||
                      !sourceToken ||
                      !/^[A-Za-z0-9-]{2,40}$/.test(sourceExternal)
                    }
                    onClick={() => void run("source")}
                  >
                    保存来源配置
                  </button>
                  {source.targets.length === 0 && (
                    <p>没有可用目标，需先由管理员配置。</p>
                  )}
                  {source.configured && (
                    <button disabled={busy} onClick={() => void run("disable")}>
                      停用后续获取
                    </button>
                  )}
                  {source.configured && (
                    <button
                      disabled={
                        busy ||
                        (!!continuation &&
                          (continuation.accountId !== accountId ||
                            continuation.revision !==
                              source.connectionRevision))
                      }
                      onClick={() => void run("fetch")}
                    >
                      {continuation ? "继续获取" : "获取账单一次"}
                    </button>
                  )}
                  {continuation && (
                    <p>
                      来源仍在准备账单，尚未生成预览。继续获取将使用新操作编号接续已知结果。
                    </p>
                  )}
                </div>
              ) : (
                !sourceError && <p role="status">正在读取来源…</p>
              )}
            </details>
          )}
          <label>
            账单中的外部账户编号
            <input
              value={external}
              maxLength={40}
              disabled={busy}
              onChange={(e) => {
                setExternal(e.target.value);
                setReceipt(null);
              }}
            />
          </label>
          <label>
            UTF-8 XML 文件
            <input
              ref={fileInput}
              type="file"
              accept=".xml,application/xml,text/xml"
              disabled={busy}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setReceipt(null);
              }}
            />
          </label>
          <button
            disabled={
              busy ||
              !accountId ||
              !file ||
              !/^[A-Za-z0-9-]{2,40}$/.test(external)
            }
            onClick={() => void run("preview")}
          >
            保存原件并预览
          </button>
        </div>
      )}
      {receipt && (
        <p role="status">
          {receipt.state === "closed"
            ? "原操作已关闭"
            : receipt.state === "disabled"
              ? "已停用后续获取；原件、历史与快照保留"
              : receipt.state === "configured"
                ? "来源配置已保存"
                : receipt.state === "pending"
                  ? "账单仍在准备"
                  : receipt.state === "previewed"
                    ? "预览已保存"
                    : receipt.state === "completed"
                      ? "账单已导入"
                      : receipt.state}{" "}
          · <code>{receipt.requestId}</code>
        </p>
      )}
      {receipt?.state === "completed" && (
        <div>
          <p>
            账户 {receipt.accountId} · 截至 {receipt.asOfDate} · 持仓{" "}
            {receipt.positions ?? "未知"} 项 · 新归档流水{" "}
            {receipt.newArchivedEvents ?? "未知"} 条。
          </p>
          {receipt.cashLedgerChanged === false && (
            <p>未改写现金账本；历史流水未重复计入持仓。</p>
          )}
          {receipt.sourceSha256 && (
            <p>
              原件 SHA-256：<code>{receipt.sourceSha256}</code>
            </p>
          )}
        </div>
      )}
      {statement && (
        <div>
          <p>
            账单账户：{receipt?.accountId} · {statement.fromDate} 至{" "}
            {statement.toDate}
          </p>
          <p>
            持仓 {statement.positions.length} 项，原始流水{" "}
            {statement.events.length} 条。尚未导入。
          </p>
          <p>
            原件 SHA-256：<code>{statement.sourceSha256}</code>
          </p>
          {receipt?.originalId && validMarketOperation(receipt.originalId) && (
            <a href={`/api${root}/originals/${receipt.originalId}`} download>
              下载保存的账单原件
            </a>
          )}
          <h3>账单期末现金</h3>
          {statement.cash.length ? (
            <ul>
              {statement.cash.map((c) => (
                <li key={c.currency}>
                  {c.currency} {c.endingCash}
                </li>
              ))}
            </ul>
          ) : (
            <p>未知：账单未提供分币种期末现金。</p>
          )}
          <h3>期末持仓</h3>
          <table>
            <thead>
              <tr>
                <th>证券</th>
                <th>数量</th>
                <th>价格</th>
                <th>每股成本</th>
              </tr>
            </thead>
            <tbody>
              {statement.positions.slice(0, 100).map((p) => (
                <tr key={p.key}>
                  <td>{p.key}</td>
                  <td>{p.qty}</td>
                  <td>{p.price}</td>
                  <td>{p.cost}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {statement.positions.length > 100 && (
            <p>此处仅展示前 100 项，完整内容保留在原件中。</p>
          )}
          {receipt?.comparison && (
            <div>
              <h3>与平台持仓核对</h3>
              <p>
                账户版本 {receipt.comparison.accountRevision} · 记录版本{" "}
                {receipt.comparison.recordCollectionRevision}
                。此处展示拟议差异，尚未执行。
              </p>
              {receipt.comparison.requiresUnassignedAcknowledgement && (
                <p>存在同证券的未绑定记录，需要单独核对；不会自动归并。</p>
              )}
              <table>
                <thead>
                  <tr>
                    <th>证券</th>
                    <th>现有数量</th>
                    <th>账单数量</th>
                    <th>拟议处理</th>
                  </tr>
                </thead>
                <tbody>
                  {receipt.comparison.rows.slice(0, 100).map((row) => (
                    <tr key={row.key}>
                      <td>{row.key}</td>
                      <td>
                        {row.recordId
                          ? (row.before?.qty ?? "未知")
                          : "无对应记录"}
                      </td>
                      <td>{row.qty}</td>
                      <td>
                        {row.action === "create"
                          ? "新增快照记录"
                          : "更新期末快照"}
                      </td>
                    </tr>
                  ))}
                  {receipt.comparison.missing.slice(0, 100).map((row) => (
                    <tr key={row.recordId}>
                      <td>{row.security}</td>
                      <td>{row.before ?? "未知"}</td>
                      <td>{row.after ?? "无法核对"}</td>
                      <td>
                        {row.action === "unresolved"
                          ? "待核对"
                          : "账单中未持有"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(receipt.comparison.rows.length > 100 ||
                receipt.comparison.missing.length > 100) && (
                <p>差异表每类仅显示前 100 项。</p>
              )}
              {receipt.comparison.blockers.map((item, index) => (
                <p key={index}>
                  {item.security}：
                  {item.reason === "existing_quantity_unknown"
                    ? "现有数量未知，不能直接归零"
                    : "原始数值精度超出现有导入范围，原件数值仍保留"}
                </p>
              ))}
            </div>
          )}
          {receipt?.applySupported &&
            receipt.previewId &&
            receipt.comparison &&
            !pending && (
              <div className="form-grid">
                <p>
                  确认后将由该账单接管此账户的期末持仓快照。原始流水单独保留，不重复累加持仓或现金；不会自动归并未绑定记录。
                </p>
                <label>
                  确认账单外部账户编号（{statement.externalAccount}）
                  <input
                    value={confirmExternal}
                    maxLength={40}
                    disabled={busy}
                    autoComplete="off"
                    onChange={(e) => setConfirmExternal(e.target.value)}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={takeOver}
                    disabled={busy}
                    onChange={(e) => setTakeOver(e.target.checked)}
                  />
                  确认接管当前账户持仓
                </label>
                {receipt.comparison.requiresUnassignedAcknowledgement && (
                  <label>
                    <input
                      type="checkbox"
                      checked={acknowledge}
                      disabled={busy}
                      onChange={(e) => setAcknowledge(e.target.checked)}
                    />
                    已单独核对同证券未绑定记录，接受保持各自独立
                  </label>
                )}
                <button
                  disabled={
                    busy ||
                    !takeOver ||
                    confirmExternal !== statement.externalAccount ||
                    receipt.comparison.blockers.length > 0 ||
                    (receipt.comparison.requiresUnassignedAcknowledgement &&
                      !acknowledge)
                  }
                  onClick={() => void run("import")}
                >
                  确认导入账单
                </button>
              </div>
            )}
          {statement.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}
    </section>
  );
}
