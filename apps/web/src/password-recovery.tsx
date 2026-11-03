import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Layers3 } from "lucide-react";
import { api, ApiError } from "./api";
import { PasswordField, PasswordStrength } from "./password-fields";
import { SelectMenu } from "./select-menu";
import {
  interruptedRecovery,
  observeRecoveryPrivacy,
} from "./password-recovery-state";
import type { RecoveryStage as Stage } from "./password-recovery-state";

type Method = "email" | "totp";
type Challenge = {
  ok: true;
  challenge: string;
  retryAfter: number;
  message: string;
};

function PasswordRecovery() {
  const [stage, setStage] = useState<Stage>("request");
  const [method, setMethod] = useState<Method>("email");
  const [login, setLogin] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [proof, setProof] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const currentStage = useRef(stage);
  currentStage.current = stage;
  useEffect(
    () =>
      observeRecoveryPrivacy(document, window, () => {
        const next = interruptedRecovery(
          currentStage.current,
          operation.current !== null,
        );
        operation.current?.abort();
        operation.current = null;
        setChallenge("");
        setProof("");
        setCode("");
        setPassword("");
        setConfirmation("");
        setLogin("");
        setMessage("");
        setError("");
        setBusy(false);
        currentStage.current = next;
        setStage(next);
      }),
    [],
  );
  useEffect(() => {
    const prior = document.title;
    document.title = "找回密码 · Alcor";
    return () => {
      document.title = prior;
      operation.current?.abort();
    };
  }, []);
  function restart() {
    if (operation.current) return;
    setChallenge("");
    setProof("");
    setCode("");
    setPassword("");
    setConfirmation("");
    setMessage("");
    setError("");
    setStage("request");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (operation.current || stage === "done" || stage === "unknown") return;
    setError("");
    if (stage === "confirm" && password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    try {
      if (stage === "request") {
        const result = await api<Challenge>("/auth/password-reset/request", {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({ login: login.trim(), method, challenge }),
        });
        if (controller.signal.aborted) return;
        setChallenge(result.challenge);
        setMessage(result.message);
        setCode("");
        setStage("verify");
      } else if (stage === "verify") {
        const result = await api<{ ok: true; token: string }>(
          "/auth/password-reset/verify",
          {
            method: "POST",
            signal: controller.signal,
            body: JSON.stringify({ challenge, code: code.trim(), method }),
          },
        );
        if (controller.signal.aborted) return;
        setProof(result.token);
        setChallenge("");
        setCode("");
        setMessage("");
        setStage("confirm");
      } else {
        await api("/auth/password-reset/confirm", {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({ token: proof, newPassword: password }),
        });
        if (controller.signal.aborted) return;
        setProof("");
        setPassword("");
        setConfirmation("");
        setStage("done");
      }
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (
        stage === "confirm" &&
        (!(failure instanceof ApiError) ||
          failure.status === 0 ||
          failure.status >= 500)
      ) {
        // An interrupted reply cannot prove that the credential transaction failed.
        setProof("");
        setPassword("");
        setConfirmation("");
        setStage("unknown");
      } else
        setError(
          failure instanceof Error ? failure.message : "请求失败，请重试",
        );
    } finally {
      if (!controller.signal.aborted) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <div className="login-page">
      <div className="login-shell">
        <div className="brand">
          <Layers3 size={23} />
          <strong>
            Alcor<span>API</span>
          </strong>
        </div>
        <div className="login-card">
          {stage === "done" ? (
            <p role="status">密码已修改，请重新登录。</p>
          ) : stage === "unknown" ? (
            <p role="alert">修改结果未确认，请先尝试用新密码登录。</p>
          ) : (
            <form onSubmit={submit} aria-label="找回密码">
              {stage === "request" && (
                <>
                  <label htmlFor="recovery-login">用户名或邮箱</label>
                  <input
                    id="recovery-login"
                    value={login}
                    onChange={(event) => setLogin(event.target.value)}
                    maxLength={160}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={busy}
                    required
                    autoFocus
                  />
                  <SelectMenu
                    label="验证方式"
                    value={method}
                    onChange={setMethod}
                    variant="field"
                    disabled={busy}
                    options={[
                      { value: "email", label: "邮箱验证码" },
                      { value: "totp", label: "验证器或备用码" },
                    ]}
                  />
                </>
              )}
              {stage === "verify" && (
                <>
                  {message && <p role="status">{message}</p>}
                  <label htmlFor="recovery-code">
                    {method === "email" ? "邮箱验证码" : "验证码或备用码"}
                  </label>
                  <input
                    id="recovery-code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    maxLength={64}
                    autoComplete="one-time-code"
                    autoCapitalize="none"
                    spellCheck={false}
                    disabled={busy}
                    required
                    autoFocus
                  />
                </>
              )}
              {stage === "confirm" && (
                <>
                  <label htmlFor="password">新密码</label>
                  <PasswordField
                    id="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    maxLength={128}
                    autoComplete="new-password"
                    disabled={busy}
                    required
                    autoFocus
                  />
                  {password && (
                    <PasswordStrength
                      password={password}
                      username={login.trim()}
                    />
                  )}
                  <label htmlFor="confirm-password">确认密码</label>
                  <PasswordField
                    id="confirm-password"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    maxLength={128}
                    autoComplete="new-password"
                    disabled={busy}
                    required
                  />
                </>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button className="button primary" disabled={busy}>
                {busy
                  ? "正在处理…"
                  : stage === "request"
                    ? "继续"
                    : stage === "verify"
                      ? "验证"
                      : "修改密码"}
              </button>
              {stage !== "request" && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={restart}
                >
                  重新开始
                </button>
              )}
            </form>
          )}
          <div className="auth-switch">
            <Link to="/login">返回登录</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PasswordRecoveryBoundary({
  children,
}: {
  children: ReactNode;
}) {
  return useLocation().pathname === "/password-reset" ? (
    <PasswordRecovery />
  ) : (
    children
  );
}
