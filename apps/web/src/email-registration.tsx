import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, ApiError, type Session } from "./api";
import { PasswordField, PasswordStrength } from "./password-fields";

type Discovery = {
  settings: { allowRegister: boolean; emailRegistration: boolean };
};
type Challenge = {
  email: string;
  challenge: string;
  expires_in: number;
  retry_after: number;
};
function EmailRegistration() {
  const navigate = useNavigate();
  const [setupToken, setSetupToken] = useState("");
  const [requiresSetupToken, setRequiresSetupToken] = useState<boolean | null>(null);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [visible, setVisible] = useState(!document.hidden);
  const [email, setEmail] = useState(""),
    [code, setCode] = useState("");
  const [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false),
    [unknown, setUnknown] = useState(false);
  const [retryAt, setRetryAt] = useState(0),
    [remaining, setRemaining] = useState(0);
  const generation = useRef(0),
    operation = useRef<AbortController | null>(null);
  const action = useRef<"request" | "confirm" | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void api<{requires_setup_token: boolean}>("/auth/registration", {signal:controller.signal})
      .then((value) => { if (!controller.signal.aborted) setRequiresSetupToken(value.requires_setup_token === true); })
      .catch(() => { if (!controller.signal.aborted) setError("安装状态读取失败，请刷新后重试。"); });
    void api<Discovery>("/settings/public", { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setDiscovery(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "注册状态读取失败");
      });
    const hide = () => {
      setVisible(!document.hidden);
      if (!document.hidden) return;
      ++generation.current;
      const confirming = action.current === "confirm";
      action.current = null;
      operation.current?.abort();
      operation.current = null;
      setEmail("");
      setCode("");
      setPassword("");
      setSetupToken("");
      setConfirmation("");
      setChallenge(null);
      setBusy(false);
      setError("");
      if (!confirming) setMessage("");
      if (confirming) {
        setUnknown(true);
        setMessage("注册结果未确认，请先用邮箱登录核对。");
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      ++generation.current;
      controller.abort();
      operation.current?.abort();
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  useEffect(() => {
    if (!retryAt || !visible) return;
    const tick = () =>
      setRemaining(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [retryAt, visible]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      operation.current ||
      busy ||
      unknown ||
      document.hidden ||
      !discovery?.settings.emailRegistration || requiresSetupToken === null
    )
      return;
    if (challenge && password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }
    if (!challenge && remaining > 0) return;
    const ticket = ++generation.current,
      controller = new AbortController();
    operation.current = controller;
    action.current = challenge ? "confirm" : "request";
    setBusy(true);
    setError("");
    setMessage("");
    const confirming = challenge !== null;
    try {
      if (!challenge) {
        setRetryAt(Date.now() + 60000);
        const value = await api<Challenge>("/session/register/email/request", {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({ email }),
        });
        if (ticket !== generation.current || controller.signal.aborted) return;
        if (!value.challenge || value.email !== email.trim().toLowerCase())
          throw Error("验证码请求待核对");
        setChallenge(value);
        setRetryAt(Date.now() + Math.max(60, value.retry_after) * 1000);
        setMessage("如果该邮箱可用于注册，验证码会进入发送队列。");
      } else {
        await api<Session>("/session/register/email/confirm", {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({
            email: challenge.email,
            challenge: challenge.challenge,
            code,
            password,
            ...(requiresSetupToken ? {setup_token:setupToken} : {}),
          }),
        });
        if (ticket !== generation.current || controller.signal.aborted) return;
        action.current = null;
        setPassword("");
        setConfirmation("");
        setCode("");
        setChallenge(null);
        navigate("/", { replace: true });
        window.dispatchEvent(new Event("alcor:session-changed"));
      }
    } catch (cause) {
      if (ticket !== generation.current || controller.signal.aborted) return;
      const uncertain =
        !(cause instanceof ApiError) ||
        cause.status === 0 ||
        cause.status >= 500 ||
        cause.code === "session_changed";
      if (confirming && uncertain) {
        setUnknown(true);
        setChallenge(null);
        setCode("");
        setMessage("注册结果未确认，请先用邮箱登录核对。");
      } else
        setError(
          !confirming && uncertain
            ? "验证码请求结果未确认，请稍后重新请求。"
            : cause instanceof Error
              ? cause.message
              : "注册失败",
        );
    } finally {
      setSetupToken("");
      setPassword("");
      setConfirmation("");
      if (ticket === generation.current) {
        action.current = null;
        operation.current = null;
        setBusy(false);
      }
    }
  }
  const supported = discovery?.settings.emailRegistration === true && requiresSetupToken !== null;
  return (
    <div className="login-page">
      <div className="login-shell">
        <div className="brand">
          <strong>
            Alcor<span>API</span>
          </strong>
        </div>
        <div className="login-card">
          {error && <p role="alert">{error}</p>}
          {message && <p role="status">{message}</p>}
          {discovery && !supported && (
            <p role="status">
              {discovery.settings.allowRegister
                ? "邮箱注册暂不可用"
                : "注册暂未开放"}
            </p>
          )}
          {supported && !unknown && (
            <form
              onSubmit={(event) => void submit(event)}
              aria-label="邮箱注册"
            >
              <label htmlFor="signup-email">邮箱</label>
              <input
                id="signup-email"
                type="email"
                autoComplete="email"
                maxLength={254}
                value={challenge?.email || email}
                disabled={busy || !!challenge}
                required
                onChange={(event) => setEmail(event.target.value)}
              />
              {challenge && (
                <>
                  <label htmlFor="signup-code">验证码</label>
                  <input
                    id="signup-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    value={code}
                    disabled={busy}
                    required
                    onChange={(event) => setCode(event.target.value)}
                  />
                  {requiresSetupToken && <>
                    <label htmlFor="signup-setup-token">安装令牌</label>
                    <PasswordField id="signup-setup-token" value={setupToken} autoComplete="off" maxLength={512}
                      disabled={busy} required onChange={(event) => setSetupToken(event.target.value)} />
                  </>}
                  <label htmlFor="signup-password">密码</label>
                  <PasswordField
                    id="signup-password"
                    value={password}
                    autoComplete="new-password"
                    maxLength={128}
                    disabled={busy}
                    required
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  {password && (
                    <PasswordStrength
                      password={password}
                      username={challenge.email}
                    />
                  )}
                  <label htmlFor="signup-confirmation">确认密码</label>
                  <PasswordField
                    id="signup-confirmation"
                    value={confirmation}
                    autoComplete="new-password"
                    maxLength={128}
                    disabled={busy}
                    required
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </>
              )}
              <button
                className="button primary"
                disabled={busy || (!challenge && remaining > 0)}
              >
                {busy
                  ? "处理中…"
                  : challenge
                    ? "注册"
                    : remaining > 0
                      ? `${remaining} 秒后可重新请求`
                      : "请求验证码"}
              </button>
              {challenge && (
                <button
                  className="button secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setChallenge(null);
                    setCode("");
                    setPassword("");
                    setConfirmation("");
                    setMessage("");
                  }}
                >
                  修改邮箱或重新请求
                </button>
              )}
            </form>
          )}
          <div className="auth-switch">
            <Link to="/login">{unknown ? "登录核对" : "登录"}</Link>
          </div>
          {!unknown && (
            <div className="auth-switch">
              <Link to="/register">用户名注册</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
export function EmailRegistrationBoundary({
  children,
}: {
  children: ReactNode;
}) {
  return useLocation().pathname === "/register/email" ? (
    <EmailRegistration />
  ) : (
    children
  );
}
export function EmailRegistrationLink() {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void api<Discovery>("/settings/public", { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted)
          setSupported(value.settings.emailRegistration === true);
      })
      .catch(() => setSupported(false));
    return () => controller.abort();
  }, []);
  return supported ? (
    <p className="auth-switch">
      <Link to="/register/email">邮箱注册</Link>
    </p>
  ) : null;
}
