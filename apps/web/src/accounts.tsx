import {AccountSyncStatus} from "./account-sync-status";
import { AccountActionRecords } from "./account-action-history";
import { closedAccountReceipt } from "./account-action-state";
import { AdminCredentialRecovery } from "./admin-credential-recovery";
import {
  recoveryCommand,
  removalReceipt,
  recoveryReceipt,
  recoveryLabel,
  retainRecoveryId,
  releaseRecoveryId,
  type RecoveryAction,
  type RecoveryTarget,
  type RecoverySecrets,
  type RecoveryReceipt,
} from "./admin-credential-state";
import { apiSessionSnapshot, isCurrentApiSession } from "./api-session";
import { Pencil, KeyRound, Fingerprint } from "lucide-react";
import { EmailChange } from "./email-change";
import { AccountDevices } from "./account-devices";
import { AccountRemoval } from "./account-removal";
import { useLocation, useNavigate } from "react-router-dom";
import { AvatarStatusDot } from "./avatar-status";
import "./users.css";
import { requestId as newRequestId } from "./request-id";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { Session } from "./api";
import { useResource } from "./hooks";
import { Dialog } from "./dialog";
import { PasswordField, PasswordStrength } from "./password-fields";
import { NativeSecurity } from "./native-security";
import { SelectMenu } from "./select-menu";
import { passwordChangeGate, type PasswordChangePhase } from "./password-change-state";

type User = {
  id: string;
  username: string;
  role: "admin" | "user";
  active: boolean;
  revision: string;
  created_at: string;
  display_name?: string;
  uid?: string | null;
  is_test?: boolean;
  avatar_revision?: string | null;
  records_count?: number | null;
  email?: string;
  two_factor_enabled?: boolean;
};
type Change = { request_id: string; user: User; changed: boolean };
function Failure({ text }: { text: string }) {
  return text ? (
    <div className="notice error" role="alert">
      {text}
    </div>
  ) : null;
}

