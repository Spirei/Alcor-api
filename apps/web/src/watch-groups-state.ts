import { watchRecordsPath } from "./watch-display-state.ts";
type Store = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
const prefix = "alcor.watch-group-request:";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export type WatchGroup = {
  id: string;
  name: string;
  sort: number;
  visible: -1 | 0 | 1;
  kind: "market" | "custom";
  market: string | null;
  revision: number;
};
export type GroupListing = {
  groups: WatchGroup[];
  revision: number;
  initialized: boolean;
};
export type WatchGroupEdit = {
  name: string;
  visible: string;
  expectedRevision?: number;
};
export function groupEdit(
  list: GroupListing,
  id: string,
  patch: WatchGroupEdit,
  previous?: WatchGroupEdit,
): WatchGroupEdit {
  if (!list.groups.some((group) => group.id === id))
    throw new Error("分组已变化，请重新核对");
  return {
    ...patch,
    expectedRevision: previous?.expectedRevision ?? list.revision,
  };
}
/** Only an explicit review of this exact fresh listing can rebase a preserved draft. */
export function reviewedGroupEdit(
  list: GroupListing,
  id: string,
  edit: WatchGroupEdit,
  confirmedRevision: number,
): WatchGroupEdit {
  if (
    confirmedRevision !== list.revision ||
    !list.groups.some((group) => group.id === id)
  )
    throw new Error("分组已再次变化，请重新核对");
  return { ...edit, expectedRevision: confirmedRevision };
}
export type GroupRecord = {
  id: string;
  name: string;
  code: string;
  market: string;
  watchGroupId: string;
};
export type GroupRecords = {
  displayMode?: "all" | "watch";
  displayRevision?: string | null;
  membershipBasis?: string;
  records: GroupRecord[];
  total: number;
  page: number;
  pageSize: number;
  collectionRevision: number;
};
export type GroupReceipt = {
  requestId: string;
  revision: number;
  group?: WatchGroup;
  initialized?: true;
  deleted?: boolean;
  updated?: number;
  collectionRevision?: number;
};
export type GroupAction =
  "initialize" | "create" | "update" | "delete" | "reorder" | "assign";
