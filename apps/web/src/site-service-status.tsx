import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";

type Source = {
  state: string;
  enabled?: boolean;
  timezone?: string;
  linkOriginState?: string;
};
type ServiceStatus = {
  settings: {
    smtpHost?: string;
    smtpPort?: string;
    smtpSecure?: boolean;
    smtpFromEmail?: string;
    smtpPasswordConfigured?: boolean;
    emailLinkOrigin?: string;
    currencyRefreshPattern?: string;
  };
  migration: { sources: { smtp?: Source; fxSchedule?: Source } };
};

export function SiteServiceStatus({
  session,
  active,
}: {
  session: Session;
  active: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const [visible, setVisible] = useState(!document.hidden);
  const [value, setValue] = useState<ServiceStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    const current = ++generation.current;
    if (!opened || !active || !visible || locked) return;
    if (apiSessionSnapshot().csrf !== session.csrf) {
      setValue(null);
      return;
    }
    const controller = new AbortController();
    setBusy(true);
    setError("");
    void api<ServiceStatus>(
      "/settings",
      { signal: controller.signal },
      session.csrf,
    )
      .then((result) => {
        if (generation.current === current && !controller.signal.aborted)
          setValue(result);
      })
      .catch((cause: unknown) => {
        if (generation.current !== current || controller.signal.aborted) return;
        if (
          cause instanceof ApiError &&
          [401, 403, 409].includes(cause.status)
        ) {
          setValue(null);
          setLocked(true);
        }
        setError(cause instanceof Error ? cause.message : "读取服务配置失败");
      })
      .finally(() => {
        if (generation.current === current) setBusy(false);
      });
    return () => {
      ++generation.current;
      controller.abort();
      setBusy(false);
    };
  }, [opened, active, visible, locked, refresh, session.csrf]);
  const config = value?.settings;
  const mail = value?.migration.sources.smtp;
  const fx = value?.migration.sources.fxSchedule;
  return (
    <details
      className="connection-advanced"
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary>邮件与汇率</summary>
      {error && <p role="status">{error}</p>}
      {config && (
        <dl className="connection-effective">
          <dt>邮件配置</dt>
          <dd>
            {mail?.state === "enabled"
              ? "启用"
              : mail?.state === "disabled"
                ? "停用"
                : mail?.state === "unconfigured"
                  ? "未配置"
                  : "未知"}
          </dd>
          {config.smtpHost && (
            <>
              <dt>SMTP 地址</dt>
              <dd>{config.smtpHost}</dd>
              <dt>端口</dt>
              <dd>{config.smtpPort}</dd>
              <dt>加密</dt>
              <dd>{config.smtpSecure ? "TLS" : "STARTTLS"}</dd>
              <dt>发件邮箱</dt>
              <dd>{config.smtpFromEmail || "未设置"}</dd>
              <dt>SMTP 密码</dt>
              <dd>
                {config.smtpPasswordConfigured === true
                  ? "已设置"
                  : config.smtpPasswordConfigured === false
                    ? "未设置"
                    : "未知"}
              </dd>
            </>
          )}
          <dt>验证链接来源</dt>
          <dd>{config.emailLinkOrigin || "未公开"}</dd>
          <dt>汇率采集</dt>
          <dd>
            {fx?.enabled === true
              ? "启用"
              : fx?.enabled === false
                ? "停用"
                : "未知"}
          </dd>
          <dt>汇率计划</dt>
          <dd>
            {config.currencyRefreshPattern !== undefined
              ? config.currencyRefreshPattern || "空模式"
              : fx?.state === "custom_no_schedule" ||
                  fx?.state === "builtin_no_legacy_pattern"
                ? "当前供应商未保存该计划"
                : "未知"}
          </dd>
          {fx?.timezone && (
            <>
              <dt>计划时区</dt>
              <dd>{fx.timezone}</dd>
            </>
          )}
        </dl>
      )}
      <button
        className="button"
        type="button"
        disabled={busy || locked || !active || !visible || !opened}
        onClick={() => setRefresh((previous) => previous + 1)}
      >
        {busy ? "读取中" : "重新读取"}
      </button>
    </details>
  );
}
