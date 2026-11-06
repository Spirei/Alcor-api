import { LoadingPlaceholder } from "./loading-placeholder";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api, ApiError } from "./api";
import type { Session } from "./api";
import { emailReadGate } from "./email-change-read";
import { PasswordField } from "./password-fields";
import { observeRecoveryPrivacy } from "./password-recovery-state";

type EmailState = {
  email: string;
  verified: boolean;
  twoFactorEnabled: boolean;
};

export function EmailChange({
  session,
  onChanged,
}: {
  session: Session;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<EmailState | null>(null);
  const [readError, setReadError] = useState("");
  const [loading, setLoading] = useState(false);
  const readGate = useRef(emailReadGate());
  const active = useRef(false);
  const reload = useCallback(async () => {
    if (!active.current || document.hidden) return;
    const ticket = readGate.current.begin();
    setData(null);
    setReadError("");
    setLoading(true);
    try {
      const next = await api<EmailState>("/account/email", {
        signal: ticket.signal,
        cache: "no-store",
      });
      if (ticket.current() && active.current) setData(next);
    } catch (failure) {
      if (ticket.current() && active.current)
        setReadError(failure instanceof Error ? failure.message : "读取失败");
    } finally {
      if (ticket.current() && active.current) setLoading(false);
    }
  }, []);
  const resource = {
    data,
    error: readError,
    reload: () => {
      void reload();
    },
  };
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const operation = useRef<{
    controller: AbortController;
    writing: boolean;
  } | null>(null);
  useEffect(() => {
    active.current = true;
    const clear = () => {
      readGate.current.invalidate();
      setData(null);
      setReadError("");
      setLoading(false);
      const pending = operation.current;
      pending?.controller.abort();
      operation.current = null;
      setPassword("");
      setCode("");
      setEmail("");
      setEditing(false);
      setBusy(false);
      setError("");
      setMessage(pending ? "操作结果未确认，请刷新核对。" : "");
    };
    const stop = observeRecoveryPrivacy(document, window, clear);
    const visible = () => {
      if (!document.hidden) void reload();
    };
    const expired = () => {
      active.current = false;
      clear();
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("alcor:session-expired", expired);
    clear();
    void reload();
    return () => {
      active.current = false;
      stop();
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("alcor:session-expired", expired);
      clear();
    };
  }, [session.csrf, reload]);
  useEffect(() => {
    if (resource.error && !resource.data) {
      operation.current?.controller.abort();
      operation.current = null;
      setPassword("");
      setCode("");
      setEmail("");
      setEditing(false);
      setBusy(false);
    }
  }, [resource.error, resource.data]);
  async function run(write: boolean) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = { controller, writing: write };
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (write) {
        await api<EmailState>(
          "/account/email",
          {
            method: "PUT",
            signal: controller.signal,
            body: JSON.stringify({
              email: email.trim(),
              currentPassword: password,
              code: code.trim(),
            }),
          },
          session.csrf,
        );
      } else {
        await api(
          "/account/email/verification",
          { method: "POST", signal: controller.signal },
          session.csrf,
        );
      }
      if (controller.signal.aborted) return;
      setPassword("");
      setCode("");
      setEditing(false);
      setMessage(write ? "邮箱已更新。" : "验证邮件已进入发送队列。");
      resource.reload();
      onChanged?.();
    } catch (failure) {
      if (controller.signal.aborted) return;
      setPassword("");
      setCode("");
      if (
        !(failure instanceof ApiError) ||
        failure.status >= 500 ||
        failure.status === 0
      ) {
        setEditing(false);
        setMessage("操作结果未确认，请刷新核对。");
        resource.reload();
      } else {
        setError(failure.message);
        if (failure.status === 401 || failure.status === 403) resource.reload();
      }
    } finally {
      if (!controller.signal.aborted) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void run(true);
  }
  return (
    <section className="card padded settings-section">
      <h2>邮箱</h2>
      {resource.error && (
        <p className="error" role="alert">
          {resource.error}
        </p>
      )}
      {loading && <LoadingPlaceholder label="正在读取" compact />}
      {!resource.data && !loading && (
        <button
          type="button"
          className="button secondary"
          onClick={resource.reload}
        >
          刷新
        </button>
      )}
      {resource.data && (
        <>
          <dl className="settings-list">
            <div>
              <dt>邮箱</dt>
              <dd>{resource.data.email || "未绑定"}</dd>
            </div>
            {resource.data.email && (
              <div>
                <dt>验证状态</dt>
                <dd>{resource.data.verified ? "已验证" : "未验证"}</dd>
              </div>
            )}
          </dl>
          {!editing ? (
            <div className="actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setEmail(resource.data!.email);
                  setMessage("");
                  setError("");
                  setEditing(true);
                }}
              >
                修改邮箱
              </button>
              {!!resource.data.email && !resource.data.verified && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void run(false)}
                >
                  发送验证邮件
                </button>
              )}
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={resource.reload}
              >
                刷新
              </button>
            </div>
          ) : (
            <form className="account-password-form" onSubmit={submit}>
              <label htmlFor="account-email">邮箱</label>
              <input
                id="account-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={254}
                autoComplete="email"
                disabled={busy}
              />
              <label htmlFor="email-current-password">当前密码</label>
              <PasswordField
                id="email-current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                maxLength={512}
                required
                disabled={busy}
              />
              {resource.data.twoFactorEnabled && (
                <>
                  <label htmlFor="email-factor">验证码或备用码</label>
                  <input
                    id="email-factor"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    autoComplete="one-time-code"
                    maxLength={64}
                    disabled={busy}
                  />
                </>
              )}
              <div className="actions">
                <button className="button primary" disabled={busy}>
                  {busy ? "正在保存…" : "保存"}
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    setEditing(false);
                    setPassword("");
                    setCode("");
                    setEmail("");
                    setError("");
                  }}
                >
                  取消
                </button>
              </div>
            </form>
          )}
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