export const visibilityOptions = [
  { value: "-1", label: "自动（空分组隐藏）" },
  { value: "1", label: "显示" },
  { value: "0", label: "隐藏" },
] as const;
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
function validGroup(value: unknown): value is WatchGroup {
  const v = value as WatchGroup | null;
  return (
    !!v &&
    typeof v.id === "string" &&
    !!v.id &&
    v.id.length <= 100 &&
    typeof v.name === "string" &&
    !!v.name &&
    integer(v.sort) &&
    [-1, 0, 1].includes(v.visible) &&
    ["market", "custom"].includes(v.kind) &&
    (v.market === null || typeof v.market === "string") &&
    integer(v.revision)
  );
}
export function groupListing(raw: unknown): GroupListing {
  const v = raw as GroupListing | null;
  if (
    !v ||
    !integer(v.revision) ||
    typeof v.initialized !== "boolean" ||
    !Array.isArray(v.groups) ||
    v.groups.some((g) => !validGroup(g)) ||
    new Set(v.groups.map((g) => g.id)).size !== v.groups.length
  )
    throw new Error("分组列表待核对");
  return v;
}
export function groupRecords(raw: unknown, page: number): GroupRecords {
  const v = raw as GroupRecords | null;
  if (
    !v ||
    !integer(v.collectionRevision) ||
    (v.displayMode !== undefined &&
      v.displayMode !== "all" &&
      v.displayMode !== "watch") ||
    (v.displayMode === "watch" && !v.displayRevision) ||
    (v.displayRevision != null &&
      (typeof v.displayRevision !== "string" ||
        !/^([a-f0-9]{64})$/.test(v.displayRevision))) ||
    !integer(v.total) ||
    v.page !== page ||
    !integer(v.pageSize) ||
    v.pageSize < 1 ||
    v.pageSize > 100 ||
    !Array.isArray(v.records) ||
    v.records.length > v.pageSize ||
    v.records.some(
      (r) =>
        !r ||
        [r.id, r.name, r.code, r.market, r.watchGroupId].some(
          (s) => typeof s !== "string",
        ) ||
        !r.id,
    ) ||
    new Set(v.records.map((r) => r.id)).size !== v.records.length ||
    v.total < v.records.length
  )
    throw new Error("记录列表待核对");
  return {
    total: v.total,
    page: v.page,
    pageSize: v.pageSize,
    collectionRevision: v.collectionRevision,
    ...(v.displayMode !== undefined ? { displayMode: v.displayMode } : {}),
    displayRevision: v.displayRevision,
    membershipBasis: v.membershipBasis,
    records: v.records.map(({ id, name, code, market, watchGroupId }) => ({
      id,
      name,
      code,
      market,
      watchGroupId,
    })),
  };
}
export function groupReceipt(raw: unknown, id: string): GroupReceipt {
  const v = raw as GroupReceipt | null;
  if (
    !v ||
    v.requestId !== id ||
    !validGroupRequest(id) ||
    !integer(v.revision) ||
    (v.group !== undefined && !validGroup(v.group)) ||
    (v.initialized !== undefined && v.initialized !== true) ||
    (v.deleted !== undefined && typeof v.deleted !== "boolean") ||
    (v.updated !== undefined && !integer(v.updated)) ||
    (v.collectionRevision !== undefined && !integer(v.collectionRevision)) ||
    !(
      v.group ||
      v.initialized === true ||
      typeof v.deleted === "boolean" ||
      integer(v.updated)
    )
  )
    throw new Error("原分组回执编号或结果不符，请继续核对");
  return v;
}
export function validGroupRequest(id: string) {
  return uuid.test(id);
}
export function clearGroupRequests(s: Store, keep?: string) {
  for (const k of Array.from({ length: s.length }, (_, i) => s.key(i)))
    if (k?.startsWith(prefix) && k !== prefix + keep) s.removeItem(k);
}
export function readGroupRequest(s: Store, scope: string) {
  clearGroupRequests(s, scope);
  const id = s.getItem(prefix + scope);
  if (id !== null && !uuid.test(id)) throw new Error("原分组操作编号无法读取");
  return id;
}
export function retainGroupRequest(s: Store, scope: string, id: string) {
  if (!uuid.test(id)) throw new Error("操作编号无效");
  const prior = readGroupRequest(s, scope);
  if (prior && prior !== id) throw new Error("请先核对原分组操作");
  s.setItem(prefix + scope, id);
}
export function releaseGroupRequest(s: Store, scope: string, id: string) {
  if (s.getItem(prefix + scope) === id) s.removeItem(prefix + scope);
}
export function groupName(raw: string) {
  if (typeof raw !== "string") throw new Error("分组名称无效");
  const name = raw.trim();
  if (!name || name.length > 30 || /[\x00-\x1f\x7f]/.test(name))
    throw new Error("分组名称需为 1–30 个字符");
  return name;
}
export function groupLabel(id: string, groups: readonly WatchGroup[]) {
  return !id
    ? "未分组"
    : (groups.find((g) => g.id === id)?.name ?? "分组待核对 · " + id);
}
export function groupCommand(
  list: GroupListing,
  action: GroupAction,
  fields: Record<string, unknown>,
  requestId: string,
  records?: GroupRecords | null,
) {
  if (!validGroupRequest(requestId) || !integer(list.revision))
    throw new Error("请先读取分组列表");
  let data: Record<string, unknown>;
  const found = list.groups.find((g) => g.id === fields.id);
  if (action === "initialize") data = {};
  else if (action === "create")
    data = { name: groupName(fields.name as string) };
  else if (action === "update") {
    if (!found) throw new Error("分组已变化，请刷新核对");
    if (!["-1", "0", "1"].includes(String(fields.visible)))
      throw new Error("请选择分组显示方式");
    data = {
      id: found.id,
      name: groupName(fields.name as string),
      visible: Number(fields.visible),
    };
  } else if (action === "delete") {
    if (!found || found.kind !== "custom")
      throw new Error("仅自定义分组可删除");
    data = { id: found.id };
  } else if (action === "reorder") {
    const order = fields.order;
    if (
      !Array.isArray(order) ||
      !order.length ||
      order.length > 100 ||
      new Set(order).size !== order.length ||
      order.some((id) => !list.groups.some((g) => g.id === id))
    )
      throw new Error("分组顺序待核对");
    data = { order };
  } else {
    const ids = fields.ids,
      groupId = fields.groupId;
    if (
      !records ||
      !integer(records.collectionRevision) ||
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 2000 ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !records.records.some((r) => r.id === id)) ||
      typeof groupId !== "string" ||
      (groupId !== "" &&
        !list.groups.some((g) => g.id === groupId && g.kind === "custom"))
    )
      throw new Error("请重新读取记录并选择自定义分组");
    data = { ids, groupId, collectionRevision: records.collectionRevision };
  }
  const expectedRevision =
    action === "update" && fields.expectedRevision !== undefined
      ? fields.expectedRevision
      : list.revision;
  if (!integer(expectedRevision) || Number(expectedRevision) > list.revision)
    throw new Error("分组版本待核对");
  return { requestId, expectedRevision, action, data };
}
export function groupRecordsPath(
  page: number,
  collectionRevision: number | null,
  view: string,
  account: string,
  displayRevision: string | null = null,
  displayMode: "all" | "watch" = "all",
) {
  if (page > 1 && collectionRevision === null)
    throw new Error("请先读取第一页");
  const query = new URLSearchParams({
    page: String(page),
    pageSize: "25",
    view,
  });
  if (page > 1) query.set("collectionRevision", String(collectionRevision));
  if (page > 1 && displayRevision)
    query.set("displayRevision", displayRevision);
  if (account) query.set("brokerAccountId", account);
  return watchRecordsPath(
    "/portfolio/records?" + query,
    displayMode === "watch",
    displayRevision,
  );
}
