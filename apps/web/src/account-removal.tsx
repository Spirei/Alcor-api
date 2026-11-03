import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { api, ApiError } from "./api";
import type { Session } from "./api";
import { Dialog } from "./dialog";
import { PasswordField } from "./password-fields";
import {
  retainRecoveryId,
  releaseRecoveryId,
  removalReceipt,
} from "./admin-credential-state";
import { requestId } from "./request-id";
import { SelfAccountClosure } from "./self-account-closure";

type Target = {
  id: string;
  username: string;
  revision: string;
  role: string;
  two_factor_enabled?: boolean;
};
export function AccountRemoval({
  session,
  target,
  onDone,
  disabled = false,
  onPending,
}: {
  session: Session;
  target: Target;
  onDone: () => void;
  disabled?: boolean;
  onPending?: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const forbidden = target.id === session.user.id;
  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        setPassword("");
        setCode("");
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  function close() {
    if (!busy && !uncertain) {
      setOpen(false);
      setPassword("");
      setCode("");
      setOperation(null);
      setError("");
    }
  }
  async function submit(check = false) {
    if (busy || (!check && disabled)) return;
    setBusy(true);
    setError("");
    const id = operation || requestId();
    const storageKey = `alcor.account-action.${session.instance_id}.${session.user.id}`;
    try {
      if (!check) retainRecoveryId(sessionStorage, storageKey, id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作编号无法保存");
      setBusy(false);
      return;
    }
    setOperation(id);
    onPending?.(id);
    try {
      if (check) {
        const receipt = await api<unknown>(`/users/receipts/${id}`);
        removalReceipt(receipt, id, target.id);
      } else {
        const receipt = await api<unknown>(
          `/users/${encodeURIComponent(target.id)}`,
          {
            method: "DELETE",
            body: JSON.stringify({
              request_id: id,
              revision: target.revision,
              current_password: password,
              code,
            }),
          },
          session.csrf,
        );
        removalReceipt(receipt, id, target.id);
      }
      setPassword("");
      setCode("");
      setUncertain(false);
      setOpen(false);
      releaseRecoveryId(sessionStorage, storageKey, id);
      onPending?.(null);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
      // A lost response must be checked with the same durable request ID.
      const unknown =
        !(e instanceof ApiError) ||
        e.status >= 500 ||
        e.code === "session_changed" ||
        (check && e.status === 404);
      setUncertain(unknown);
      if (!unknown) {
        releaseRecoveryId(sessionStorage, storageKey, id);
        onPending?.(null);
      }
    } finally {
      setPassword("");
      setCode("");
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="user-action"
        disabled={forbidden || disabled}
        aria-label={`删除 ${target.username}`}
        title={forbidden ? "管理员须在设置中注销本人账号" : "删除账号"}
        onClick={() => {
          setOpen(true);
          setError("");
        }}
      >
        <Trash2 size={17} aria-hidden="true" />
      </button>
      {open && (
        <Dialog title="删除账号" onClose={close}>
          <div className="dialog-content access-form">
            <p>
              确认删除账号 @{target.username}
              ？登录和客户端授权将失效，历史记录保留用于审计。
            </p>
            {
              <>
                <PasswordField
                  id="close-account-password"
                  aria-label="当前管理员密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy || uncertain}
                  autoComplete="current-password"
                />
                {
                  <label>
                    验证码或备用码
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      maxLength={32}
                      disabled={busy || uncertain}
                      autoComplete="one-time-code"
                    />
                  </label>
                }
              </>
            }
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            {uncertain && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void submit(true)}
              >
                核对删除结果
              </button>
            )}
            <div className="dialog-actions">
              <button
                className="button secondary"
                disabled={busy || uncertain}
                onClick={close}
              >
                取消
              </button>
              <button
                className="button primary"
                disabled={busy || uncertain || !password}
                onClick={() => void submit()}
              >
                {busy ? "处理中…" : "确认删除"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

export function AccountClosureSettings({ session }: { session: Session }) {
  return (
    <SelfAccountClosure
      key={JSON.stringify([
        session.instance_id,
        session.user.id,
        session.receipt_scope,
      ])}
      session={session}
    />
  );
}
