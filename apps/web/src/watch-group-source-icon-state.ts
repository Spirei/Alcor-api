import { sourceWindowActive } from "./source-window-view.ts";
import { groupIcon, type GroupIcon } from "./watch-group-icon-state.ts";
import type {
  SourceManifest,
  SourceReceipt,
} from "./watch-group-source-state.ts";
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const hash = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const group = (v: unknown): v is string =>
  typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v);
const integer = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) >= 0;
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("原图证据待核对");
  return v as Record<string, unknown>;
};
export type SourceIconCapture = SourceReceipt & {
  domain: "source_icon";
  kind: "capture";
  manifestId: string;
  originalGroupId: string;
  captureState?: "captured" | "blocked" | "empty" | "market_default";
  originalSha256?: string | null;
  originalSize?: number | null;
  originalPath?: string | null;
  sourceReference?: string;
  sourceReferenceKnown?: boolean;
  displayValidated?: false;
  sourceRowSha256?: string;
};
export type SourceIconReceipt =
  | SourceIconCapture
  | (SourceReceipt & {
      domain: "source_icon";
      kind: "apply";
      captureRequestId: string;
      sourceOriginalSha256?: string;
      icon?: GroupIcon;
      httpStatus?: number;
      message?: string;
    });
export type SourceIconProof = {
  captureRequestId: string;
  manifestId: string;
  originalGroupId: string;
  originalSha256: string | null;
  originalSize: number | null;
  targetGroupId: string | null;
  beforeIcon: string | null;
  groupRevision: number;
  replaceCurrent: boolean;
  ready: boolean;
  blocker: string | null;
  preview: string;
  financialApplied: false;
};
export function sourceIconReceipt(raw: unknown, id: string): SourceIconReceipt {
  const v = object(raw),
    complete = [
      "completed",
      "completed_with_blocked",
      "completed_with_unknown",
    ].includes(String(v.state));
  if (
    v.requestId !== id ||
    !uuid(id) ||
    v.domain !== "source_icon" ||
    v.financialApplied !== false ||
    (v.message !== undefined && typeof v.message !== "string") ||
    (v.reason !== undefined &&
      v.reason !== null &&
      typeof v.reason !== "string") ||
    !["capture", "apply"].includes(String(v.kind)) ||
    ![
      "reading",
      "completed",
      "completed_with_blocked",
      "completed_with_unknown",
      "failed",
      "unknown",
    ].includes(String(v.state))
  )
    throw Error("原图回执待核对");
  if (v.kind === "capture") {
    if (!uuid(v.manifestId) || !group(v.originalGroupId))
      throw Error("原图来源归属待核对");
    if (complete) {
      if (
        !["captured", "blocked", "empty", "market_default"].includes(
          String(v.captureState),
        ) ||
        !hash(v.rawSha256) ||
        !hash(v.sourceRowSha256) ||
        typeof v.sourceReference !== "string" ||
        typeof v.sourceReferenceKnown !== "boolean" ||
        v.displayValidated !== false
      )
        throw Error("原图捕获结果待核对");
      if (v.captureState === "captured") {
        if (
          !hash(v.originalSha256) ||
          !integer(v.originalSize) ||
          v.originalSize < 1 ||
          v.originalSize > 2097152 ||
          v.originalPath !==
            "/api/watch-group-import/operations/" + id + "/icon-original"
        )
          throw Error("原图大小或地址待核对");
      } else if (
        v.originalSha256 !== null ||
        v.originalSize !== null ||
        v.originalPath !== null
      )
        throw Error("尚未捕获的原图不能作为文件使用");
    }
  } else {
    if (!uuid(v.captureRequestId)) throw Error("原图操作编号待核对");
    if (v.state === "completed") {
      const media = groupIcon(v.icon);
      if (
        v.sourceOriginalSha256 !== media.originalSha256 ||
        object(v.group).id !== media.groupId ||
        !integer(v.revision)
      )
        throw Error("原图与应用版本不符");
    }
  }
  return v as unknown as SourceIconReceipt;
}
export function sourceIconProof(
  raw: unknown,
  capture: string,
  replace: boolean,
): SourceIconProof {
  const v = object(raw);
  if (
    v.captureRequestId !== capture ||
    !uuid(capture) ||
    !uuid(v.manifestId) ||
    !group(v.originalGroupId) ||
    !(v.targetGroupId === null || group(v.targetGroupId)) ||
    !(v.beforeIcon === null || typeof v.beforeIcon === "string") ||
    !integer(v.groupRevision) ||
    v.replaceCurrent !== replace ||
    typeof v.ready !== "boolean" ||
    !(v.blocker === null || typeof v.blocker === "string") ||
    !hash(v.preview) ||
    v.financialApplied !== false ||
    !(v.originalSha256 === null || hash(v.originalSha256)) ||
    !(
      v.originalSize === null ||
      (integer(v.originalSize) &&
        v.originalSize >= 1 &&
        v.originalSize <= 2097152)
    )
  )
    throw Error("原图预览待核对");
  if (
    v.ready &&
    (!hash(v.originalSha256) ||
      !integer(v.originalSize) ||
      !group(v.targetGroupId) ||
      v.blocker !== null)
  )
    throw Error("原图尚未具备应用条件");
  return v as unknown as SourceIconProof;
}
export function sourceIconCanCapture(
  manifest: SourceManifest | null,
  now = Date.now(),
) {
  const access = manifest?.currentSourceAccess,
    w = access?.window,
    start = Date.parse(w?.notBefore ?? ""),
    end = Date.parse(w?.expiresAt ?? "");
  return (
    !!manifest &&
    access?.grantState === "active" &&
    access.grantRevisionMatches &&
    sourceWindowActive(w) &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start <= now &&
    now < end
  );
}
export function sourceIconLabel(v: SourceIconReceipt) {
  if (v.state === "reading") return "正在读取原图";
  if (v.state === "failed") return "图标操作未完成";
  if (v.state === "unknown") return "图标结果未知，读取已关闭";
  if (v.kind === "apply")
    return v.state === "completed" ? "图标已应用" : "图标仍待核对";
  return {
    captured: "原图已归档",
    blocked: "原图读取受阻",
    empty: "原图为空",
    market_default: "保留市场默认图标",
  }[v.captureState ?? "blocked"];
}
export function sourceIconReason(reason: string | undefined | null) {
  const labels: Record<string, string> = {
    source_icon_root_unsafe: "原图目录无法安全读取",
    source_icon_reference_invalid: "原图引用格式无效",
    source_icon_external_reference_not_allowed: "原图为外部地址，未读取",
    source_icon_owner_group_not_supported: "原账号或分组编号无法用于原图目录",
    source_icon_not_owned_group_path: "原图不属于本人原分组目录",
    source_icon_filename_invalid: "原图文件名无效",
    source_icon_extension_not_supported: "原图类型不支持",
    source_icon_root_identity_changed: "原图目录身份已变化",
    source_icon_directory_unsafe: "原图目录无法安全读取",
    source_icon_file_unsafe_or_too_large: "原图不安全或超过2MiB",
    source_icon_file_changed: "读取时原图已变化",
    source_icon_directory_changed: "读取时原图目录已变化",
    source_icon_registration_invalid: "操作员原图目录登记无效",

    source_original_not_captured: "尚无已捕获原图",
    original_group_binding_missing: "原分组尚未映射",
    custom_group_required: "仅自定义分组可应用原图",
    current_icon_requires_explicit_replacement:
      "当前已有图标，请明确选择是否替换",
    source_icon_reference_missing_or_unsupported_storage:
      "原图引用缺失或存储类型未知",
    source_icon_root_not_registered: "操作员尚未登记原图目录",
    source_icon_path_not_owned_group_upload: "原图引用不属于本人原分组目录",
    source_icon_file_missing_or_unsafe: "原图不存在或无法安全读取",
    client_market_default_no_file: "市场默认图标由客户端保留",
    market_icon_keeps_client_MarketIcon_source_reference_not_imported:
      "保留客户端市场图标，原引用未作为自定义图标导入",
    source_icon_apply_rolled_back: "图标应用未提交",
  };
  return reason ? (labels[reason] ?? "原图仍待核对") : "";
}
