import {
  sourceIconReceipt,
  sourceIconLabel,
} from "./watch-group-source-icon-state.ts";
export type SourceWindow = {
  state: string;
  notBefore?: string;
  expiresAt?: string;
};
export type SourceGrant = {
  id: string;
  source_alias: string;
  source_instance: string;
  source_owner: string;
  revision: number;
  state: string;
  effectiveState: string;
  migrationWindow?: SourceWindow;
  platform_instance: string;
};
export type SourceRow = {
  originalId: string | null;
  sequence: number;
  rowSha256: string;
  name?: string;
  sort?: number;
  visible?: number;
  kind?: string;
  market?: string;
  targetId?: string | null;
  targetRecordId?: string | null;
  targetGroupId?: string | null;
  groupId?: string | null;
  state?: string;
  reason?: string | null;
  blocker?: string;
  iconState?: string;
  orderingState?: string;
  metadataTimeState?: string;
};
export type SourceManifest = {
  id: string;
  rawSha256: string;
  publishedAt: string;
  source: { instance: string; owner: string };
  groups: SourceRow[];
  members: SourceRow[];
  counts: Record<string, number>;
  next: number | null;
  metadataCapturedComplete: true;
  membershipMappingComplete: false;
  currentSourceAccess: {
    grantState: string;
    grantRevisionMatches: boolean;
    window: SourceWindow;
  };
};
export type SourceProof = {
  manifestId: string;
  rawSha256: string;
  preview: string;
  ready: boolean;
  groupRevision: number;
  recordRevision: number;
  groups: SourceRow[];
  members: SourceRow[];
  memberCount: number;
  membersTruncated: boolean;
  unknownGroups: number;
  unknownMembers: number;
  iconPending: number;
  orderingUnknown: number;
  metadataTimeUnknown: number;
  financialApplied: false;
  financialHeadAdvanced: false;
};
export type SourceReceipt = {
  requestId: string;
  state: string;
  kind?: "capture" | "apply";
  domain?: string;
  manifestId?: string;
  rawSha256?: string;
  permissionState?: string;
  grantId?: string;
  grantRevision?: number;
  groupOutcomes?: SourceRow[];
  memberCounts?: Record<string, number>;
  reason?: string;
  financialApplied: false;
};
export type SourcePending = {
  id: string;
  kind: "grant" | "capture" | "apply";
  submissionStatus?: number;
};
type Store = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
const prefix = "alcor.watch-group-source-request:";
export const sourceUuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const hash = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) >= 0;
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("来源数据待核对");
  return v as Record<string, unknown>;
}
function rows(v: unknown): SourceRow[] {
  if (
    !Array.isArray(v) ||
    v.some((r) => {
      const x = object(r);
      return (
        !(x.originalId === null || typeof x.originalId === "string") ||
        !integer(x.sequence) ||
        !hash(x.rowSha256)
      );
    })
  )
    throw Error("来源明细待核对");
  return v as SourceRow[];
}
export function sourceGrants(raw: unknown, owner: string): SourceGrant[] {
  const v = object(raw);
  if (v.targetUserId !== owner) throw Error("来源目标账号不符");
  if (
    !Array.isArray(v.items) ||
    v.items.some((r) => {
      const x = object(r);
      return (
        !sourceUuid(x.id) ||
        !integer(x.revision) ||
        !["active", "pending_owner", "revoked"].includes(String(x.state)) ||
        [
          "source_alias",
          "source_instance",
          "source_owner",
          "effectiveState",
          "platform_instance",
        ].some((k) => typeof x[k] !== "string")
      );
    })
  )
    throw Error("来源授权待核对");
  return v.items as SourceGrant[];
}
export function sourceCanCapture(
  grant: SourceGrant | undefined,
  instance: string,
  now = Date.now(),
) {
  const w = grant?.migrationWindow,
    start = Date.parse(w?.notBefore ?? ""),
    end = Date.parse(w?.expiresAt ?? "");
  return (
    !!grant &&
    grant.state === "active" &&
    grant.effectiveState === "active" &&
    grant.platform_instance === instance &&
    w?.state === "active" &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start <= now &&
    now < end
  );
}
export function sourceManifest(raw: unknown, id: string): SourceManifest {
  const v = object(raw),
    access = object(v.currentSourceAccess),
    source = object(v.source),
    counts = object(v.counts);
  if (
    v.id !== id ||
    !sourceUuid(id) ||
    !hash(v.rawSha256) ||
    typeof v.publishedAt !== "string" ||
    typeof source.instance !== "string" ||
    typeof source.owner !== "string" ||
    v.metadataCapturedComplete !== true ||
    v.membershipMappingComplete !== false ||
    typeof access.grantState !== "string" ||
    typeof access.grantRevisionMatches !== "boolean" ||
    !(v.next === null || integer(v.next)) ||
    !integer(counts.watch_groups) ||
    !integer(counts.records) ||
    Object.values(counts).some((n) => !integer(n))
  )
    throw Error("来源清单待核对");
  rows(v.groups);
  rows(v.members);
  return v as unknown as SourceManifest;
}
export function sourceProof(raw: unknown, id: string): SourceProof {
  const v = object(raw);
  if (
    v.manifestId !== id ||
    !sourceUuid(id) ||
    !hash(v.rawSha256) ||
    !hash(v.preview) ||
    typeof v.ready !== "boolean" ||
    typeof v.membersTruncated !== "boolean" ||
    v.financialApplied !== false ||
    v.financialHeadAdvanced !== false ||
    [
      "groupRevision",
      "recordRevision",
      "memberCount",
      "unknownGroups",
      "unknownMembers",
      "iconPending",
      "orderingUnknown",
      "metadataTimeUnknown",
    ].some((k) => !integer(v[k]))
  )
    throw Error("来源预览待核对");
  rows(v.groups);
  rows(v.members);
  return v as unknown as SourceProof;
}
export function sourceReceipt(
  raw: unknown,
  id: string,
  kind: SourcePending["kind"],
): SourceReceipt {
  const v = object(raw),
    completed = [
      "completed",
      "completed_with_unknown",
      "completed_with_blocked",
    ].includes(String(v.state));
  if (
    v.requestId !== id ||
    !sourceUuid(id) ||
    ![
      "reading",
      "completed",
      "completed_with_unknown",
      "completed_with_blocked",
      "failed",
      "unknown",
    ].includes(String(v.state)) ||
    v.financialApplied !== false ||
    (v.manifestId !== undefined && !sourceUuid(v.manifestId)) ||
    (kind !== "grant" && !["capture", "apply"].includes(String(v.kind))) ||
    (v.domain !== undefined && v.domain !== "source_icon")
  )
    throw Error("原操作回执待核对");
  if (
    completed &&
    kind === "grant" &&
    (!sourceUuid(v.grantId) ||
      !integer(v.grantRevision) ||
      !["active", "revoked", "pending_owner"].includes(
        String(v.permissionState),
      ))
  )
    throw Error("原授权回执待核对");
  if (completed && kind !== "grant" && !v.domain) {
    if (!sourceUuid(v.manifestId) || !hash(v.rawSha256))
      throw Error("原清单回执待核对");
    if (v.kind === "capture" && v.metadataCapturedComplete !== true)
      throw Error("原来源捕获结果待核对");
    if (
      v.kind === "apply" &&
      (!integer(v.groupRevision) || !Array.isArray(v.groupOutcomes))
    )
      throw Error("原应用回执待核对");
  }
  if (v.domain === "source_icon") sourceIconReceipt(v, id);
  if (v.groupOutcomes !== undefined) rows(v.groupOutcomes);
  return v as unknown as SourceReceipt;
}
export function clearSourceRequests(s: Store, keep?: string) {
  for (const k of Array.from({ length: s.length }, (_, i) => s.key(i)))
    if (k?.startsWith(prefix) && k !== prefix + keep) s.removeItem(k);
}
export function readSourceRequest(
  s: Store,
  scope: string,
): SourcePending | null {
  clearSourceRequests(s, scope);
  const raw = s.getItem(prefix + scope);
  if (!raw) return null;
  const v = object(JSON.parse(raw));
  if (
    !sourceUuid(v.id) ||
    !["grant", "capture", "apply"].includes(String(v.kind)) ||
    Object.keys(v).some(
      (k) => !["id", "kind", "submissionStatus"].includes(k),
    ) ||
    (v.submissionStatus !== undefined &&
      (!integer(v.submissionStatus) || Number(v.submissionStatus) > 599))
  )
    throw Error("原来源操作编号无法读取");
  return v as unknown as SourcePending;
}
export function retainSourceRequest(s: Store, scope: string, v: SourcePending) {
  if (!sourceUuid(v.id)) throw Error("操作编号无效");
  const old = readSourceRequest(s, scope);
  if (old && old.id !== v.id) throw Error("请先核对原来源操作");
  if (
    !["grant", "capture", "apply"].includes(v.kind) ||
    (v.submissionStatus !== undefined &&
      (!integer(v.submissionStatus) || v.submissionStatus > 599))
  )
    throw Error("原操作类型无效");
  s.setItem(
    prefix + scope,
    JSON.stringify({
      id: v.id,
      kind: v.kind,
      ...(v.submissionStatus === undefined
        ? {}
        : { submissionStatus: v.submissionStatus }),
    }),
  );
}
export function releaseSourceRequest(s: Store, scope: string, id: string) {
  const raw = s.getItem(prefix + scope);
  if (raw && object(JSON.parse(raw)).id === id) s.removeItem(prefix + scope);
}
export function sourceReason(code: string | null | undefined) {
  const labels: Record<string, string> = {
    original_record_binding_missing_or_deleted: "原记录尚未映射或已删除",
    original_record_identity_changed: "原记录身份已变化",
    source_group_mapping_unknown: "原分组尚未核对",
    dynamic_market_group_membership_not_supported:
      "市场分组按市场显示，未写入归属",
    mapped_group_changed_or_deleted: "已映射分组已变化或删除",
    canonical_id_exists_without_source_binding: "同编号已有分组，来源尚未核对",
    canonical_name_collision: "名称与现有分组冲突",
    duplicate_source_market: "来源市场分组重复",
    duplicate_source_normalized_name: "来源分组名称重复",
    unsupported_original_id: "来源编号无法使用",
    group_metadata_invalid: "来源分组信息待核对",
    duplicate_original_id: "来源编号重复",
    source_owner_mismatch: "来源账号不符",
    member_metadata_invalid: "来源记录归属信息待核对",
  };
  return code ? (labels[code] ?? "来源仍待核对") : "";
}
export function sourceReceiptLabel(v: SourceReceipt) {
  if (v.domain === "source_icon")
    return sourceIconLabel(sourceIconReceipt(v, v.requestId));
  if (v.state === "reading") return "正在读取";
  if (v.state === "unknown") return "结果未知，读取已关闭";
  if (v.state === "failed") return "操作未完成";
  if (v.permissionState === "revoked") return "来源授权已撤销";
  if (v.permissionState === "active") return "来源授权已确认";
  if (v.permissionState === "pending_owner") return "来源已登记，待本人同意";
  if (v.kind === "capture")
    return v.domain === "source_icon" ? "原图读取结果已保存" : "来源清单已保存";
  return v.state === "completed_with_unknown" ||
    v.state === "completed_with_blocked"
    ? "已核对可用项，仍有未完成项"
    : "分组与归属已核对";
}
export function sourceOutcomes(raw: unknown, id: string) {
  const v = object(raw);
  if (
    v.requestId !== id ||
    !Array.isArray(v.items) ||
    !(v.next === null || integer(v.next))
  )
    throw Error("归属结果待核对");
  const items = v.items.map((value) => {
    const r = object(value);
    if (
      !integer(r.sequence) ||
      !hash(r.source_row_sha256) ||
      !["applied", "unchanged", "unknown"].includes(String(r.state)) ||
      [
        "original_record_id",
        "original_group_id",
        "target_record_id",
        "target_group_id",
        "reason",
      ].some((k) => !(r[k] === null || typeof r[k] === "string"))
    )
      throw Error("归属明细待核对");
    return {
      sequence: r.sequence,
      originalId: r.original_record_id,
      rowSha256: r.source_row_sha256,
      groupId: r.original_group_id,
      targetRecordId: r.target_record_id,
      targetGroupId: r.target_group_id,
      state: r.state,
      reason: r.reason,
    } as SourceRow;
  });
  return { items, next: v.next as number | null };
}
