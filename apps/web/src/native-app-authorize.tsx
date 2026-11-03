import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { authorizationCallback } from "./native-app-callback";
import type { Session } from "./api";
const labels: Record<string, string> = {
  "portfolio.read": "读取投资记录",
  "portfolio.write": "修改投资记录",
  "assets.read": "读取资产",
  "positions.read": "读取持仓",
  "cash.read": "读取现金",
  "orders.read": "读取订单",
  "orders.write": "提交订单",
  "orders.cancel": "撤销订单",
  "profile.write": "修改个人资料",
  "feed.read": "读取订阅",
  "feed.write": "修改订阅",
  "security.read": "读取账户安全信息",
  "security.write": "管理账户安全",
  "resources.read": "读取资源",
  "resources.write": "修改资源",
};
export function NativeAppAuthorize({
  session,
  query,
}: {
  session: Session;
  query: string;
}) {
  const auth = useMemo(() => {
    const p = new URLSearchParams(query);
    const keys = [
      "client_id",
      "redirect_uri",
      "response_type",
      "scope",
      "state",
      "code_challenge",
      "code_challenge_method",
    ];
    if (
      keys.some((key) => p.getAll(key).length !== 1) ||
      p.get("client_id") !== "fire-ios" ||
      p.get("redirect_uri") !== "com.fire.app:/oauth/callback" ||
      p.get("response_type") !== "code" ||
      p.get("code_challenge_method") !== "S256" ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(p.get("state") || "") ||
      !/^[A-Za-z0-9_-]{43}$/.test(p.get("code_challenge") || "")
    )
      return null;
    const scopes = [
      ...new Set((p.get("scope") || "").split(/\s+/).filter(Boolean)),
    ];
    if (
      !scopes.includes("portfolio.read") ||
      scopes.some((scope) => !labels[scope])
    )
      return null;
    for (const prefix of ["feed", "security", "resources"])
      if (
        scopes.includes(prefix + ".write") &&
        !scopes.includes(prefix + ".read")
      )
        return null;
    return {
      body: Object.fromEntries(
        [...keys, "device_name"].map((key) => [key, p.get(key) || ""]),
      ),
      scopes,
    };
  }, [query]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const running = useRef(false);
  const epoch = useRef(0),
    operation = useRef<AbortController | null>(null);
  useEffect(() => {
    const invalidate = () => {
      epoch.current++;
      operation.current?.abort();
      operation.current = null;
      running.current = false;
      setBusy(false);
      setError("");
    };
    const visibility = () => {
      if (document.hidden) invalidate();
    };
    invalidate();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("alcor:session-expired", invalidate);
    return () => {
      invalidate();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("alcor:session-expired", invalidate);
    };
  }, [
    query,
    session.instance_id,
    session.user.id,
    session.user.role,
    session.csrf,
  ]);
  async function decide(decision: "allow" | "deny") {
    if (!auth || running.current || document.hidden) return;
    const controller = new AbortController(),
      generation = epoch.current;
    operation.current = controller;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await api<{ callback: string }>(
        "/client/authorize",
        {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({ ...auth.body, decision }),
        },
        session.csrf,
      );
      if (
        controller.signal.aborted ||
        generation !== epoch.current ||
        document.hidden
      )
        return;
      window.location.assign(
        authorizationCallback(
          value.callback,
          auth.body.redirect_uri,
          auth.body.state,
        ),
      );
    } catch (e) {
      if (!controller.signal.aborted && generation === epoch.current)
        setError(e instanceof Error ? e.message : "授权失败");
    } finally {
      if (generation === epoch.current) {
        operation.current = null;
        running.current = false;
        setBusy(false);
      }
    }
  }
  if (!auth)
    return (
      <div className="notice error" role="alert">
        授权请求参数无效
      </div>
    );
  return (
    <div className="native-app-consent">
      <div className="page-heading">
        <h1>连接 Alcor iOS</h1>
      </div>
      <p>{session.user.username}</p>
      <ul>
        {auth.scopes.map((scope) => (
          <li key={scope}>{labels[scope]}</li>
        ))}
      </ul>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <div className="dialog-actions">
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void decide("deny")}
        >
          拒绝
        </button>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void decide("allow")}
        >
          {busy ? "处理中…" : "允许连接"}
        </button>
      </div>
    </div>
  );
}
