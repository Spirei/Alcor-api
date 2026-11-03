export type WatchDisplayState = {
  version: number;
  userId: string;
  namespace: "watch";
  fields: Record<string, { revision: number; value: unknown }>;
};
export type WatchDisplayRow = {
  id: string;
  name: string;
  market: string;
  code: string;
};
export const watchField = (root: string, id: string) =>
  JSON.stringify([root, id]);
export function watchDisplayValue(
  snapshot: WatchDisplayState | null,
  root: string,
  id: string,
) {
  return snapshot?.fields[watchField(root, id)]?.value;
}
export function arrangeWatchRows<T extends WatchDisplayRow>(
  snapshot: WatchDisplayState | null,
  rows: T[],
  view = "ALL",
  onlyFollowed = true,
) {
  const raw = watchDisplayValue(snapshot, "orders", view),
    order = Array.isArray(raw) ? raw : [],
    rank = new Map(order.map((id, index) => [id, index]));
  return rows
    .filter(
      (row) =>
        !onlyFollowed || watchDisplayValue(snapshot, "hidden", row.id) !== true,
    )
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        Number(watchDisplayValue(snapshot, "pinned", b.row.id) === true) -
          Number(watchDisplayValue(snapshot, "pinned", a.row.id) === true) ||
        (rank.get(a.row.id) ?? order.length + a.index) -
          (rank.get(b.row.id) ?? order.length + b.index),
    )
    .map((value) => value.row);
}

/** Shared by actual visibility handlers and late-response checks. No polling. */
export class WatchDisplayReadScope {
  generation = 0;
  private present = false;
  private controller: AbortController | null = null;
  presence(active: boolean, visible: boolean) {
    const before = this.present;
    this.present = active && visible;
    if (!this.present) this.invalidate();
    return this.present && !before;
  }
  invalidate() {
    ++this.generation;
    this.controller?.abort();
    this.controller = null;
  }
  begin() {
    this.invalidate();
    this.controller = new AbortController();
    return { generation: this.generation, signal: this.controller.signal };
  }
  current(generation: number) {
    return this.present && generation === this.generation;
  }
}
export function watchRecordsPath(
  path: string,
  enabled: boolean,
  revision: string | null,
) {
  if (!enabled) return path;
  const [pathname, search = ""] = path.split("?");
  const query = new URLSearchParams(search);
  query.set("displayMode", "watch");
  if (Number(query.get("page") || "1") > 1) {
    if (!revision || !/^[a-f0-9]{64}$/.test(revision))
      throw new Error("请先读取关注显示的第一页");
    query.set("displayRevision", revision);
  } else query.delete("displayRevision");
  return pathname + "?" + query;
}
export function allDisplayedRecordsSelected(
  rows: readonly { id: string }[],
  selected: ReadonlySet<string>,
) {
  return rows.length > 0 && rows.every((row) => selected.has(row.id));
}
