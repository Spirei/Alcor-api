import type {
  ConnectionConfig,
  ConnectionReceipt,
  ConnectionSettings,
} from "./api";

export function connectionResultView(
  receipt: ConnectionReceipt,
  currentDraft: boolean,
  settings: ConnectionSettings | null,
) {
  let text = receipt.message;
  const saved = receipt.status === "saved" || receipt.status === "pending";
  // Only the matching saved revision can establish the current application state.
  const matching =
    saved && receipt.revision && settings?.revision === receipt.revision
      ? settings
      : null;
  if (matching)
    text =
      matching.state === "applied"
        ? matching.worker_applied
          ? "已保存并应用"
          : "API 已应用，Worker 待同步"
        : "已保存，正在应用";
  if (!currentDraft)
    text = (receipt.operation === "test" ? "上次测试：" : "上次保存：") + text;
  const complete =
    receipt.status === "passed" ||
    (matching?.state === "applied" && matching.worker_applied);
  return {
    text,
    tone: !currentDraft
      ? "historical"
      : receipt.status === "failed"
        ? "failed"
        : complete
          ? "success"
          : "pending",
  };
}

export function emptyConnectionConfig(
  kind: "postgresql" | "redis",
): ConnectionConfig {
  return kind === "postgresql"
    ? {
        kind,
        host: "",
        port: 5432,
        username: "",
        database: "",
        schema_name: "public",
        ssl_mode: "disable",
        connect_timeout: 3,
        pool_size: 5,
        pool_min_size: 0,
        max_lifetime: 1800,
        max_idle: 600,
      }
    : {
        kind,
        host: "",
        port: 6379,
        username: "",
        database: 0,
        tls: false,
        connect_timeout: 3,
        max_connections: 10,
      };
}

type Service = {
  id: string;
  state: "up" | "down" | "unconfigured" | "pending";
  configured?: boolean;
};
export function servicePresentation(service: Service) {
  if (service.id === "worker")
    return {
      state: service.state,
      label:
        service.state === "up"
          ? "运行中"
          : service.state === "down"
            ? "未收到心跳"
            : "待配置",
    };
  if (service.configured !== true)
    return service.configured === false
      ? { state: "unconfigured", label: "未配置" }
      : { state: "unknown", label: "待核对" };
  return {
    state: service.state,
    label:
      service.state === "up"
        ? "已连接"
        : service.state === "down"
          ? "未连接"
          : service.state === "pending"
            ? "应用中"
            : "未配置",
  };
}
