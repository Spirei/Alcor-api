import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { Session } from "./api";
import { emailReadGate } from "./email-change-read";
import { PasswordField } from "./password-fields";
import { Dialog } from "./dialog";
import { observeDeviceSession, readDeviceState } from "./device-session";

type Device = {
  id: string;
  kind: "web" | "app";
  name: string;
  current: boolean;
  createdAt: number | null;
  lastUsedAt: number | null;
  expiresAt: number | null;
};
export function AccountDevices({ session }: { session: Session }) {
  const [devices, setDevices] = useState<Device[] | null>(null),
    [selected, setSelected] = useState<Device | null>(null);
  const [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const [factorEnabled, setFactorEnabled] = useState(false);
  const gate = useRef(emailReadGate()),
    active = useRef(false),
    operation = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    if (!active.current || document.hidden) return;
    await readDeviceState(
      gate.current,
      (signal) =>
        api<{ devices: Device[]; twoFactorEnabled: boolean }>(
          "/account/devices",
          { signal, cache: "no-store" },
        ),
      {
        active: () => active.current && !document.hidden,
        clear: () => {
          setDevices(null);
          setSelected(null);
          setPassword("");
          setCode("");
          setError("");
          setLoading(true);
        },
        publish: (result) => {
          setDevices(result.devices);
          setFactorEnabled(result.twoFactorEnabled);
        },
        failed: (error) => {
          setError(error instanceof Error ? error.message : "读取失败");
        },
        done: () => setLoading(false),
      },
    );
  }, []);
  useEffect(() => {
    const clear = () => {
      gate.current.invalidate();
      setDevices(null);
      setSelected(null);
      setPassword("");
      setCode("");
      setError("");
      setLoading(false);
      setBusy(false);
      setFactorEnabled(false);
      setMessage(operation.current ? "退出结果未确认，请刷新核对。" : "");
      operation.current?.abort();
      operation.current = null;
    };
    return observeDeviceSession(document, window, {
      active: (value) => {
        active.current = value;
      },
      clear,
      read: () => {
        void reload();
      },
    });
  }, [
    session.csrf,
    session.instance_id,
    session.user.id,
    session.user.role,
    reload,
  ]);
  async function revoke() {
    if (!selected || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{
        revoked: boolean;
        reauthenticationRequired: boolean;
      }>(
        "/account/devices",
        {
          method: "DELETE",
          signal: controller.signal,
          body: JSON.stringify({
            id: selected.id,
            currentPassword: password,
            code,
          }),
        },
        session.csrf,
      );
      if (controller.signal.aborted) return;
      setPassword("");
      setCode("");
      setSelected(null);
      if (result.reauthenticationRequired) {
        operation.current = null;
        window.dispatchEvent(
          new CustomEvent("alcor:session-expired", {
            detail: { message: "当前登录已退出" },
          }),
        );
        return;
      }
      setMessage("设备已退出。");
      void reload();
    } catch (e) {
      if (controller.signal.aborted) return;
      setPassword("");
      setCode("");
      if (!(e instanceof ApiError) || e.status >= 500 || e.status === 0) {
        setSelected(null);
        setMessage("退出结果未确认，请刷新核对。");
        void reload();
      } else {
        setError(e.message);
        if (e.status === 401 || e.status === 403) {
          await reload();
          if (!controller.signal.aborted && active.current) setError(e.message);
        }
      }
    } finally {
      if (!controller.signal.aborted) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  const close = () => {
    if (busy) return;
    setSelected(null);
    setPassword("");
    setCode("");
    setError("");
  };
  return (
    <section className="card padded settings-section">
      <h2>登录设备</h2>
      {loading && <p role="status">正在读取…</p>}
      {devices?.length === 0 && <p>暂无登录设备</p>}
      {devices?.map((device) => (
        <div className="security-setting-row" key={device.id}>
          <div>
            <strong>{device.name}</strong>
            <span>{device.current ? " · 当前设备" : ""}</span>
            <div>
              {device.kind === "app" ? "App" : "Web"} ·{" "}
              {device.lastUsedAt
                ? new Date(device.lastUsedAt).toLocaleString("zh-CN")
                : "最近使用时间不可用"}
            </div>
          </div>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setSelected(device);
              setError("");
              setMessage("");
            }}
          >
            退出登录
          </button>
        </div>
      ))}
      <button
        type="button"
        className="button secondary"
        disabled={busy || loading}
        onClick={() => void reload()}
      >
        刷新
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {selected && (
        <Dialog
          title={selected.current ? "退出当前登录" : "退出设备登录"}
          onClose={close}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void revoke();
            }}
          >
            <p>{selected.name}</p>
            <label htmlFor="device-password">当前密码</label>
            <PasswordField
              id="device-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              disabled={busy}
            />
            {factorEnabled && (
              <>
                <label htmlFor="device-factor">验证码或备用码</label>
                <input
                  id="device-factor"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="one-time-code"
                  maxLength={64}
                  disabled={busy}
                />
              </>
            )}
            <button className="button primary" disabled={busy}>
              {busy ? "正在退出…" : "退出登录"}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={close}
            >
              取消
            </button>
          </form>
        </Dialog>
      )}
    </section>
  );
}
