import { LoadingPlaceholder } from "./loading-placeholder";
import { requestId as newRequestId } from "./request-id";
import { useEffect, useRef, useState } from "react";
import { RefreshCw, Save, Zap } from "lucide-react";
import { api, ApiError } from "./api";
import type {
  ConnectionConfig,
  ConnectionReceipt,
  ConnectionSettings,
  Session,
} from "./api";
import { PasswordField } from "./password-fields";
import { useConnectionInvalidation, useResource } from "./hooks";
import { connectionResultView, emptyConnectionConfig } from "./connection-view";
import { SelectMenu } from "./select-menu";
import { ConnectionVerification } from "./connection-verification";

export function ConnectionSettingsForm({
  kind,
  session,
}: {
  kind: "postgresql" | "redis";
  session: Session;
}) {
  const path = "/connections/" + kind;
  const resource = useResource<ConnectionSettings>(path, true);
  const invalidateOverview = useConnectionInvalidation();
  const [config, setConfig] = useState<ConnectionConfig | null>(null),
    [revision, setRevision] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false),
    [password, setPassword] = useState("");
  const [denied, setDenied] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(false),
    [needsVerification, setNeedsVerification] = useState(false);
  const verificationRetry = useRef<{
    operation: "test" | "save";
    generation: number;
  } | null>(null);
  const [passwordMode, setPasswordMode] = useState<
    "keep" | "replace" | "clear"
  >("keep");
  const [busy, setBusy] = useState<"test" | "save" | "check" | null>(null);
  const [result, setResult] = useState<
      (ConnectionReceipt & { currentDraft: boolean }) | null
    >(null),
    [error, setError] = useState("");
  const [uncertain, setUncertain] = useState<string | null>(null),
    [conflict, setConflict] = useState(false);
  const generation = useRef(0),
    alive = useRef(true),
    form = useRef<HTMLFormElement>(null);
  const retry = useRef<{
    operation: "test" | "save";
    body: string;
    generation: number;
  } | null>(null);
  // Never persist passwords or an editable payload. The UUID alone can recover an uncertain receipt.
  const storageKey = `alcor.connection.${session.instance_id}.${session.user.id}.${kind}`;
  useEffect(() => {
    alive.current = true;
    try {
      const id = sessionStorage.getItem(storageKey);
      if (id) setUncertain(id);
    } catch {
      /* Memory-only recovery is still available. */
    }
    return () => {
      alive.current = false;
      retry.current = null;
      setBusy(null);
      setResult(null);
      setPassword("");
      setPasswordMode("keep");
      setVerificationOpen(false);
      verificationRetry.current = null;
      generation.current++;
    };
  }, [storageKey]);
  useEffect(() => {
    if (resource.data && !resource.error) setDenied(false);
  }, [resource.data, resource.error]);
  useEffect(() => {
    if (!resource.data && resource.error) {
      setConfig(null);
      setPassword("");
      setPasswordMode("keep");
      setResult(null);
      setDirty(false);
      retry.current = null;
      generation.current++;
    }
  }, [resource.data, resource.error]);
  useEffect(() => {
    if (
      resource.data &&
      !resource.refreshing &&
      !resource.error &&
      !dirty &&
      !denied
    ) {
      setConfig(
        resource.data.revision && resource.data.config
          ? resource.data.config
          : emptyConnectionConfig(kind),
      );
      setRevision(resource.data.revision);
    }
  }, [resource.data, resource.refreshing, resource.error, dirty, denied, kind]);
  function edit(key: string, value: string | number | boolean) {
    setConfig((old) =>
      old ? ({ ...old, [key]: value } as ConnectionConfig) : old,
    );
    setDirty(true);
    setResult(null);
    setError("");
    generation.current++;
  }
  function forget() {
    setUncertain(null);
    retry.current = null;
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* Storage can be unavailable. */
    }
  }
  function withdraw(e: unknown, operation?: "test" | "save") {
    if (
      alive.current &&
      e instanceof ApiError &&
      (e.code === "reauth_required" ||
        (e.status === 403 && e.message === "请重新登录后修改连接设置"))
    ) {
      setNeedsVerification(true);
      setVerificationOpen(true);
      setError(e.message);
      verificationRetry.current = operation
        ? { operation, generation: generation.current }
        : null;
      return;
    }
    if (
      alive.current &&
      e instanceof ApiError &&
      (e.status === 401 || e.status === 403)
    ) {
      setDenied(true);
      setDirty(false);

      setConfig(null);
      setPassword("");
      setPasswordMode("keep");
      setResult(null);
      setError(e.message);
      retry.current = null;
      generation.current++;
      resource.reload();
    }
  }
  function acceptReceipt(
    receipt: ConnectionReceipt,
    requestGeneration?: number,
  ) {
    const currentDraft = requestGeneration === generation.current;
    setResult({ ...receipt, currentDraft });
    forget();
    if (
      receipt.operation === "save" &&
      (receipt.status === "saved" || receipt.status === "pending")
    ) {
      invalidateOverview();
      // A recovered older request must never reset a newer editable draft or its password.
      if (currentDraft) {
        setDirty(false);
        setPassword("");
        setPasswordMode("keep");
      }
    }
    resource.reload();
  }
  async function recover() {
    if (!uncertain) return;
    const requestGeneration = retry.current?.generation;
    setBusy("check");
    setError("");
    try {
      const receipt = await api<ConnectionReceipt>(
        `${path}/receipts/${uncertain}`,
      );
      if (!alive.current) return;
      acceptReceipt(receipt, requestGeneration);
    } catch (e) {
      withdraw(e);
      if (alive.current)
        setError(e instanceof Error ? e.message : "回执读取失败");
    } finally {
      if (alive.current) setBusy(null);
    }
  }
  async function submit(operation: "test" | "save") {
    if (!config || !form.current || busy) return;
    if (operation === "save" && uncertain) {
      await recover();
      return;
    }
    // Native validation must be able to focus fields inside a collapsed details group.
    for (const input of form.current.querySelectorAll<HTMLInputElement>(
      "input:invalid",
    )) {
      let details = input.closest("details");
      while (details) {
        details.open = true;
        details = details.parentElement?.closest("details") || null;
      }
    }
    if (!form.current.reportValidity()) return;

    const version = generation.current,
      requestId = newRequestId();
    const data = {
      request_id: requestId,
      revision,
      config,
      password_mode: passwordMode,
      ...(passwordMode === "replace" ? { password } : {}),
    };
    // A read-only test can proceed without replacing an unresolved save receipt.
    if (operation === "test" && uncertain) {
      setBusy("test");
      setError("");
      setResult(null);
      try {
        const receipt = await api<ConnectionReceipt>(
          path + "/test",
          { method: "POST", body: JSON.stringify(data) },
          session.csrf,
        );
        if (alive.current && version === generation.current) {
          setResult({ ...receipt, currentDraft: true });
        }
      } catch (e) {
        withdraw(e, operation);
        if (alive.current && version === generation.current)
          setError(e instanceof Error ? e.message : "连接测试失败");
      } finally {
        if (alive.current) setBusy(null);
      }
      return;
    }
    retry.current = {
      operation,
      body: JSON.stringify(data),
      generation: version,
    };
    setBusy(operation);
    setError("");
    setResult(null);
    setConflict(false);
    // Persist UUID before dispatch, including when a refresh interrupts a request.
    try {
      sessionStorage.setItem(storageKey, requestId);
    } catch {
      /* Keep the UUID in memory. */
    }
    setUncertain(requestId);
    try {
      const receipt = await api<ConnectionReceipt>(
        operation === "test" ? path + "/test" : path,
        {
          method: operation === "test" ? "POST" : "PUT",
          body: JSON.stringify(data),
        },
        session.csrf,
      );
      if (!alive.current) return;
      // A normal late test stays silent; recovery explicitly identifies historical results.
      if (version === generation.current) acceptReceipt(receipt, version);
      else {
        forget();
        if (receipt.operation === "save" && receipt.status !== "failed") {
          invalidateOverview();
          resource.reload();
        }
      }
    } catch (e) {
      withdraw(e, operation);
      if (!alive.current) return;
      if (
        e instanceof ApiError &&
        [400, 401, 403, 409, 422, 429].includes(e.status)
      )
        forget();
      setConflict(e instanceof ApiError && e.status === 409);
      if (version === generation.current)
        setError(e instanceof Error ? e.message : "请求失败");
    } finally {
      if (alive.current) setBusy(null);
    }
  }
  function field(
    label: string,
    key: string,
    type = "text",
    min?: number,
    max?: number,
  ) {
    if (!config) return null;
    const value = (config as unknown as Record<string, string | number>)[key];
    const socketPort =
      config.kind === "redis" && config.host.startsWith("/") && key === "port";
    return (
      <label className="connection-field">
        {label}
        <input
          type={type}
          value={socketPort ? "" : (value ?? "")}
          placeholder={socketPort ? "—" : undefined}
          min={min}
          max={max}
          required={type === "number" || key === "host" || key === "database"}
          maxLength={type === "text" ? (key === "host" ? 253 : 128) : undefined}
          name={key}
          disabled={socketPort || busy === "save"}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) =>
            edit(
              key,
              type === "number"
                ? e.target.value === ""
                  ? ""
                  : Number(e.target.value)
                : e.target.value,
            )
          }
        />
      </label>
    );
  }
  if (!config || denied || (!resource.data && !!resource.error))
    return (
      <div
        className="connection-form-loading"
        role={resource.error ? "alert" : "status"}
      >
        {resource.error || error || <LoadingPlaceholder compact />}
        {(resource.error || error) && (
          <button className="text-button" onClick={resource.reload}>
            重新读取
          </button>
        )}
      </div>
    );
  // An unresolved receipt blocks another submission, never preparation of a newer draft.
  const disabled = busy === "save";
  const passwordSet = Boolean(
    resource.data?.revision && resource.data.password_set,
  );
  const effective = resource.data?.revision ? resource.data.effective : null;
  const presentation = result
    ? connectionResultView(
        result,
        result.currentDraft,
        resource.error ? null : resource.data,
      )
    : null;
  return (
    <>
      <form
        ref={form}
        className="connection-settings-form"
        autoComplete="off"
        noValidate
        aria-busy={!!busy}
        onSubmit={(e) => {
          e.preventDefault();
          void submit("save");
        }}
      >
        <div className="connection-form-grid">
          {field(
            kind === "postgresql" ? "数据库地址（Host）" : "缓存地址（Host）",
            "host",
          )}
          {field("端口（Port）", "port", "number", 1, 65535)}
          {field(
            kind === "postgresql" ? "用户名（User）" : "用户名（ACL User）",
            "username",
          )}
          <label className="connection-field">
            <span id={`connection-password-label-${kind}`}>
              密码（Password）
            </span>
            <PasswordField
              key={revision || "initial"}
              id={`connection-password-${kind}`}
              aria-labelledby={`connection-password-label-${kind}`}
              value={password}
              maxLength={1024}
              disabled={disabled}
              autoComplete="new-password"
              placeholder={
                passwordMode === "clear"
                  ? "将清除密码"
                  : passwordSet
                    ? "已设置"
                    : ""
              }
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordMode(e.target.value ? "replace" : "keep");
                setDirty(true);
                setResult(null);
                setError("");
                generation.current++;
              }}
            />
            {passwordSet && (
              <button
                type="button"
                className="password-clear text-button"
                disabled={disabled}
                onClick={() => {
                  setPassword("");
                  setPasswordMode(passwordMode === "clear" ? "keep" : "clear");
                  setDirty(true);
                  setResult(null);
                  generation.current++;
                }}
              >
                {passwordMode === "clear" ? "保留原密码" : "清除密码"}
              </button>
            )}
          </label>
          {config.kind === "postgresql" ? (
            <>
              {field("数据库名（Database）", "database")}
              <div className="connection-field">
                <span>SSL 模式（SSL Mode）</span>
                <SelectMenu
                  label="SSL 模式（SSL Mode）"
                  value={config.ssl_mode}
                  disabled={disabled}
                  variant="field"
                  options={[
                    "disable",
                    "require",
                    "verify-ca",
                    "verify-full",
                  ].map((value) => ({ value, label: value }))}
                  onChange={(value) => edit("ssl_mode", value)}
                />
              </div>
            </>
          ) : (
            <>
              {field("数据库编号（Database）", "database", "number", 0, 15)}
              <div className="connection-field">
                <span>TLS</span>
                <SelectMenu
                  label="TLS"
                  value={String(config.tls)}
                  disabled={disabled}
                  variant="field"
                  options={[
                    { value: "false", label: "关闭" },
                    { value: "true", label: "启用" },
                  ]}
                  onChange={(value) => edit("tls", value === "true")}
                />
              </div>
            </>
          )}
        </div>
        <details className="connection-advanced">
          <summary>高级设置</summary>
          <div className="connection-form-grid">
            {field("连接超时（秒）", "connect_timeout", "number", 1, 5)}
            {config.kind === "postgresql" ? (
              <>
                {field("最大连接数", "pool_size", "number", 1, 20)}
                {field(
                  "最小保留连接数",
                  "pool_min_size",
                  "number",
                  0,
                  config.pool_size,
                )}
                {field(
                  "连接最大存活时间（秒）",
                  "max_lifetime",
                  "number",
                  60,
                  86400,
                )}
                {field(
                  "连接空闲回收时间（秒）",
                  "max_idle",
                  "number",
                  10,
                  3600,
                )}
              </>
            ) : (
              field("最大连接数", "max_connections", "number", 1, 50)
            )}
          </div>
        </details>
        {effective && (
          <details className="connection-advanced">
            <summary>当前连接</summary>
            <dl className="connection-effective">
              <div>
                <dt>地址</dt>
                <dd>{effective.host}</dd>
              </div>
              <div>
                <dt>端口</dt>
                <dd>
                  {effective.kind === "redis" && effective.host.startsWith("/")
                    ? "—"
                    : effective.port}
                </dd>
              </div>
              <div>
                <dt>账号</dt>
                <dd>{effective.username || "—"}</dd>
              </div>
              <div>
                <dt>数据库</dt>
                <dd>{effective.database}</dd>
              </div>
              {effective.kind === "postgresql" && (
                <div>
                  <dt>Schema（固定）</dt>
                  <dd>{effective.schema_name}</dd>
                </div>
              )}
            </dl>
          </details>
        )}
        {!result &&
          !dirty &&
          resource.data?.revision &&
          resource.data.state === "pending" && (
            <div className="connection-result" role="status">
              已保存，等待应用
            </div>
          )}
        {(error || resource.error) && (
          <div className="notice error" role="alert">
            {error || resource.error}
            {needsVerification && (
              <button
                type="button"
                className="text-button"
                onClick={() => setVerificationOpen(true)}
              >
                验证身份
              </button>
            )}
            {conflict && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setDirty(false);
                  setPassword("");
                  setPasswordMode("keep");
                  setError("");
                  setConflict(false);
                  resource.reload();
                }}
              >
                重新读取
              </button>
            )}
          </div>
        )}
        {presentation && (
          <div
            className={`connection-result ${presentation.tone}`}
            role="status"
          >
            {presentation.text}
          </div>
        )}
        <div className="connection-form-actions">
          <button
            type="button"
            className="button secondary"
            disabled={!!busy}
            onClick={() => void submit("test")}
          >
            {busy === "test" ? (
              <RefreshCw size={18} className="spin" />
            ) : (
              <Zap size={18} />
            )}
            {busy === "test" ? "测试中…" : "连接测试"}
          </button>
          <button type="submit" className="button primary" disabled={!!busy}>
            <Save size={18} />
            {busy === "save" ? "保存中…" : "保存设置"}
          </button>
        </div>
      </form>
      {verificationOpen && (
        <ConnectionVerification
          session={session}
          onClose={() => setVerificationOpen(false)}
          onVerified={() => {
            const pending = verificationRetry.current;
            verificationRetry.current = null;
            setVerificationOpen(false);
            setNeedsVerification(false);
            setError("");
            if (pending && pending.generation === generation.current)
              void submit(pending.operation);
          }}
        />
      )}
    </>
  );
}
