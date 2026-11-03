import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { Session } from "./api";
import { Dialog } from "./dialog";
import { PasswordField } from "./password-fields";

export function ConnectionVerification({
  session,
  scope = "connections",
  onClose,
  onVerified,
  onDenied,
}: {
  session: Session;
  scope?: "connections" | "deployment" | "reference/rates/provider";
  onClose: () => void;
  onVerified: () => void;
  onDenied?: () => void;
}) {
  const [password, setPassword] = useState(""),
    [code, setCode] = useState("");
  const [factor, setFactor] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    const controller = new AbortController();
    alive.current = true;
    void api<{ enabled: boolean }>("/account/totp", {
      signal: controller.signal,
    })
      .then((value) => {
        if (alive.current) setFactor(value.enabled);
      })
      .catch((e) => {
        if (alive.current && !controller.signal.aborted)
          setError(e instanceof Error ? e.message : "验证方式读取失败");
      });
    const hidden = () => {
      if (document.hidden) onClose();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      alive.current = false;
      controller.abort();
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  return (
    <Dialog
      title="验证身份"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="dialog-content account-password-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || factor === null) return;
          setBusy(true);
          setError("");
          try {
            await api(
              `/${scope}/reauthenticate`,
              { method: "POST", body: JSON.stringify({ password, code }) },
              session.csrf,
            );
            if (alive.current) {
              setPassword("");
              setCode("");
              onVerified();
            }
          } catch (e) {
            if (
              alive.current &&
              onDenied &&
              e instanceof ApiError &&
              [401, 403].includes(e.status) &&
              !["当前密码不正确", "二次验证码或备用码不正确"].includes(
                e.message,
              )
            ) {
              setPassword("");
              setCode("");
              onDenied();
            } else if (alive.current)
              setError(e instanceof Error ? e.message : "验证失败");
          } finally {
            if (alive.current) setBusy(false);
          }
        }}
      >
        <label htmlFor="connection-verification-password">当前密码</label>
        <PasswordField
          id="connection-verification-password"
          data-dialog-autofocus
          value={password}
          autoComplete="current-password"
          maxLength={128}
          disabled={busy}
          required
          onChange={(e) => setPassword(e.target.value)}
        />
        {factor && (
          <>
            <label htmlFor="connection-verification-code">验证码或备用码</label>
            <input
              id="connection-verification-code"
              value={code}
              autoComplete="one-time-code"
              maxLength={32}
              disabled={busy}
              required
              onChange={(e) => setCode(e.target.value)}
            />
          </>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <button
          className="button primary"
          disabled={busy || factor === null || !password || (factor && !code)}
        >
          {busy ? "验证中…" : "验证并继续"}
        </button>
      </form>
    </Dialog>
  );
}
