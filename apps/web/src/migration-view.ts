// Capsules mark only this continuation's proved methods. Earlier local verification stays unmarked.
export function continuationCapsule(version: string | undefined): string | null {
  if (!version) return null;
  const parts = version.split(".");
  if (parts.length !== 3) return null;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0)) return null;
  const [major, minor, patch] = numbers;
  if (major !== 0 || minor !== 1 || patch < 76) return null;
  return version;
}

// Local protocol verification never implies source-data or client cutover acceptance.
export function migrationState(status: string, domain = false): string {
  if (status === "retired") return "已移除";
  if (status === "local_verified") return "已本地验证";
  if (status === "pending_validation") return "待验证";
  if (status === "partial_pending_validation") return "部分待验证";
  if (status === "in_progress") return "迁移中";
  if (status === "accepted") return "已验收";
  return domain ? "待迁移" : "待核实";
}

import type { Capability, CapabilityPlan, ImplementationStage } from "./api";

export function implementationPlan(plan: CapabilityPlan | undefined, stages: ImplementationStage[] | undefined): CapabilityPlan | undefined {
  if (!plan || !stages?.length) return plan;
  const byKey = new Map(stages.filter(stage =>
    (stage.status === "pending_validation" || stage.status === "partial_pending_validation") &&
    Boolean(stage.version) && stage.implementation_files?.length && stage.routes?.length,
  ).map(stage => [stage.key, stage]));
  return {...plan, non_api_work: (plan.non_api_work || []).map(work => {
    const stage = nonApiImplementationStage(stages, work.feature_id);
    if (!stage || ["local_verified", "accepted", "retired"].includes(work.status)) return work;
    return {...work, status: stage.status};
  }), capabilities: plan.capabilities.map(cap => {
    const stage = byKey.get(cap.key || "");
    if (!stage || cap.implementation.status === "local_verified" || cap.implementation.status === "retired") return cap;
    return {...cap, implementation: {...cap.implementation, status: stage.status}};
  })};
}

// These are source work packages, never fabricated HTTP capabilities.
export function nonApiImplementationStage(stages: ImplementationStage[] | undefined, featureId: string): ImplementationStage | undefined {
  if (!["F38", "F39"].includes(featureId)) return undefined;
  return stages?.find(stage => stage.key === "non_api:" + featureId &&
    stage.feature_id === featureId &&
    ["pending_validation", "partial_pending_validation"].includes(stage.status) &&
    Boolean(stage.version?.trim()) &&
    Boolean(stage.implementation_files?.length) &&
    stage.implementation_files.every(file => Boolean(file.trim())) &&
    Boolean(stage.routes?.length) &&
    stage.routes.every(route => Boolean(route.method?.trim()) && route.path?.startsWith("/")));
}

// Aggregate the complete view, never just the children left by a search.
export function migrationDomainState(
  sourceStatus: string,
  children: string[],
  nonApiStatus?: string,
): string {
  if (sourceStatus === "retired") return "retired";
  if (!children.length && ["pending_validation", "partial_pending_validation"].includes(nonApiStatus || "")) return nonApiStatus!;
  const active = children.filter((status) => status !== "retired");
  if (children.length && !active.length) return "retired";
  if (
    active.includes("pending_validation") &&
    active.every((status) => ["pending_validation", "local_verified", "accepted"].includes(status))
  ) return "pending_validation";
  if (active.some(status => status === "partial_pending_validation" || status === "pending_validation")) return "in_progress";
  if (active.length && active.every((status) => status === "accepted"))
    return "accepted";
  if (
    active.length &&
    active.every(
      (status) => status === "local_verified" || status === "accepted",
    )
  )
    return "local_verified";
  if (
    active.some((status) =>
      ["local_verified", "accepted", "in_progress"].includes(status),
    )
  )
    return "in_progress";
  return sourceStatus === "in_progress" ? "in_progress" : "pending";
}

export function migrationProgress(verified: number, total: number) {
  if (
    !Number.isInteger(verified) ||
    !Number.isInteger(total) ||
    total <= 0 ||
    verified < 0 ||
    verified > total
  )
    return null;
  const ratio = verified / total;
  return {
    verified,
    total,
    ratio,
    percent:
      verified === total ? 100 : Math.min(99.9, Math.round(ratio * 1000) / 10),
  };
}

// Source delivery and validation are independent dimensions of active work.
export function migrationSourceProgress(plan: CapabilityPlan | undefined) {
  if (!plan) return null;
  const complete = new Set(["pending_validation", "local_verified", "accepted"]);
  const active = plan.capabilities.filter(cap => cap.implementation.status !== "retired");
  const progress = migrationProgress(active.filter(cap => complete.has(cap.implementation.status)).length, active.length);
  if (!progress) return null;
  const nonApi = (plan.non_api_work || []).filter(work => ["F38", "F39"].includes(work.feature_id) && work.status !== "retired");
  return {...progress, pendingValidation: active.filter(cap => cap.implementation.status === "pending_validation").length,
    nonApi: {complete: nonApi.filter(work => complete.has(work.status)).length, total: nonApi.length}};
}

