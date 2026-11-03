import { useEffect, useRef, useState } from "react";
import {
  startAuthentication,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";
import { api } from "./api";
import type { Session } from "./api";

type Options = Parameters<typeof startAuthentication>[0]["optionsJSON"];
export function NativePasskeyLogin({
  onLogin,
  onError,
  disabled,
  onPending,
}: {
  onLogin: (session: Session) => void;
  onError: (error: string) => void;
  disabled: boolean;
  onPending: (pending: boolean) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const running = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    void api<{ enabled: boolean }>("/session/passkeys/config", {
      signal: controller.signal,
    })
      .then((config) => {
        if (alive.current)
          setEnabled(config.enabled && browserSupportsWebAuthn());
      })
      .catch(() => {});
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, []);
  if (!enabled) return null;
  return (
    <button
      type="button"
      className="button secondary full"
      disabled={disabled}
      onClick={async () => {
        if (running.current) return;
        running.current = true;
        onPending(true);
        onError("");
        try {
          const options = await api<{ options: Options; requestId: string }>(
            "/session/passkeys",
            {
              method: "POST",
              body: JSON.stringify({ action: "login-options" }),
            },
          );
          const credential = await startAuthentication({
            optionsJSON: options.options,
          });
          const session = await api<Session>("/session/passkeys", {
            method: "POST",
            body: JSON.stringify({
              action: "login-verify",
              requestId: options.requestId,
              response: credential,
            }),
          });
          if (alive.current) onLogin(session);
        } catch (error) {
          if (alive.current)
            onError(
              error instanceof Error && error.name === "NotAllowedError"
                ? "通行密钥验证已取消或超时"
                : error instanceof Error
                  ? error.message
                  : "通行密钥登录失败",
            );
        } finally {
          running.current = false;
          if (alive.current) onPending(false);
        }
      }}
    >
      通行密钥登录
    </button>
  );
}
