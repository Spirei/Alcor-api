type Store = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
const prefix = "alcor.watch-icon-request:",
  uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
  sha = /^[a-f0-9]{64}$/;
export const iconExtensions = ["jpg", "jpeg", "png", "gif", "webp", "svg"];
export type GroupIcon = {
  version: string;
  groupId: string;
  url: string;
  contentPath: string;
  originalPath: string;
  sha256: string;
  originalSha256: string;
  size: number;
  originalSize: number;
  mediaType: string;
};
export type IconReceipt = {
  requestId: string;
  revision: number;
  state?: "completed" | "failed";
  httpStatus?: number;
  message?: string;
  group?: { id: string; icon: string };
  icon?: GroupIcon;
};
export type IconCurrent = {
  revision: number;
  sourceState: "mapped" | "mapped_source_alias" | "empty" | "unmapped";
  group: { id: string; icon: string };
  icon: GroupIcon | null;
  extensions: string[];
  maxBytes: number;
};
export function validIconRequest(id: string) {
  return uuid.test(id);
}
export function clearIconRequests(s: Store, keep?: string) {
  for (const k of Array.from({ length: s.length }, (_, i) => s.key(i)))
    if (k?.startsWith(prefix) && k !== prefix + keep) s.removeItem(k);
}
export function readIconRequest(s: Store, scope: string) {
  clearIconRequests(s, scope);
  const id = s.getItem(prefix + scope);
  if (id !== null && !uuid.test(id)) throw new Error("原图标操作编号无法读取");
  return id;
}
export function retainIconRequest(s: Store, scope: string, id: string) {
  if (!uuid.test(id)) throw new Error("操作编号无效");
  const prior = readIconRequest(s, scope);
  if (prior && prior !== id) throw new Error("请先核对原图标操作");
  s.setItem(prefix + scope, id);
}
export function releaseIconRequest(s: Store, scope: string, id: string) {
  if (s.getItem(prefix + scope) === id) s.removeItem(prefix + scope);
}
export function groupIcon(raw: unknown): GroupIcon {
  const v = raw as GroupIcon | null;
  if (
    !v ||
    !uuid.test(v.version) ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(v.groupId) ||
    !sha.test(v.sha256) ||
    !sha.test(v.originalSha256) ||
    !Number.isSafeInteger(v.size) ||
    v.size < 1 ||
    v.size > 2162688 ||
    !Number.isSafeInteger(v.originalSize) ||
    v.originalSize < 1 ||
    v.originalSize > 2097152 ||
    ![
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/svg+xml",
    ].includes(v.mediaType)
  )
    throw new Error("图标版本与原件待核对");
  const path = "/api/watch-groups/" + v.groupId + "/icons/" + v.version;
  if (
    v.contentPath !== path + "/content" ||
    v.originalPath !== path + "/original" ||
    typeof v.url !== "string" ||
    !/^\/uploads\/asset\/group\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+\?sha256=[a-f0-9]{64}$/.test(
      v.url,
    ) ||
    v.url.includes("..") ||
    !v.url.endsWith("?sha256=" + v.sha256) ||
    v.url.split("/")[5] !== v.groupId ||
    (v.sha256 === v.originalSha256 && v.size !== v.originalSize) ||
    (v.sha256 !== v.originalSha256 && v.mediaType !== "image/svg+xml")
  )
    throw new Error("图标地址或派生关系不符");
  return v;
}
export function iconCurrent(raw: unknown, id: string): IconCurrent {
  const v = raw as IconCurrent | null;
  if (
    !v ||
    v.group?.id !== id ||
    typeof v.group.icon !== "string" ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 0 ||
    !["mapped", "mapped_source_alias", "empty", "unmapped"].includes(v.sourceState) ||
    v.maxBytes !== 2097152 ||
    !Array.isArray(v.extensions) ||
    v.extensions.length !== iconExtensions.length ||
    v.extensions.some((ext) => !iconExtensions.includes(ext))
  )
    throw new Error("分组图标状态待核对");
  if (v.icon) {
    const media = groupIcon(v.icon);
    if (
      media.groupId !== id ||
      !["mapped","mapped_source_alias"].includes(v.sourceState) ||
      (v.sourceState === "mapped" && v.group.icon !== media.url)
    )
      throw new Error("图标归属不符");
  } else if (
    ["mapped","mapped_source_alias"].includes(v.sourceState) ||
    (v.sourceState === "empty") !== !v.group.icon
  )
    throw new Error("图标状态不符");
  return v;
}
export function iconReceipt(raw: unknown, id: string): IconReceipt {
  const v = raw as IconReceipt | null;
  if (
    !v ||
    v.requestId !== id ||
    !uuid.test(id) ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 0
  )
    throw new Error("原图标回执不符，请继续核对");
  if (v.state === "failed") {
    if (
      !Number.isInteger(v.httpStatus) ||
      Number(v.httpStatus) < 400 ||
      Number(v.httpStatus) > 599 ||
      typeof v.message !== "string"
    )
      throw new Error("图标失败回执待核对");
    return v;
  }
  if (
    !v.group ||
    typeof v.group.id !== "string" ||
    typeof v.group.icon !== "string"
  )
    throw new Error("原图标回执结果待核对");
  if (v.icon) {
    const media = groupIcon(v.icon);
    if (
      v.state !== "completed" ||
      v.httpStatus !== 200 ||
      media.groupId !== v.group.id ||
      media.url !== v.group.icon
    )
      throw new Error("图标回执归属不符");
  } else if (v.group.icon !== "") throw new Error("清空图标的回执待核对");
  return v;
}