export function AccountPage({ session }: { session: Session }) {
  const resource = useResource<User>("/account");
  const location = useLocation();
  const [factorCode, setFactorCode] = useState("");
  const [current, setCurrent] = useState(""),
    [next, setNext] = useState(""),
    [confirm, setConfirm] = useState(""),
    [error, setError] = useState("");
  const gate = useRef(passwordChangeGate()),
    operation = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<PasswordChangePhase>("idle");
  const busy = phase === "sending",
    unknown = phase === "unknown";
  function clearProof() {
    setCurrent("");
    setNext("");
    setConfirm("");
    setFactorCode("");
  }
  function interrupt() {
    gate.current.interrupt();
    operation.current?.abort();
    operation.current = null;
    clearProof();
    setPhase(gate.current.phase());
  }
  useEffect(() => {
    const hide = () => {
      if (document.hidden) interrupt();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      gate.current.interrupt();
      operation.current?.abort();
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  useEffect(() => {
    interrupt();
  }, [location.pathname]);
  useEffect(() => {
    if (!resource.data && resource.error) interrupt();
  }, [resource.data, resource.error]);
  async function password(e: React.FormEvent) {
    e.preventDefault();
    if (
      busy ||
      unknown ||
      document.hidden ||
      apiSessionSnapshot().csrf !== session.csrf
    )
      return;
    setError("");
    if (next !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    const ticket = gate.current.begin();
    if (ticket === null) return;
    const controller = new AbortController();
    operation.current = controller;
    const body = JSON.stringify({
      current_password: current,
      code: factorCode,
      new_password: next,
    });
    clearProof();
    setPhase(gate.current.phase());
    try {
      await api(
        "/account/password",
        { method: "POST", body, signal: controller.signal },
        session.csrf,
      );
      if (apiSessionSnapshot().csrf !== session.csrf) {
        gate.current.interrupt();
        return;
      }
      if (gate.current.settle(ticket, true))
        window.dispatchEvent(
          new CustomEvent("alcor:session-expired", {
            detail: { message: "密码已修改，请重新登录" },
          }),
        );
    } catch (cause) {
      if (
        !gate.current.settle(
          ticket,
          false,
          cause instanceof ApiError ? cause : undefined,
        )
      )
        return;
      if (gate.current.phase() !== "unknown")
        setError(cause instanceof Error ? cause.message : "修改失败");
      if (cause instanceof ApiError && [401, 403].includes(cause.status))
        resource.reload();
    } finally {
      if (operation.current === controller) operation.current = null;
      setPhase(gate.current.phase());
    }
  }
  async function checkPassword() {
    if (
      !unknown ||
      operation.current ||
      apiSessionSnapshot().csrf !== session.csrf
    )
      return;
    const snapshot = apiSessionSnapshot();
    const controller = new AbortController();
    operation.current = controller;
    try {
      await api(
        "/session/logout",
        { method: "POST", signal: controller.signal },
        session.csrf,
      );
    } catch {
      /* No assumption about the unknown password mutation or the logout result. */
    } finally {
      operation.current = null;
      clearProof();
      if (isCurrentApiSession(snapshot))
        window.dispatchEvent(
          new CustomEvent("alcor:session-expired", {
            detail: { message: "修改结果未确认，请用新密码重新登录核对" },
          }),
        );
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>账号与安全</h1>
      </div>
      <Failure text={resource.error} />
      {resource.data && (
        <>
          <NativeSecurity session={session} />
          <section className="card padded settings-section">
            <h2>账号</h2>
            <dl className="settings-list">
              <div>
                <dt>用户名</dt>
                <dd>{resource.data.username}</dd>
              </div>
              <div>
                <dt>角色</dt>
                <dd>{resource.data.role === "admin" ? "管理员" : "用户"}</dd>
              </div>
              <div>
                <dt>注册时间</dt>
                <dd>
                  {new Date(resource.data.created_at).toLocaleString("zh-CN")}
                </dd>
              </div>
            </dl>
          </section>
          <EmailChange session={session} onChanged={resource.reload} />
          <AccountSyncStatus session={session} active={location.pathname==="/account"}/>
          <div id="account-owned-devices"><AccountDevices session={session}/></div>
          <section className="card padded settings-section">
            <h2>修改密码</h2>
            <form
              className="account-password-form"
              onSubmit={(e) => void password(e)}
            >
              <label htmlFor="account-current-password">当前密码</label>
              <PasswordField
                id="account-current-password"
                value={current}
                disabled={busy || unknown}
                autoComplete="current-password"
                maxLength={128}
                required
                onChange={(e) => {
                  setCurrent(e.target.value);
                  setError("");
                }}
              />
              <label htmlFor="account-new-password">新密码</label>
              <PasswordField
                id="account-new-password"
                value={next}
                disabled={busy || unknown}
                autoComplete="new-password"
                maxLength={128}
                required
                onChange={(e) => {
                  setNext(e.target.value);
                  setError("");
                }}
              />
              {next && (
                <PasswordStrength
                  password={next}
                  username={session.user.username}
                />
              )}
              <label htmlFor="confirm-password">确认密码</label>
              <PasswordField
                id="confirm-password"
                value={confirm}
                disabled={busy || unknown}
                autoComplete="new-password"
                maxLength={128}
                required
                onChange={(e) => {
                  setConfirm(e.target.value);
                  setError("");
                }}
              />
              {resource.data.two_factor_enabled && (
                <>
                  <label htmlFor="account-factor-code">验证码或备用码</label>
                  <input
                    id="account-factor-code"
                    value={factorCode}
                    onChange={(e) => setFactorCode(e.target.value)}
                    autoComplete="one-time-code"
                    maxLength={32}
                    required
                    disabled={busy || unknown}
                  />
                </>
              )}
              <Failure text={error} />
              {unknown && (
                <>
                  <p role="alert">修改结果未确认，请用新密码重新登录核对。</p>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => void checkPassword()}
                  >
                    重新登录核对
                  </button>
                </>
              )}
              <button
                className="button primary"
                disabled={busy || unknown || !current || !next || !confirm}
              >
                {busy ? "修改中…" : "修改密码"}
              </button>
            </form>
          </section>
        </>
      )}
    </>
  );
}

export function UsersPage({ session }: { session: Session }) {
  return (
    <UsersSession
      key={JSON.stringify([
        session.instance_id,
        session.user.id,
        session.user.role,
        session.receipt_scope,
        session.csrf,
        session.expires_at,
      ])}
      session={session}
    />
  );
}
function UsersSession({ session }: { session: Session }) {
  const navigate = useNavigate();
  const [q, setQ] = useState(""),
    [cursor, setCursor] = useState(""),
    [history, setHistory] = useState<string[]>([]);
  const resource = useResource<{ items: User[]; next_cursor: string | null }>(
    `/users?q=${encodeURIComponent(q)}${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
  );
  const initialProfile = useRef<{
    username: string;
    email?: string;
    role: User["role"];
    active: boolean;
  } | null>(null);
  const [draft, setDraft] = useState<User | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [controlPassword, setControlPassword] = useState(""),
    [controlCode, setControlCode] = useState("");
  const needsControl =
    !!draft &&
    (draft.role !== initialProfile.current?.role ||
      draft.active !== initialProfile.current?.active);
  useEffect(() => {
    setControlPassword("");
    setControlCode("");
  }, [draft?.id, needsControl]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        setControlPassword("");
        setControlCode("");
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  const storageKey = `alcor.account-action.${session.instance_id}.${session.user.id}`;
  const [recoveryNotice, setRecoveryNotice] = useState("");
  const recoveryOriginal = useRef<{
    id: string;
    target: string;
    revision: string;
    action: RecoveryAction;
  } | null>(null);
  const displayed = () => apiSessionSnapshot().csrf === session.csrf;
  const [uncertain, setUncertain] = useState<string | null>(() => {
    try {
      const id = sessionStorage.getItem(storageKey);
      return id && /^[a-f0-9-]{36}$/.test(id) ? id : null;
    } catch {
      return null;
    }
  });
  useEffect(
    () => () => {
      setDraft(null);
    },
    [],
  );
  useEffect(() => {
    if (!resource.data && resource.error) {
      setDraft(null);
    }
  }, [resource.data, resource.error]);
  function forget(id: string) {
    recoveryOriginal.current = null;
    setUncertain(null);
    try {
      releaseRecoveryId(sessionStorage, storageKey, id);
    } catch {}
  }
  function accept(result: Change | RecoveryReceipt) {
    if (!displayed()) return;
    try {
      const pending = sessionStorage.getItem(storageKey);
      if (pending && pending !== result.request_id) return;
    } catch {}
    if ("target_id" in result) {
      forget(result.request_id);
      setDraft(null);
      resource.reload();
      setRecoveryNotice(recoveryLabel(result));
      if (result.target_id === session.user.id)
        window.dispatchEvent(
          new CustomEvent("alcor:session-expired", {
            detail: { message: "登录凭据已更新，请重新登录" },
          }),
        );
      return;
    }
    forget(result.request_id);
    setDraft(null);
    resource.reload();
    if (result.changed && result.user.id === session.user.id)
      window.dispatchEvent(
        new CustomEvent("alcor:session-expired", {
          detail: { message: "账号状态已更新，请重新登录" },
        }),
      );
  }
  async function recover(closeOriginal = false, originalId = uncertain) {
    if (!originalId || busy) return;
    if (originalId !== uncertain) {
      try {
        retainRecoveryId(sessionStorage, storageKey, originalId);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "原账号操作待核对");
        return;
      }
      recoveryOriginal.current = null;
      setDraft(null);
      setUncertain(originalId);
    }
    setBusy(true);
    setError("");
    try {
      const result = await api<unknown>(
        "/users/receipts/" + originalId + (closeOriginal ? "/close" : ""),
        closeOriginal
          ? {
              method: "POST",
              body: JSON.stringify({ expected_kind: "account-action" }),
            }
          : {},
        closeOriginal ? session.csrf : undefined,
      );
      if (!displayed()) return;
      if (!result || typeof result !== "object" || Array.isArray(result))
        throw Error("账号操作回执待核对");
      if ("closed" in result) {
        const value = closedAccountReceipt(result, originalId);
        forget(value.request_id);
        setDraft(null);
        setRecoveryNotice("原账号操作已关闭，未执行");
        resource.reload();
      } else if ("target_id" in result || "ok" in result)
        accept(
          recoveryReceipt(
            result,
            originalId,
            recoveryOriginal.current?.target,
            recoveryOriginal.current ?? undefined,
          ),
        );
      else if ("deleted" in result) {
        const value = removalReceipt(result, originalId);
        forget(value.request_id);
        setRecoveryNotice("账号已删除");
        resource.reload();
      } else {
        const value = result as Change;
        if (
          value.request_id !== originalId ||
          !value.user?.id ||
          typeof value.changed !== "boolean"
        )
          throw Error("账号操作回执与原编号不符");
        accept(value);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "回执读取失败");
      if (e instanceof ApiError && [401, 403].includes(e.status)) {
        setDraft(null);
        resource.reload();
      }
    } finally {
      setBusy(false);
    }
  }
  async function send(id: string, body: string) {
    setBusy(true);
    setError("");
    try {
      accept(
        await api<Change>(
          "/users/" + encodeURIComponent(id),
          { method: "PATCH", body },
          session.csrf,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新失败");
      if (
        e instanceof ApiError &&
        [400, 401, 403, 409, 422, 429].includes(e.status)
      )
        forget(JSON.parse(body).request_id);
      if (e instanceof ApiError && [401, 403].includes(e.status)) {
        setDraft(null);
        resource.reload();
      }
    } finally {
      body = "";
      setBusy(false);
    }
  }
  async function recoverCredentials(
    action: RecoveryAction,
    target: RecoveryTarget,
    secrets: RecoverySecrets,
  ) {
    if (
      !displayed() ||
      busy ||
      uncertain ||
      recoveryOriginal.current ||
      !draft ||
      draft.id !== target.id ||
      draft.revision !== target.revision
    )
      return;
    const id = newRequestId();
    let body: string;
    try {
      body = JSON.stringify(recoveryCommand(action, target, secrets, id));
      retainRecoveryId(sessionStorage, storageKey, id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "恢复操作未提交");
      return;
    }
    recoveryOriginal.current = {
      id,
      target: target.id,
      revision: target.revision,
      action,
    };
    setUncertain(id);
    setBusy(true);
    setError("");
    setRecoveryNotice("");
    try {
      const result = await api<unknown>(
        "/users/" + encodeURIComponent(target.id) + "/" + action,
        { method: "POST", body },
        session.csrf,
        30000,
      );
      if (displayed())
        accept(
          recoveryReceipt(result, id, target.id, {
            action,
            revision: target.revision,
          }),
        );
    } catch (reason) {
      if (!displayed()) {
        setDraft(null);
        setRecoveryNotice("");
        return;
      }
      setError(reason instanceof Error ? reason.message : "恢复操作结果待核对");
      if (
        reason instanceof ApiError &&
        reason.code !== "session_changed" &&
        [400, 401, 403, 404, 405, 409, 413, 415, 422, 429].includes(
          reason.status,
        )
      ) {
        releaseRecoveryId(sessionStorage, storageKey, id);
        forget(id);
      }
      if (
        reason instanceof ApiError &&
        ([401, 403].includes(reason.status) ||
          reason.code === "session_changed")
      ) {
        setDraft(null);
        setRecoveryNotice("");
        resource.reload();
      }
    } finally {
      body = "";
      if (displayed()) setBusy(false);
    }
  }
  function save() {
    if (
      !draft ||
      busy ||
      uncertain ||
      recoveryOriginal.current ||
      (needsControl && !controlPassword)
    )
      return;
    setRecoveryNotice("");
    const request_id = newRequestId();
    const body = JSON.stringify({
      request_id,
      revision: draft.revision,
      active: draft.active,
      role: draft.role,
      ...(draft.username !== initialProfile.current?.username
        ? { username: draft.username }
        : {}),
      ...(typeof draft.email === "string" &&
      draft.email !== initialProfile.current?.email
        ? { email: draft.email }
        : {}),
      ...(needsControl
        ? { current_password: controlPassword, code: controlCode }
        : {}),
    });
    setControlPassword("");
    setControlCode("");
    try {
      retainRecoveryId(sessionStorage, storageKey, request_id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作编号无法保存");
      return;
    }
    setUncertain(request_id);
    void send(draft.id, body);
  }
  return (
    <>
      <div className="page-heading">
        <h1>账号管理</h1>
        <AccountActionRecords
          disabled={busy || !!uncertain}
          onSelect={(id) => void recover(false, id)}
        />
        <button className="text-button" onClick={resource.reload}>
          刷新
        </button>
      </div>
      <div className="input-search">
        <input
          aria-label="搜索账号"
          placeholder="搜索账号"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setCursor("");
            setHistory([]);
          }}
          maxLength={80}
        />
      </div>
      <Failure text={resource.error || (!draft ? error : "")} />
      {recoveryNotice && !resource.error && (
        <p className="connection-result" role="status">
          {recoveryNotice}
        </p>
      )}
      {uncertain && !busy && (
        <div className="connection-result">
          <span>结果待核对 · {uncertain}</span>
          <button className="text-button" onClick={() => void recover()}>
            核对原请求
          </button>
          <button className="text-button" onClick={() => void recover(true)}>
            关闭原请求
          </button>
        </div>
      )}
      {resource.data && (
        <>
          <div className="users-table-shell">
            <div className="table-scroll">
              <table className="users-table">
                <colgroup>
                  <col className="user-name-col" />
                  <col className="user-email-col" />
                  <col className="user-role-col" />
                  <col className="user-date-col" />
                  <col className="user-count-col" />
                  <col className="user-actions-col" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">用户</th>
                    <th scope="col">邮箱</th>
                    <th scope="col">权限</th>
                    <th scope="col">注册时间</th>
                    <th scope="col" className="user-numeric">
                      记录
                    </th>
                    <th scope="col" className="user-numeric">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {resource.data.items.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <div className="directory-identity">
                          <span className="directory-avatar avatar-status-wrap">
                            {(user.display_name || user.username)
                              .slice(0, 1)
                              .toUpperCase()}
                            {user.avatar_revision && (
                              <img
                                src={`/api/users/${encodeURIComponent(user.id)}/avatar?revision=${encodeURIComponent(user.avatar_revision)}`}
                                alt=""
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                }}
                              />
                            )}
                            {user.id === session.user.id && <AvatarStatusDot />}
                          </span>
                          <div className="directory-name">
                            <div className="directory-name-line">
                              <strong>
                                {user.display_name || user.username}
                              </strong>
                              {user.id === session.user.id && (
                                <span className="user-tag current">当前</span>
                              )}
                              {user.two_factor_enabled && (
                                <span className="user-tag">二次验证</span>
                              )}
                              {!user.active && (
                                <span className="user-tag inactive">
                                  已停用
                                </span>
                              )}
                            </div>
                            <span
                              className="directory-handle"
                              title={user.uid || user.id}
                            >
                              @{user.username} <span>·</span>{" "}
                              {user.is_test
                                ? "测试账号"
                                : `UID ${user.uid || "—"}`}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td data-label="邮箱" className="directory-email">
                        {user.email === undefined
                          ? "—"
                          : user.email || "未绑定"}
                      </td>
                      <td data-label="权限">
                        <span className={`user-role ${user.role}`}>
                          {user.role === "admin" ? "管理员" : "普通用户"}
                        </span>
                      </td>
                      <td data-label="注册时间" className="directory-date">
                        {new Intl.DateTimeFormat("zh-CN", {
                          timeZone: "Asia/Shanghai",
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          hourCycle: "h23",
                        }).format(new Date(user.created_at))}
                      </td>
                      <td
                        data-label="记录"
                        className="user-numeric directory-records"
                      >
                        {user.records_count ?? "—"}
                      </td>
                      <td className="user-numeric">
                        <div className="directory-actions">
                          <button
                            className="user-action"
                            aria-label={`管理 ${user.username}`}
                            title="管理账号"
                            disabled={busy || !!uncertain}
                            onClick={() => {
                              initialProfile.current = {
                                username: user.username,
                                email: user.email,
                                role: user.role,
                                active: user.active,
                              };
                              setDraft({ ...user });
                              setError("");
                              setRecoveryNotice("");
                            }}
                          >
                            <Pencil size={17} />
                          </button>
                          {user.id === session.user.id && (
                            <>
                              <button
                                className="user-action"
                                aria-label="修改本人密码"
                                title="修改密码"
                                onClick={() => navigate("/account")}
                              >
                                <KeyRound size={17} />
                              </button>
                              <button
                                className="user-action"
                                aria-label="管理本人二次验证"
                                title="二次验证"
                                onClick={() => navigate("/account")}
                              >
                                <Fingerprint size={17} />
                              </button>
                            </>
                          )}
                          <AccountRemoval
                            session={session}
                            target={user}
                            disabled={busy || !!uncertain}
                            onPending={setUncertain}
                            onDone={resource.reload}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!resource.data.items.length && (
              <div className="empty">
                <h3>没有符合条件的账号</h3>
              </div>
            )}
          </div>
          <div className="pagination">
            <span>每页最多20条</span>
            <div>
              <button
                className="button secondary small"
                disabled={!history.length}
                onClick={() => {
                  setCursor(history.at(-1) || "");
                  setHistory(history.slice(0, -1));
                }}
              >
                上一页
              </button>
              <button
                className="button secondary small"
                disabled={!resource.data.next_cursor}
                onClick={() => {
                  setHistory([...history, cursor]);
                  setCursor(resource.data?.next_cursor || "");
                }}
              >
                下一页
              </button>
            </div>
          </div>
        </>
      )}
      {draft && (
        <Dialog
          title="管理账号"
          onClose={() => {
            if (!busy) setDraft(null);
          }}
        >
          <div className="dialog-content access-form">
            <label>
              用户名
              <input
                value={draft.username}
                maxLength={20}
                disabled={busy || !!uncertain}
                autoComplete="off"
                onChange={(event) =>
                  setDraft({ ...draft, username: event.target.value })
                }
              />
            </label>
            {typeof draft.email === "string" && (
              <label>
                邮箱
                <input
                  type="email"
                  value={draft.email}
                  maxLength={254}
                  disabled={busy || !!uncertain}
                  autoComplete="off"
                  onChange={(event) =>
                    setDraft({ ...draft, email: event.target.value })
                  }
                />
              </label>
            )}
            <SelectMenu
              label="角色"
              value={draft.role}
              variant="field"
              disabled={busy || !!uncertain}
              options={[
                { value: "user", label: "用户" },
                { value: "admin", label: "管理员" },
              ]}
              onChange={(value) =>
                setDraft({ ...draft, role: value as User["role"] })
              }
            />
            <label className="access-check">
              <input
                type="checkbox"
                checked={draft.active}
                disabled={busy || !!uncertain}
                onChange={(e) =>
                  setDraft({ ...draft, active: e.target.checked })
                }
              />
              启用账号
            </label>
            <p className="muted">
              更改登录信息、角色或启用状态后，该账号已有会话与客户端授权将失效。
            </p>
            {needsControl && (
              <>
                <label htmlFor="managed-account-password">当前管理员密码</label>
                <PasswordField
                  id="managed-account-password"
                  value={controlPassword}
                  onChange={(e) => setControlPassword(e.target.value)}
                  disabled={busy || !!uncertain}
                  autoComplete="current-password"
                />
                <label>
                  验证码或备用码
                  <input
                    value={controlCode}
                    onChange={(e) => setControlCode(e.target.value)}
                    maxLength={64}
                    disabled={busy || !!uncertain}
                    autoComplete="one-time-code"
                  />
                </label>
              </>
            )}
            <AdminCredentialRecovery
              target={{
                id: draft.id,
                revision: draft.revision,
                username: initialProfile.current?.username ?? draft.username,
                two_factor_enabled: draft.two_factor_enabled,
              }}
              disabled={busy || !!uncertain}
              onSubmit={(action, target, secrets) =>
                void recoverCredentials(action, target, secrets)
              }
            />
            <Failure text={error} />
            {error && !uncertain && (
              <button
                className="text-button"
                onClick={() => {
                  setDraft(null);
                  resource.reload();
                }}
              >
                重新读取
              </button>
            )}
            <div className="dialog-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                取消
              </button>
              <button
                className="button primary"
                disabled={
                  busy || !!uncertain || (needsControl && !controlPassword)
                }
                onClick={save}
              >
                {busy ? "保存中…" : "确认保存"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
