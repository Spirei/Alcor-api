const aliasPattern = /^[a-z0-9][a-z0-9-]{0,62}$/;
const idPattern = /^[a-f0-9]{32}$/;
const shaPattern = /^[a-f0-9]{64}$/;
const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export type SourceIndex = {
  configuration: { state: "configured" | "not_configured" };
  sources: { sourceAlias: string }[];
};

export type ReadySourceRow = {
  originalId: string;
  name: string;
  platform: "Android" | "iOS";
  size: number;
  createdAt: string;
  revision: string;
  state: "ready_for_capture" | "captured";
  contentVerified: boolean;
  historicalUploaderVerified: false;
};

export type BlockedSourceRow = {
  originalId: string;
  state: "blocked";
  reason: "source_metadata_or_original_invalid";
  contentVerified: false;
  historicalUploaderVerified: false;
};

export type SourceRow = ReadySourceRow | BlockedSourceRow;

export type SourceCatalog = {
  sourceAlias: string;
  revision: string;
  rows: SourceRow[];
  truncated: boolean;
  ignoredEntries: number;
  scanComplete: boolean;
  captured: false;
};

export type SourcePreview = {
  requestId: string;
  originalId: string;
  sourceAlias: string;
  name: string;
  platform: "Android" | "iOS";
  size: number;
  sha256: string;
  sourceCreatedAt: string;
  contentVerified: true;
  historicalUploaderVerified: false;
  state: "preview" | "captured";
};

function invalid(): never {
  throw new Error("安装包来源无效");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function bytes(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > 2147483648
  )
    invalid();
  return value;
}

function packageFields(row: Record<string, unknown>): {
  name: string;
  platform: "Android" | "iOS";
  createdAt: string;
  size: number;
} {
  const name = row.name;
  if (row.platform !== "Android" && row.platform !== "iOS") invalid();
  const platform = row.platform;
  const createdAt = row.createdAt ?? row.sourceCreatedAt;
  if (
    typeof name !== "string" ||
    name.length < 1 ||
    name.length > 240 ||
    /[\\/\u0000-\u001f\u007f]/.test(name) ||
    typeof createdAt !== "string" ||
    createdAt.length < 20 ||
    createdAt.length > 64
  )
    invalid();
  return { name, platform, createdAt, size: bytes(row.size) };
}

export function sourceIndex(value: unknown): SourceIndex {
  const row = record(value);
  const configuration = record(row.configuration);
  const state = configuration.state;
  if (state !== "configured" && state !== "not_configured") invalid();
  if (!Array.isArray(row.sources)) invalid();
  if (state === "not_configured" && row.sources.length !== 0) invalid();
  const sources = row.sources.map((item) => {
    const source = record(item);
    if (
      typeof source.sourceAlias !== "string" ||
      !aliasPattern.test(source.sourceAlias)
    )
      invalid();
    return { sourceAlias: source.sourceAlias };
  });
  return { configuration: { state }, sources };
}

export function sourceCatalog(value: unknown): SourceCatalog {
  const row = record(value);
  if (
    typeof row.sourceAlias !== "string" ||
    !aliasPattern.test(row.sourceAlias) ||
    typeof row.revision !== "string" ||
    !shaPattern.test(row.revision) ||
    typeof row.truncated !== "boolean" ||
    typeof row.scanComplete !== "boolean" ||
    row.scanComplete === row.truncated ||
    row.captured !== false ||
    typeof row.ignoredEntries !== "number" ||
    !Number.isSafeInteger(row.ignoredEntries) ||
    row.ignoredEntries < 0 ||
    !Array.isArray(row.rows) ||
    row.rows.length > 100
  )
    invalid();
  return {
    sourceAlias: row.sourceAlias,
    revision: row.revision,
    truncated: row.truncated,
    ignoredEntries: row.ignoredEntries,
    scanComplete: row.scanComplete,
    captured: false,
    rows: row.rows.map(sourceRow),
  };
}

