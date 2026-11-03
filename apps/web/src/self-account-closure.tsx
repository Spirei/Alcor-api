import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { Dialog } from "./dialog";
import { SelectMenu } from "./select-menu";
import { PasswordField } from "./password-fields";
import { removalReceipt } from "./admin-credential-state";
import {
  closureObservation,
  newClosurePending,
  readClosurePending,
  readClosurePendings,
  retainClosurePending,
  releaseClosurePending,
  sameClosureSession,
  sameClosureOwner,
  type ClosureObservation,
  type ClosurePending,
} from "./account-closure-state";
import { observeClosure } from "./account-closure-transport";

type Target = {
  id: string;
  username: string;
  revision: string;
  two_factor_enabled: boolean;
};
function loadPending(scope?: Pick<ClosurePending, "instanceId" | "userId">) {
  return readClosurePending(sessionStorage, scope);
}
function announce() {
  window.dispatchEvent(new Event("alcor:closure-pending"));
}
function statusText(value: ClosureObservation | null) {
  return value?.state === "completed"
    ? "账号已注销"
    : value?.state === "closed"
      ? "原请求已关闭，未执行注销"
      : value
        ? "原请求尚无终态回执"
        : "";
}
export function SelfAccountClosure({ session }: { session: Session }) {
  const [opened, setOpened] = useState(false),
    [target, setTarget] = useState<Target | null>(null);
  const [pending, setPending] = useState<ClosurePending | null>(null),
    [observed, setObserved] = useState<ClosureObservation | null>(null);
  const [password, setPassword] = useState(""),
    [code, setCode] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const location = useLocation();
  const generation = useRef(0),
    operation = useRef<AbortController | null>(null);
  const currentSession = () => apiSessionSnapshot().csrf === session.csrf;
  useEffect(() => {
    const hide = () => {
      if (!document.hidden) return;
      ++generation.current;
      operation.current?.abort();
      operation.current = null;
      setBusy(false);
      setPassword("");
      setCode("");
      setObserved(null);
      setUncertain(true);
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      ++generation.current;
      operation.current?.abort();
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  useEffect(() => {
    ++generation.current;
    operation.current?.abort();
    operation.current = null;
    setOpened(false);
    setPassword("");
    setCode("");
    setObserved(null);
    setBusy(false);
  }, [location.pathname]);
  async function open() {
    if (busy) return;
    setOpened(true);
    setError("");
    setPassword("");
    setCode("");
    setObserved(null);
    setUncertain(false);
    const ticket = ++generation.current;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    try {
      const saved = loadPending({
        instanceId: session.instance_id,
        userId: session.user.id,
      });
      setPending(saved);
      const value = await api<Target>(
        "/account",
        { signal: controller.signal },
        session.csrf,
      );
      if (ticket === generation.current && currentSession()) setTarget(value);
    } catch (cause) {
      if (ticket === generation.current) {
        setTarget(null);
        setError(cause instanceof Error ? cause.message : "本人账号读取失败");
      }
    } finally {
      if (ticket === generation.current) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  async function act(kind: "prepare" | "confirm" | "query" | "close") {
    if (busy || document.hidden || !currentSession()) return;
    const ticket = ++generation.current,
      controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    let original = pending;
    try {
      if (kind === "prepare") {
        if (!target || original) throw Error("请先核对原注销请求");
        original = newClosurePending({
          instanceId: session.instance_id,
          userId: session.user.id,
          sessionScope: session.receipt_scope,
          revision: target.revision,
        });
        retainClosurePending(sessionStorage, original);
        setPending(original);
        announce();
        const value = await api<unknown>(
          "/account/closure/prepare",
          {
            method: "POST",
            signal: controller.signal,
            body: JSON.stringify({
              request_id: original.requestId,
              revision: original.revision,
              receipt_token: original.receiptToken,
            }),
          },
          session.csrf,
        );
        if (ticket === generation.current) {
          setObserved(closureObservation(value, original));
          setUncertain(false);
        }
      } else if (kind === "confirm") {
        if (
          !original ||
          !target ||
          !sameClosureSession(original, session) ||
          observed?.state !== "prepared" ||
          uncertain ||
          target.revision !== original.revision
        )
          throw Error("须先核对原注销准备");
        retainClosurePending(sessionStorage, original);
        const value = await api<unknown>(
          "/account/close",
          {
            method: "POST",
            signal: controller.signal,
            body: JSON.stringify({
              request_id: original.requestId,
              revision: original.revision,
              receipt_token: original.receiptToken,
              current_password: password,
              code,
            }),
          },
          session.csrf,
        );
        removalReceipt(value, original.requestId, original.userId);
        if (ticket === generation.current && currentSession()) {
          window.dispatchEvent(
            new CustomEvent("alcor:session-expired", {
              detail: { message: "账号已注销" },
            }),
          );
        }
      } else {
        if (!original) throw Error("未找到原注销编号");
        let value: ClosureObservation;
        if (kind === "close" && sameClosureOwner(original, session)) {
          // Also closes a prepare that has not yet acquired the shared admission lock.
          const raw = await api<unknown>(
            "/account/closure/abort",
            {
              method: "POST",
              signal: controller.signal,
              body: JSON.stringify({
                request_id: original.requestId,
                revision: original.revision,
                receipt_token: original.receiptToken,
              }),
            },
            session.csrf,
          );
          value = closureObservation(raw, original);
        } else
          value = await observeClosure(
            original,
            kind === "close",
            controller.signal,
          );
        if (ticket === generation.current) {
          setObserved(value);
          setUncertain(false);
        }
      }
    } catch (cause) {
      if (ticket !== generation.current) return;
      setError(cause instanceof Error ? cause.message : "原注销请求待核对");
      if (
        kind !== "confirm" ||
        !(cause instanceof ApiError) ||
        cause.status >= 500 ||
        [401, 409].includes(cause.status) ||
        cause.code === "session_changed"
      ) {
        setUncertain(true);
        setObserved(null);
      }
    } finally {
      setPassword("");
      setCode("");
      if (ticket === generation.current) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  const terminal =
    observed?.state === "closed" || observed?.state === "completed";
  const ready =
    pending &&
    target &&
    observed?.state === "prepared" &&
    !uncertain &&
    sameClosureSession(pending, session) &&
    target.revision === pending.revision &&
    Date.parse(observed.prepared_until || "") > Date.now();
  function closeDialog() {
    if (busy) return;
    ++generation.current;
    setPassword("");
    setCode("");
    setOpened(false);
  }
  return (
    <section className="card padded settings-section">
      <button
        className="button secondary"
        type="button"
        onClick={() => void open()}
      >
        注销账号
      </button>
      {opened && (
        <Dialog title="注销账号" onClose={closeDialog}>
          <div className="dialog-content access-form">
            {target && (!pending || sameClosureSession(pending, session)) && (
              <p>
                确认注销账号 @{target.username}
                ？登录和客户端授权将失效，财务历史与审计记录保留。
              </p>
            )}
            {error && <p role="alert">{error}</p>}
            {pending && (
              <>
                <code>{pending.requestId}</code>
                <p role="status">
                  {statusText(observed) || "原注销请求待核对"}
                </p>
              </>
            )}
            {ready && (
              <>
                <label>
                  当前密码
                  <PasswordField
                    id="self-closure-password"
                    value={password}
                    disabled={busy}
                    autoComplete="current-password"
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                {target.two_factor_enabled && (
                  <label>
                    验证码或备用码
                    <input
                      value={code}
                      autoComplete="one-time-code"
                      maxLength={32}
                      disabled={busy}
                      onChange={(event) => setCode(event.target.value)}
                    />
                  </label>
                )}
              </>
            )}
            <div className="dialog-actions">
              {!pending && (
                <button
                  className="button secondary"
                  disabled={busy || !target}
                  onClick={() => void act("prepare")}
                >
                  准备注销
                </button>
              )}
              {pending && !terminal && (
                <>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void act("query")}
                  >
                    查询原请求
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void act("close")}
                  >
                    关闭原请求
                  </button>
                </>
              )}
              {ready && (
                <button
                  className="button primary"
                  disabled={busy || !password}
                  onClick={() => void act("confirm")}
                >
                  确认注销
                </button>
              )}
              {terminal && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    try {
                      if (pending)
                        releaseClosurePending(sessionStorage, pending);
                      setPending(null);
                      setObserved(null);
                      announce();
                      closeDialog();
                    } catch {
                      setError("已核对的本地注销记录无法更新");
                    }
                  }}
                >
                  完成
                </button>
              )}
              {!terminal && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={closeDialog}
                >
                  返回
                </button>
              )}
            </div>
            {pending && <Link to="/account-closure">单独核对原注销请求</Link>}
          </div>
        </Dialog>
      )}
    </section>
  );
}

function ClosureRecovery() {
  const [records, setRecords] = useState<ClosurePending[]>([]);
  const [pending, setPending] = useState<ClosurePending | null>(null),
    [error, setError] = useState("");
  const [value, setValue] = useState<ClosureObservation | null>(null),
    [busy, setBusy] = useState(false);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    try {
      const saved = readClosurePendings(sessionStorage);
      setRecords(saved);
      setPending(saved[0] ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "原注销记录不可用");
    }
    const hide = () => {
      if (document.hidden) {
        operation.current?.abort();
        operation.current = null;
        setBusy(false);
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      operation.current?.abort();
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  async function query(close = false) {
    if (!pending || operation.current || document.hidden) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      const result = await observeClosure(pending, close, controller.signal);
      if (!controller.signal.aborted) setValue(result);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "原注销请求待核对");
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  const terminal = value?.state === "completed" || value?.state === "closed";
  return (
    <div className="login-page">
      <div className="login-shell">
        <div className="brand">
          <strong>
            Alcor<span>API</span>
          </strong>
        </div>
        <div className="login-card access-form">
          {error && <p role="alert">{error}</p>}
          {records.length > 1 && (
            <SelectMenu
              label="原注销请求"
              variant="field"
              value={String(records.indexOf(pending!))}
              disabled={busy}
              options={records.map((row, index) => ({
                value: String(index),
                label: row.requestId + " · " + row.instanceId.slice(0, 8),
              }))}
              onChange={(index) => {
                setPending(records[Number(index)] ?? null);
                setValue(null);
                setError("");
              }}
            />
          )}
          {pending ? (
            <>
              <code>{pending.requestId}</code>
              <p role="status">{statusText(value) || "原注销请求待核对"}</p>
              <div className="dialog-actions">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void query()}
                >
                  查询原请求
                </button>
                {!terminal && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void query(true)}
                  >
                    关闭原请求
                  </button>
                )}
                {terminal && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                      try {
                        releaseClosurePending(sessionStorage, pending);
                        const remaining = readClosurePendings(sessionStorage);
                        setRecords(remaining);
                        setPending(remaining[0] ?? null);
                        setValue(null);
                        announce();
                      } catch {
                        setError("已核对的本地注销记录无法更新");
                      }
                    }}
                  >
                    完成
                  </button>
                )}
              </div>
            </>
          ) : (
            !error && <p role="status">没有待核对的注销请求</p>
          )}
          <div className="auth-switch">
            <Link to="/login">返回登录</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
export function AccountClosureBoundary({ children }: { children: ReactNode }) {
  return useLocation().pathname === "/account-closure" ? (
    <ClosureRecovery />
  ) : (
    children
  );
}
export function AccountClosureRecoveryLink() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const refresh = () => {
      try {
        setAvailable(loadPending() !== null);
      } catch {
        setAvailable(true);
      }
    };
    refresh();
    window.addEventListener("alcor:closure-pending", refresh);
    return () => window.removeEventListener("alcor:closure-pending", refresh);
  }, []);
  return available ? (
    <p className="auth-switch">
      <Link to="/account-closure">核对注销请求</Link>
    </p>
  ) : null;
}
