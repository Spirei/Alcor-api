import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Layers3 } from "lucide-react";
import { api } from "./api";
import { observeVerificationLinks, verificationToken } from "./email-verification-token";

function VerifyEmail({ token }: { token: string }) {
  const location = useLocation(),
    navigate = useNavigate();
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState("");
  const operation = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    if (location.search || location.hash)
      navigate("/verify-email", { replace: true });
  }, [location.search, location.hash, navigate]);
  useEffect(() => {
    const prior = document.title;
    document.title = "邮箱验证 · Alcor";
    return () => {
      document.title = prior;
      operation.current?.abort();
    };
  }, []);
  async function confirm() {
    if (!token || operation.current || done) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      await api("/auth/email-verification/confirm", {
        method: "POST",
        body: JSON.stringify({ token }),
        signal: controller.signal,
        referrerPolicy: "no-referrer",
        cache: "no-store",
      });
      if (!controller.signal.aborted) setDone(true);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "验证失败，请重新申请验证邮件",
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
        <section className="login-card">
          {done ? (
            <p role="status">邮箱已验证</p>
          ) : !token ? (
            <p role="alert">验证链接缺失或无效，请重新打开邮件中的链接。</p>
          ) : (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? "正在验证…" : "验证邮箱"}
            </button>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="auth-switch">
            <Link to="/">返回 Alcor</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
export function EmailVerificationBoundary({
  children,
}: {
  children: ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
  // Retain the credential in memory through URL cleanup, but replace the whole
  // verification attempt when a different email link arrives in this same SPA.
  const active = useRef("");
  useEffect(() => {
    // BrowserRouter does not observe same-document fragment navigation.
    // Capture each link before cleanup, including a previously used link.
    return observeVerificationLinks(window, (token) => {
      active.current = token;
      setAttempt((value) => value + 1);
      navigate("/verify-email", { replace: true });
    });
  }, [navigate]);
  if (location.pathname !== "/verify-email") {
    active.current = "";
    return children;
  }
  if (location.search || location.hash)
    active.current = verificationToken(location.search, location.hash);
  return <VerifyEmail key={`${attempt}:${active.current}`} token={active.current} />;
}