function sourceRow(value: unknown): SourceRow {
  const row = record(value);
  if (typeof row.originalId !== "string" || !idPattern.test(row.originalId))
    invalid();
  if (
    row.historicalUploaderVerified !== false ||
    (row.contentVerified !== false && row.contentVerified !== true)
  )
    invalid();
  if (row.state === "blocked") {
    if (
      row.reason !== "source_metadata_or_original_invalid" ||
      row.contentVerified !== false
    )
      invalid();
    return {
      originalId: row.originalId,
      state: "blocked",
      reason: "source_metadata_or_original_invalid",
      contentVerified: false,
      historicalUploaderVerified: false,
    };
  }
  if (row.state !== "ready_for_capture" && row.state !== "captured") invalid();
  if (typeof row.revision !== "string" || !shaPattern.test(row.revision))
    invalid();
  if (row.state === "ready_for_capture" && row.contentVerified !== false)
    invalid();
  if (row.state === "captured" && row.contentVerified !== true) invalid();
  const fields = packageFields(row);
  return {
    originalId: row.originalId,
    ...fields,
    createdAt: fields.createdAt,
    revision: row.revision,
    state: row.state,
    contentVerified: row.contentVerified,
    historicalUploaderVerified: false,
  };
}

export function sourcePreview(
  value: unknown,
  requestId: string,
  originalId: string,
): SourcePreview {
  const row = record(value);
  if (
    row.requestId !== requestId ||
    !uuidPattern.test(requestId) ||
    row.originalId !== originalId ||
    typeof row.sourceAlias !== "string" ||
    !aliasPattern.test(row.sourceAlias) ||
    typeof row.sha256 !== "string" ||
    !shaPattern.test(row.sha256) ||
    row.contentVerified !== true ||
    row.historicalUploaderVerified !== false ||
    (row.state !== "preview" && row.state !== "captured")
  )
    invalid();
  const fields = packageFields(row);
  const created = row.sourceCreatedAt;
  if (typeof created !== "string") invalid();
  return {
    requestId,
    originalId,
    sourceAlias: row.sourceAlias,
    name: fields.name,
    platform: fields.platform,
    size: fields.size,
    sha256: row.sha256,
    sourceCreatedAt: created,
    contentVerified: true,
    historicalUploaderVerified: false,
    state: row.state,
  };
}

export function sourceReceipt(value: unknown, requestId: string) {
  const row = record(value);
  if (typeof row.originalId !== "string") invalid();
  return sourcePreview(value, requestId, row.originalId);
}

export function sourceIndexLabel(value: SourceIndex) {
  if (
    value.configuration.state === "not_configured" ||
    value.sources.length === 0
  )
    return "尚未登记安装包来源";
  return `已登记 ${value.sources.length} 个来源`;
}

export function sourceCatalogLabel(value: SourceCatalog) {
  const saved = value.rows.filter((row) => row.state === "captured").length;
  const ready = value.rows.filter(
    (row) => row.state === "ready_for_capture",
  ).length;
  const blocked = value.rows.filter((row) => row.state === "blocked").length;
  const parts = [];
  if (saved) parts.push(`已保存 ${saved} 个原件`);
  if (ready) parts.push(`可预览 ${ready} 个`);
  if (blocked) parts.push(`${blocked} 个未能核对`);
  if (value.ignoredEntries) parts.push(`另有 ${value.ignoredEntries} 项未识别`);
  const body = parts.length ? parts.join("，") : "此页没有可捕获的原件";
  const tail = value.scanComplete ? "" : "，目录尚未读完";
  return `${body}。历史上传人尚未核验${tail}`;
}

export function sourceRowLabel(row: SourceRow) {
  if (row.historicalUploaderVerified !== false) invalid();
  if (row.state === "blocked") return "原件未能核对";
  if (row.state === "captured") return "已保存原件，历史上传人尚未核验";
  return "可预览原件，历史上传人尚未核验";
}
