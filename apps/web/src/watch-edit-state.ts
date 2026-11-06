import {
  watchDisplayValue,
  watchField,
  type WatchDisplayState,
} from "./watch-display-state.ts";

const fields = { alias: "aliases", note: "notes", move: "moved" } as const;
export type WatchRowDraft = {
  alias: string;
  note: string;
  move: string;
  revisions: Record<keyof typeof fields, number>;
};
export function watchRowDraft(
  snapshot: WatchDisplayState,
  id: string,
): WatchRowDraft {
  const text = (name: keyof typeof fields) => {
    const value = watchDisplayValue(snapshot, fields[name], id);
    return typeof value === "string" ? value : "";
  };
  return {
    alias: text("alias"),
    note: text("note"),
    move: text("move"),
    revisions: Object.fromEntries(
      Object.entries(fields).map(([name, root]) => [
        name,
        snapshot.fields[watchField(root, id)]?.revision ?? 0,
      ]),
    ) as WatchRowDraft["revisions"],
  };
}
/** A background read can update display values, but must not rebase an unsaved edit. */
export function reconcileWatchDrafts(
  drafts: Record<string, WatchRowDraft>,
  snapshot: WatchDisplayState | null,
) {
  if (!snapshot) return {};
  return Object.fromEntries(
    Object.entries(drafts).filter(([id, draft]) => {
      const current = watchRowDraft(snapshot, id);
      return (Object.keys(fields) as (keyof typeof fields)[]).some(
        (name) => current[name] !== draft[name],
      );
    }),
  );
}
export function watchDraftChanges(
  draft: WatchRowDraft,
  id: string,
  names: (keyof typeof fields)[],
) {
  return names.map((name) => ({
    key: watchField(fields[name], id),
    value: draft[name] || null,
    revision: draft.revisions[name],
  }));
}
