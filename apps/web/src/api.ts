import { delayRead, readStarted } from "./transition-qa";
import {
  apiSessionSnapshot,
  bindApiSession,
  isCurrentApiSession,
} from "./api-session";
import type { components } from "./generated/api";
export type Session = components["schemas"]["SessionOut"];
export type Profile = components["schemas"]["ProfileOut"];
export type ProfileActivity = components["schemas"]["ActivityOut"];
export type MigrationSummary = Pick<MigrationRegister, "summary"> & {
  capability_plan?: Pick<CapabilityPlan, "summary">;
};
export type ConnectionSettings = components["schemas"]["ConnectionSettingsOut"];
export type ConnectionConfig =
  | components["schemas"]["PostgresConfig"]
  | components["schemas"]["RedisConfig"];
export type ConnectionReceipt = components["schemas"]["ConnectionReceiptOut"];
export type Overview = components["schemas"]["OverviewOut"];
export type Task = components["schemas"]["TaskOut"];
export type TaskDetail = components["schemas"]["TaskDetail"];
export type TaskList = components["schemas"]["TaskList"];
export const base = "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public requestId = "",
    public code = "",
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
  csrf?: string,
  timeoutMs = 10000,
): Promise<T> {
  const session = apiSessionSnapshot();
  const read = ["GET", "HEAD"].includes(
    (options.method || "GET").toUpperCase(),
  );
  const boundRead =
    read && path !== "/session" && !path.startsWith("/session/");
  const assertCurrent = () => {
    if (!isCurrentApiSession(session))
      throw new ApiError(
        409,
        "登录身份已变化，请在当前账号下重新查看",
        "",
        "session_changed",
      );
  };
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    if ((options.method || "GET") === "GET") readStarted(path);
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    if (
      options.body &&
      !(options.body instanceof FormData) &&
      !headers.has("Content-Type")
    )
      headers.set("Content-Type", "application/json");
    if (csrf || (boundRead && session.csrf))
      headers.set("X-CSRF-Token", csrf || session.csrf!);
    const response = await fetch(base + path, {
      credentials: "same-origin",
      ...options,
      signal: controller.signal,
      headers,
    });
    assertCurrent();
    if (response.headers.get("X-Alcor-Session-Changed") === "true") {
      bindApiSession(null);
      window.dispatchEvent(new Event("alcor:session-changed"));
      throw new ApiError(
        409,
        "登录身份已变化，正在重新读取当前账号",
        "",
        "session_changed",
      );
    }
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      assertCurrent();
      if (
        response.status === 401 &&
        path !== "/session/login" &&
        path !== "/session"
      )
        window.dispatchEvent(new Event("alcor:session-expired"));
      throw new ApiError(
        response.status,
        data?.error?.message ||
          (typeof data?.error === "string" ? data.error : data?.message) ||
          "服务连接失败，请稍后重试",
        data?.request_id || "",
        response.headers.get("X-Alcor-Reauthentication") === "required"
          ? "reauth_required"
          : data?.error?.code || "",
      );
    }
    if (response.status === 204) return undefined as T;
    const result = (await response.json()) as T;
    if (
      (options.method || "GET") === "GET" &&
      path !== "/meta" &&
      path !== "/session"
    )
      await delayRead(controller.signal);
    assertCurrent();
    return result;
  } catch (e) {
    if (controller.signal.aborted && !options.signal?.aborted)
      throw new ApiError(0, "等待超时，请核对操作状态后重试");
    throw e;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
export interface Domain {
  id: string;
  name: string;
  target: string;
  stage: string;
  status: string;
  accepted: boolean;
  operation_count: number;
  local_verified_count?: number;
}
export interface Operation {
  id: string;
  method: string;
  path: string;
  feature_ids: string[];
  status: string;
  target?: string;
  verification?: { version?: string };
}
export interface MigrationRegister {
  implementation_staging?: ImplementationStage[];
  source_captured_at: string;
  summary: {
    domains: number;
    route_templates: number;
    method_bindings: number;
    identified_dispatches: number;
    accepted_operations: number;
    local_verified_operations?: number;
  };
  limitations: string[];
  domains: Domain[];
  operations: Operation[];
  capability_plan?: CapabilityPlan;
}

export interface ImplementationStage {
  key: string;
  feature_id?: string;
  status: "pending_validation" | "partial_pending_validation";
  version: string;
  implementation_files: string[];
  routes: { method: string; path: string }[];
  pending_validation: string[];
  remaining_implementation?: string[];
}

export interface CapabilityBinding {
  source_id: string;
  source_kind: string;
  method: string;
  path: string;
  protocol: string;
  status: string;
  accepted: boolean;
}
export interface CapabilityProtocol {
  source_key: string;
  implementation: { status: string };
  clients: { new_web: string; legacy_web: string; ios: string };
  constraints: string[];
  bindings: CapabilityBinding[];
}
export interface Capability {
  id: string;
  key?: string;
  name: string;
  method: string;
  proposed_path: string;
  delivery: string;
  feature_ids: string[];
  disposition: string;
  constraints: string[];
  implementation: {
    status: string;
    evidence?: {
      clients?: Partial<Capability["clients"]>;
      protocol_matrix?: CapabilityProtocol[];
    };
  };
  protocol_matrix?: CapabilityProtocol[];
  clients: { new_web: string; legacy_web: string; ios: string };
  bindings: CapabilityBinding[];
  action_contracts?: {
    action: string;
    method: string;
    path: string;
    auth: string;
    status: string;
    evidence: { version: string; tests: string[] };
  }[];
}
export interface CapabilityPlan {
  summary: {
    capabilities: number;
    catalog_capabilities?: number;
    retired_capabilities?: number;
    baseline_legacy_methods?: number;
    retired_legacy_methods?: number;
    implementation_local_verified: number;
    legacy_methods: number;
    legacy_local_verified: number;
    legacy_accepted: number;
    client_integrations_accepted: number;
    normalized_method_candidates: number;
    duplicate_prefix_candidates: number;
    dynamic_actions: number;
  };
  capabilities: Capability[];
  bindings: {
    source_id: string;
    source_kind: string;
    capability_ids: string[];
  }[];
  non_api_work: { feature_id: string; name: string; status: string }[];
}
