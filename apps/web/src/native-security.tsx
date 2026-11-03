import { useEffect, useRef, useState } from "react";
import {
  startRegistration,
  browserSupportsWebAuthn,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import { api, ApiError } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { useLocation } from "react-router-dom";
import type { Session } from "./api";
import { Dialog } from "./dialog";
import { PasswordField } from "./password-fields";

type Factor = { enabled: boolean; name: string; backupCodesRemaining: number };
type Key = {
  id: string;
  name: string;
  rpID: string;
  createdAt: number;
  lastUsedAt: number | null;
  backedUp: boolean;
};
type Config = {
  enabled: boolean;
  origin: string;
  rpID: string;
  name: string;
  revision: string;
};
type Setup = {
  challengeId: string;
  secret: string;
  otpauthUrl: string;
  qrPng: string;
  expiresAt: number;
};
type Mode =
  | "setup"
  | "disable"
  | "backup"
  | "add-key"
  | "rename"
  | "remove"
  | "config"
  | "codes"
  | null;
type RegistrationOptions = Parameters<
  typeof startRegistration
>[0]["optionsJSON"];

export function NativeSecurity({ session }: { session: Session }) {
  const [factor, setFactor] = useState<Factor | null>(null),
    [keys, setKeys] = useState<Key[]>([]),
    [config, setConfig] = useState<Config | null>(null);
  const [mode, setMode] = useState<Mode>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [name, setName] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null),
    [codes, setCodes] = useState<string[]>([]),
    [selected, setSelected] = useState<Key | null>(null);
  const [siteOrigin, setSiteOrigin] = useState(""),
    [siteEnabled, setSiteEnabled] = useState(true);
  const location = useLocation();
  const [foreground, setForeground] = useState(!document.hidden);
  const pageActive =
    location.pathname === "/account" &&
    foreground &&
    apiSessionSnapshot().csrf === session.csrf;
  const page = useRef(pageActive);
  page.current = pageActive;
  const alive = useRef(true),
    generation = useRef(0),
    reads = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const operation = useRef<number | null>(null),
    ceremony = useRef(false),
    interrupted = useRef("");
  const displayed = () =>
    alive.current &&
    page.current &&
    !document.hidden &&
    apiSessionSnapshot().csrf === session.csrf;
  function clear() {
    generation.current++;
    if (ceremony.current) {
      ceremony.current = false;
      WebAuthnAbortService.cancelCeremony();
    }
    setPassword("");
    setCode("");
    setSetup(null);
    setCodes([]);
    setMode(null);
    setSelected(null);
    setError("");
  }
  function withdraw() {
    if (operation.current !== null)
      interrupted.current = "操作结果未确认，请核对当前安全状态。";
    clear();
    ++reads.current;
    readController.current?.abort();
    readController.current = null;
    setFactor(null);
    setKeys([]);
    setConfig(null);
  }
  async function load(signal?: AbortSignal) {
    if (!displayed()) return;
    const ticket = ++reads.current;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const [f, k, c] = await Promise.all([
        api<Factor>("/account/totp", { signal: controller.signal }),
        api<{ keys: Key[] }>("/account/passkeys", {
          signal: controller.signal,
        }),
        api<Config>("/session/passkeys/config", { signal: controller.signal }),
      ]);
      if (
        ticket === reads.current &&
        !controller.signal.aborted &&
        displayed()
      ) {
        setFactor(f);
        setKeys(k.keys);
        setConfig(c);
        setError(interrupted.current);
      }
    } catch (cause) {
      if (
        ticket === reads.current &&
        !controller.signal.aborted &&
        displayed()
      ) {
        setFactor(null);
        setKeys([]);
        setConfig(null);
        setError(cause instanceof Error ? cause.message : "安全设置读取失败");
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      if (readController.current === controller) readController.current = null;
    }
  }
  useEffect(() => {
    alive.current = true;
    const hidden = () => {
      if (document.hidden) withdraw();
      setForeground(!document.hidden);
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      alive.current = false;
      withdraw();
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  useEffect(() => {
    if (!pageActive) {
      withdraw();
      return;
    }
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      controller.abort();
      withdraw();
    };
  }, [
    pageActive,
    session.csrf,
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  function open(next: Mode, key?: Key) {
    if (!displayed() || operation.current !== null || !factor || !config)
      return;
    interrupted.current = "";
    clear();
    setSelected(key || null);
    setName(
      key?.name ||
        (next === "config"
          ? config?.name || "Alcor"
          : next === "setup"
            ? "身份验证应用"
            : "通行密钥"),
    );
    setSiteOrigin(config?.origin || window.location.origin);
    setSiteEnabled(config?.enabled ?? true);
    setMode(next);
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !mode || operation.current !== null || !displayed()) return;
    const version = generation.current;
    operation.current = version;
    setBusy(true);
    setError("");
    const active = () => displayed() && version === generation.current;
    try {
      if (mode === "setup" && !setup) {
        const value = await api<Setup>(
          "/auth/totp/setup",
          { method: "POST", body: JSON.stringify({ password }) },
          session.csrf,
        );
        if (active()) setSetup(value);
        return;
      }
      if (mode === "setup" && setup) {
        const value = await api<{ backupCodes: string[] }>(
          "/auth/totp/confirm",
          {
            method: "POST",
            body: JSON.stringify({
              password,
              code,
              name,
              challengeId: setup.challengeId,
            }),
          },
          session.csrf,
        );
        if (active()) {
          setCodes(value.backupCodes);
          setMode("codes");
          setSetup(null);
          setPassword("");
          setCode("");
        }
      } else if (mode === "backup") {
        const value = await api<{ backupCodes: string[] }>(
          "/auth/totp/backup-codes",
          { method: "POST", body: JSON.stringify({ password, code }) },
          session.csrf,
        );
        if (active()) {
          setCodes(value.backupCodes);
          setMode("codes");
          setPassword("");
          setCode("");
        }
      } else if (mode === "disable") {
        await api(
          "/auth/totp/disable",
          { method: "POST", body: JSON.stringify({ password, code }) },
          session.csrf,
        );
        if (active()) clear();
      } else if (mode === "config") {
        await api(
          "/account/passkeys/config",
          {
            method: "PUT",
            body: JSON.stringify({
              password,
              code,
              name,
              origin: siteOrigin,
              enabled: siteEnabled,
              revision: config?.revision || "",
            }),
          },
          session.csrf,
        );
        if (active()) clear();
      } else if (mode === "add-key") {
        const options = await api<{
          options: RegistrationOptions;
          requestId: string;
        }>(
          "/account/passkeys",
          {
            method: "POST",
            body: JSON.stringify({
              action: "register-options",
              password,
              code,
            }),
          },
          session.csrf,
        );
        if (!active()) return;
        ceremony.current = true;
        let response;
        try {
          response = await startRegistration({ optionsJSON: options.options });
        } finally {
          ceremony.current = false;
        }
        if (!active()) return;
        await api(
          "/account/passkeys",
          {
            method: "POST",
            body: JSON.stringify({
              action: "register-verify",
              requestId: options.requestId,
              response,
              name,
            }),
          },
          session.csrf,
        );
        if (active()) clear();
      } else if (selected && (mode === "rename" || mode === "remove")) {
        const result = await api<{ signedOut?: boolean }>(
          "/account/passkeys",
          {
            method: mode === "remove" ? "DELETE" : "PATCH",
            body: JSON.stringify({ id: selected.id, name, password, code }),
          },
          session.csrf,
        );
        if (active()) {
          clear();
          if (result.signedOut) {
            window.dispatchEvent(new Event("alcor:session-expired"));
            return;
          }
        }
      }
      if (displayed()) await load();
    } catch (e) {
      if (active()) {
        setPassword("");
        setCode("");
        if (
          (!(e instanceof ApiError) &&
            !(e instanceof Error && e.name === "NotAllowedError")) ||
          (e instanceof ApiError &&
            (e.status === 0 || e.status >= 500 || e.code === "session_changed"))
        ) {
          clear();
          setFactor(null);
          setKeys([]);
          setConfig(null);
          interrupted.current = "操作结果未确认，请核对当前安全状态。";
          setError(interrupted.current);
          return;
        }
        setError(
          e instanceof Error && e.name === "NotAllowedError"
            ? "通行密钥操作已取消或超时"
            : e instanceof Error
              ? e.message
              : "操作失败",
        );
      }
    } finally {
      if (operation.current === version) operation.current = null;
      if (alive.current) setBusy(false);
    }
  }
  const titles: Record<Exclude<Mode, null>, string> = {
    setup: setup ? "确认二次验证" : "开启二次验证",
    disable: "关闭二次验证",
    backup: "重建备用码",
    "add-key": "添加通行密钥",
    rename: "重命名通行密钥",
    remove: "移除通行密钥",
    config: "通行密钥设置",
    codes: "备用码",
  };
  if (!pageActive) return null;
  return (
    <>
      {!mode && error && (
        <div role="alert" className="notice error">
          {error}
          <button
            type="button"
            className="text-button"
            onClick={() => void load()}
          >
            重新读取
          </button>
        </div>
      )}
      <section className="card padded settings-section">
        <h2>二次验证</h2>
        {factor && (
          <div className="security-setting-row">
            <span>
              {factor.enabled ? factor.name : "未开启"}
              {factor.enabled && (
                <small>备用码剩余 {factor.backupCodesRemaining}</small>
              )}
            </span>
            <div className="security-actions">
              {factor.enabled ? (
                <>
                  <button
                    className="text-button"
                    onClick={() => open("backup")}
                  >
                    重建备用码
                  </button>
                  <button
                    className="text-button"
                    onClick={() => open("disable")}
                  >
                    关闭
                  </button>
                </>
              ) : (
                <button
                  className="button secondary"
                  onClick={() => open("setup")}
                >
                  开启
                </button>
              )}
            </div>
          </div>
        )}
      </section>
      <section className="card padded settings-section">
        <h2>通行密钥</h2>
        <div className="security-setting-row">
          <span>
            {config ? (config.enabled ? config.rpID : "未启用") : "状态待核对"}
          </span>
          <div className="security-actions">
            {session.user.role === "admin" && config && (
              <button className="text-button" onClick={() => open("config")}>
                设置
              </button>
            )}
            <button
              className="button secondary"
              disabled={!config?.enabled || !browserSupportsWebAuthn()}
              onClick={() => open("add-key")}
            >
              添加
            </button>
          </div>
        </div>
        <ul className="security-key-list">
          {keys.map((key) => (
            <li key={key.id}>
              <span>
                <strong>{key.name}</strong>
                <small>{key.rpID}</small>
              </span>
              <div className="security-actions">
                <button
                  className="text-button"
                  onClick={() => open("rename", key)}
                >
                  重命名
                </button>
                <button
                  className="text-button"
                  onClick={() => open("remove", key)}
                >
                  移除
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      {mode && (
        <Dialog
          title={titles[mode]}
          onClose={() => {
            if (!busy) clear();
          }}
        >
          <form
            className="dialog-content native-security-form"
            onSubmit={submit}
          >
            {mode === "codes" ? (
              <>
                <div className="backup-code-grid">
                  {codes.map((value) => (
                    <code key={value}>{value}</code>
                  ))}
                </div>
                <p>备用码仅在此显示一次，每个只能使用一次。</p>
                <button
                  type="button"
                  className="button primary"
                  onClick={clear}
                >
                  完成
                </button>
              </>
            ) : (
              <>
                {setup && (
                  <div className="totp-setup">
                    <img src={setup.qrPng} alt="验证器绑定二维码" />
                    <code>{setup.secret}</code>
                  </div>
                )}
                {["setup", "add-key", "rename", "config"].includes(mode) && (
                  <label>
                    名称
                    <input
                      value={name}
                      maxLength={64}
                      required
                      disabled={busy}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                )}
                {mode === "config" && (
                  <>
                    <label>
                      站点地址
                      <input
                        type="url"
                        value={siteOrigin}
                        required
                        disabled={busy}
                        onChange={(e) => setSiteOrigin(e.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="text-button"
                      aria-pressed={siteEnabled}
                      disabled={busy}
                      onClick={() => setSiteEnabled(!siteEnabled)}
                    >
                      {siteEnabled ? "已启用" : "已关闭"}
                    </button>
                  </>
                )}
                {mode !== "rename" && (
                  <label>
                    当前密码
                    <PasswordField
                      id="identity-current-password"
                      value={password}
                      maxLength={128}
                      autoComplete="current-password"
                      required
                      disabled={busy}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                )}
                {((mode === "setup" && setup) ||
                  (mode !== "rename" && factor?.enabled)) && (
                  <label>
                    验证码或备用码
                    <input
                      autoComplete="one-time-code"
                      value={code}
                      required
                      maxLength={32}
                      disabled={busy}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </label>
                )}
                {mode === "remove" && (
                  <p>移除后，使用此通行密钥建立的会话将失效。</p>
                )}
                {error && (
                  <div role="alert" className="notice error">
                    {error}
                  </div>
                )}
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={clear}
                  >
                    取消
                  </button>
                  <button className="button primary" disabled={busy}>
                    {busy
                      ? "处理中…"
                      : mode === "setup" && !setup
                        ? "继续"
                        : "确认"}
                  </button>
                </div>
              </>
            )}
          </form>
        </Dialog>
      )}
    </>
  );
}
