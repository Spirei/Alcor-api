type Store = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
const prefix = "alcor.shared-asset-request:",
  uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const assetKinds = [
  { value: "ico", label: "图标" },
  { value: "background", label: "主页背景" },
  { value: "logo", label: "站点标志" },
  { value: "login", label: "登录页图片" },
  { value: "asset", label: "素材库" },
] as const;
export type AssetKind = (typeof assetKinds)[number]["value"];
export const assetFolders = [
  { value: "", label: "通用" },
  { value: "market", label: "市场" },
  { value: "flag", label: "旗帜" },
  { value: "crypto", label: "加密货币" },
  { value: "metal", label: "贵金属" },
  { value: "stock", label: "股票" },
  { value: "broker", label: "券商" },
  { value: "group", label: "股票分组" },
  { value: "card", label: "卡面" },
] as const;
export type AssetConfig = {
  namespace: "system_public";
  revision: number;
  kinds: Record<AssetKind, { extensions: string[]; maxBytes: number }>;
  cardMaxBytes: number;
};
export type AssetReceipt = {
  requestId: string;
  namespace: "system_public";
  state: "completed" | "failed";
  revision: number;
  httpStatus: number;
  message: string;
  url?: string;
  legacyUrl?: string;
  kind?: AssetKind;
  sha256?: string;
  originalSha256?: string;
  size?: number;
  originalSize?: number;
  version?: string;
  binding?: {
    id: string;
    type: string;
    market: string;
    code: string;
    revision: number;
    imageVersion: string;
  };
};
export function validAssetOperation(id: string) {
  return uuid.test(id);
}
export function clearSharedAssetRequests(s: Store, keep?: string) {
  for (const k of Array.from({ length: s.length }, (_, i) => s.key(i)))
    if (k?.startsWith(prefix) && k !== prefix + keep) s.removeItem(k);
}
export function readSharedAssetRequest(s: Store, scope: string) {
  clearSharedAssetRequests(s, scope);
  const id = s.getItem(prefix + scope);
  if (id !== null && !uuid.test(id)) throw new Error("原素材操作编号无法读取");
  return id;
}
export function retainSharedAssetRequest(s: Store, scope: string, id: string) {
  if (!uuid.test(id)) throw new Error("原操作编号无效");
  const old = readSharedAssetRequest(s, scope);
  if (old && old !== id) throw new Error("请先核对原素材操作");
  s.setItem(prefix + scope, id);
}
export function releaseSharedAssetRequest(s: Store, scope: string, id: string) {
  if (s.getItem(prefix + scope) === id) s.removeItem(prefix + scope);
}
export function sharedAssetConfig(raw: unknown): AssetConfig {
  const v = raw as Partial<AssetConfig> | null;
  if (
    !v ||
    v.namespace !== "system_public" ||
    !Number.isSafeInteger(v.revision) ||
    Number(v.revision) < 0 ||
    !Number.isSafeInteger(v.cardMaxBytes) ||
    Number(v.cardMaxBytes) <= 0 ||
    Number(v.cardMaxBytes) > 20971520
  )
    throw new Error("素材库配置待核对");
  for (const { value } of assetKinds) {
    const kind = v.kinds?.[value];
    if (
      !kind ||
      !Array.isArray(kind.extensions) ||
      !kind.extensions.length ||
      kind.extensions.some(
        (ext) => typeof ext !== "string" || !/^[a-z0-9]+$/.test(ext),
      ) ||
      !Number.isSafeInteger(kind.maxBytes) ||
      kind.maxBytes <= 0 ||
      kind.maxBytes > 20971520
    )
      throw new Error("素材库配置待核对");
  }
  return v as AssetConfig;
}
export function sharedAssetReceipt(raw: unknown, id: string): AssetReceipt {
  const v = raw as AssetReceipt | null;
  if (
    !v ||
    v.requestId !== id ||
    v.namespace !== "system_public" ||
    typeof v.message !== "string" ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 0 ||
    !["completed", "failed"].includes(v.state)
  )
    throw new Error("原素材回执不符，请继续核对");
  if (v.state === "failed") {
    if (
      !Number.isInteger(v.httpStatus) ||
      v.httpStatus < 400 ||
      v.httpStatus > 599
    )
      throw new Error("原素材回执状态不符");
    return v;
  }
  if (
    v.httpStatus !== 200 ||
    !assetKinds.some((k) => k.value === v.kind) ||
    typeof v.legacyUrl !== "string" ||
    !new RegExp("^/uploads/" + v.kind + "/[A-Za-z0-9._/-]+$").test(
      v.legacyUrl,
    ) ||
    v.legacyUrl.includes("..") ||
    !uuid.test(v.version ?? "") ||
    !/^[a-f0-9]{64}$/.test(v.sha256 ?? "") ||
    !/^[a-f0-9]{64}$/.test(v.originalSha256 ?? "") ||
    v.url !== v.legacyUrl + "?sha256=" + v.sha256 ||
    !Number.isSafeInteger(v.originalSize) ||
    Number(v.originalSize) <= 0 ||
    Number(v.originalSize) > 20971520 ||
    !Number.isSafeInteger(v.size) ||
    Number(v.size) <= 0 ||
    Number(v.size) > 21037056
  )
    throw new Error("原素材地址、原件或版本待核对");
  if (v.sha256 === v.originalSha256 && v.size !== v.originalSize)
    throw new Error("原件与展示图大小不符");
  if (v.sha256 !== v.originalSha256 && !v.legacyUrl.endsWith(".svg"))
    throw new Error("素材处理方式待核对");
  if (
    v.binding &&
    (v.kind !== "asset" ||
      v.binding.imageVersion !== v.version ||
      typeof v.binding.id !== "string" ||
      typeof v.binding.type !== "string" ||
      typeof v.binding.market !== "string" ||
      typeof v.binding.code !== "string" ||
      !Number.isSafeInteger(v.binding.revision) ||
      v.binding.revision < 1)
  )
    throw new Error("对应图标的登记结果待核对");
  return v;
}
