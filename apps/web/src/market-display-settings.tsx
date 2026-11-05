import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { requestId } from "./request-id";
import { MarketBadgeSettings } from "./market-badge-settings";
import { PasswordField } from "./password-fields";
import {
  SettingGroup,
  SettingRow,
  ToggleSwitch,
  FormActions,
} from "./workspace-forms";

type Head = {
  revision: number;
  settings: {
    marketBadges: Record<string, unknown>;
    marketBadgesVisible: boolean;
  };
};
type Receipt = Head & { requestId: string; state: string };
const base = "/admin/site-settings";
export function MarketDisplaySettings({
  session,
  active,
}: {
  session: Session;
  active: boolean;
}) {
  const key =
    "alcor.market-display." +
    JSON.stringify([
      session.instance_id,
      session.user.id,
      session.receipt_scope,
    ]);
  const [head, setHead] = useState<Head | null>(null),
    [badges, setBadges] = useState("{}"),
    [enabled, setEnabled] = useState(true);
  const [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [journalReady, setJournalReady] = useState(false);
  const live = useRef(false),
    epoch = useRef(0);
  const current = () =>
    live.current &&
    !document.hidden &&
    apiSessionSnapshot().csrf === session.csrf;
  function accept(value: Head) {
    if (
      !Number.isSafeInteger(value.revision) ||
      !value.settings ||
      typeof value.settings.marketBadgesVisible !== "boolean"
    )
      throw Error("行情显示配置待核对");
    setHead(value);
    setBadges(JSON.stringify(value.settings.marketBadges));
    setEnabled(value.settings.marketBadgesVisible);
  }
  function fail(reason: unknown) {
    if (reason instanceof ApiError && [401, 403].includes(reason.status))
      setHead(null);
    setError(reason instanceof Error ? reason.message : "行情设置读取失败");
  }
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (
        saved &&
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(saved)
      )
        throw Error("行情设置操作记录无效");
      setPending(saved);
      setJournalReady(true);
    } catch (reason) {
      fail(reason);
    }
  }, [key]);
  useEffect(() => {
    live.current = active;
    const generation = ++epoch.current,
      controller = new AbortController();
    const hide = () => {
      if (document.hidden) {
        setPassword("");
        setCode("");
      }
    };
    document.addEventListener("visibilitychange", hide);
    if (active && !document.hidden) {
      setBusy(true);
      setError("");
      api<Head>(base, { signal: controller.signal })
        .then((value) => {
          if (current() && generation === epoch.current) accept(value);
        })
        .catch((reason) => {
          if (!controller.signal.aborted && generation === epoch.current)
            fail(reason);
        })
        .finally(() => {
          if (generation === epoch.current) setBusy(false);
        });
    }
    return () => {
      live.current = false;
      ++epoch.current;
      controller.abort();
      setPassword("");
      setCode("");
      document.removeEventListener("visibilitychange", hide);
    };
  }, [active, session.csrf]);
  async function run(check = false, close = false) {
    if (!current() || busy || !journalReady || (!check && !head)) return;
    const id = check ? pending : requestId();
    if (!id) return;
    let patch;
    try {
      if (!check)
        patch = {
          marketBadges: JSON.parse(badges),
          marketBadgesVisible: enabled,
        };
    } catch {
      setError("市场色块配置无效");
      return;
    }
    const generation = epoch.current;
    if (!check) {
      try {
        sessionStorage.setItem(key, id);
        setPending(id);
      } catch {
        setError("无法保存操作编号，请检查浏览器存储");
        return;
      }
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const value = await api<Receipt>(
        check ? base + "/operations/" + id + (close ? "/close" : "") : base,
        check
          ? close
            ? {
                method: "POST",
                body: JSON.stringify({ expectedKind: "site-settings" }),
              }
            : {}
          : {
              method: "PUT",
              body: JSON.stringify({
                requestId: id,
                expectedRevision: head!.revision,
                patch,
                password,
                code,
              }),
            },
        session.csrf,
      );
      if (!current() || generation !== epoch.current) return;
      if (
        value.requestId !== id ||
        !["completed", "closed"].includes(value.state)
      )
        throw Error("行情设置结果待核对，请查询原操作");
      if (value.state === "completed") accept(value);
      sessionStorage.removeItem(key);
      setPending(null);
      setPassword("");
      setCode("");
      setMessage(
        value.state === "completed" ? "行情显示设置已保存" : "原操作已关闭",
      );
    } catch (reason) {
      if (current() && generation === epoch.current) fail(reason);
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  if (session.user.role !== "admin") return null;
  return (
    <section className="market-display-settings" aria-label="行情显示设置">
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {!head && (
        <p role="status">{busy ? "正在读取行情设置…" : "未取得行情设置"}</p>
      )}
      {head && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run();
          }}
        >
          <SettingGroup title="市场标识">
            <SettingRow title="显示市场色块">
              <ToggleSwitch
                label="显示市场色块"
                checked={enabled}
                disabled={busy || !!pending}
                onChange={setEnabled}
              />
            </SettingRow>
          </SettingGroup>
          <MarketBadgeSettings
            expanded
            value={badges}
            disabled={busy || !!pending}
            onChange={setBadges}
          />
          <details className="market-display-confirm">
            <summary>保存平台行情显示设置</summary>
            <div className="workspace-form-grid">
              <label className="workspace-form-field">
                当前管理员密码
                <PasswordField
                  id="market-display-password"
                  value={password}
                  disabled={busy || !!pending}
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label className="workspace-form-field">
                验证码或备用码
                <input
                  value={code}
                  disabled={busy || !!pending}
                  autoComplete="one-time-code"
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
            </div>
            <FormActions>
              <button
                className="button primary"
                disabled={busy || !!pending || !journalReady || !password}
              >
                保存
              </button>
            </FormActions>
          </details>
        </form>
      )}
      {pending && (
        <div role="status">
          设置结果待核对
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void run(true)}
          >
            核对原操作
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void run(true, true)}
          >
            关闭未执行请求
          </button>
        </div>
      )}
    </section>
  );
}