// A verified legacy adapter does not implement the proposed canonical URL.
export function capabilityEntryEvidence(implementation: {status: string; evidence?: unknown}) {
  const evidence = implementation.evidence as {verification_scope?: unknown; runtime_routes?: unknown} | undefined;
  const verified = ["local_verified", "accepted"].includes(implementation.status);
  const legacyOnly = evidence?.verification_scope === "legacy_protocol_only";
  const routes: {method: string; path: string}[] = [];
  if (verified && Array.isArray(evidence?.runtime_routes)) {
    for (const item of evidence.runtime_routes) {
      if (!item || typeof item !== "object" || typeof item.method !== "string" ||
          !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(item.method.toUpperCase()) ||
          typeof item.path !== "string" || !item.path.startsWith("/") || item.path.startsWith("//") || [...item.path].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 92 || char.charCodeAt(0) === 127)) continue;
      const paths = item.path.includes("{version}") ? [1, 2].map(version => item.path.replaceAll("{version}", String(version))) : [item.path];
      for (const path of paths) {
        const route = {method: item.method.toUpperCase(), path};
        if (!routes.some(existing => existing.method === route.method && existing.path === route.path)) routes.push(route);
      }
    }
  }
  return {label: verified && !legacyOnly ? "本地实现" : "建议入口", legacyOnly, routes};
}

export function capabilityMatches(cap: Capability, query: string): boolean {
  const text = query.trim().toLowerCase();
  return (
    !text ||
    [
      cap.name,
      cap.proposed_path,
      ...cap.feature_ids,
      ...cap.bindings.map((binding) => binding.method + " " + binding.path),
      ...(cap.action_contracts || []).flatMap((action) => [
        action.action,
        action.method + " " + action.path,
      ]),
    ].some((value) => value.toLowerCase().includes(text))
  );
}

export function capabilityClientState(
  capabilities: Capability[],
  client: keyof Capability["clients"],
): string {
  return capabilityClientProgress(capabilities, client).label;
}

export function capabilityClientProgress(
  capabilities: Capability[],
  client: keyof Capability["clients"],
): { status: string; label: string } {
  if (!capabilities.length) return { status: "review", label: "需专项验收" };
  capabilities = capabilities.filter(
    (cap) => cap.implementation.status !== "retired",
  );
  if (!capabilities.length) return { status: "retired", label: "已移除" };
  const state = (cap: Capability): string => {
    if (cap.clients[client] === "accepted") return "accepted";
    const evidence = (
      cap.implementation as {
        evidence?: {
          clients?: Partial<Capability["clients"]>;
          protocol_matrix?: { clients?: Partial<Capability["clients"]> }[];
        };
      }
    ).evidence;
    const matrix =
      (
        cap as {
          protocol_matrix?: { clients?: Partial<Capability["clients"]> }[];
        }
      ).protocol_matrix || evidence?.protocol_matrix;
    if (matrix?.length) {
      const states = matrix.map((part) => part.clients?.[client] || "pending");
      if (
        states.every(
          (status) => status === "local_verified" || status === "accepted",
        )
      )
        return "local_verified";
      return states.some((status) =>
        ["local_verified", "accepted", "in_progress"].includes(status),
      )
        ? "in_progress"
        : "pending";
    }
    return evidence?.clients?.[client] === "local_verified"
      ? "local_verified"
      : "pending";
  };
  const accepted = capabilities.filter(
    (cap) => state(cap) === "accepted",
  ).length;
  const local = capabilities.filter(
    (cap) => state(cap) === "local_verified",
  ).length;
  const partial = capabilities.filter(
    (cap) => state(cap) === "in_progress",
  ).length;
  if (accepted === capabilities.length)
    return { status: "accepted", label: `${accepted} 项已验收` };
  if (accepted + local === capabilities.length)
    return {
      status: "local_verified",
      label: `${accepted + local} 项已本地验证`,
    };
  if (accepted)
    return { status: "in_progress", label: `${accepted} 项已验收，其余待完成` };
  if (local)
    return { status: "in_progress", label: `${local} 项本地验证，其余待完成` };
  if (partial)
    return {
      status: "in_progress",
      label: `${partial} 项部分验证${partial < capabilities.length ? "，其余待完成" : ""}`,
    };
  return {
    status: "pending",
    label: client === "legacy_web" ? "待改接验收" : "待适配验收",
  };
}

export const dispositionLabels: Record<string, string> = {
  user_requested_removal: "按用户要求移除",
  shared_candidate: "共用实现候选",
  direct_candidate: "直接承接候选",
  retain_boundary: "保留操作边界",
  static_candidate: "静态资源候选",
  task_candidate: "共用任务机制",
  replacement_review: "替代方案待确认",
};
