import type { Appearance } from "./appearance-preferences";
/** Preserve edits made during the initial PG read without replacing untouched account settings. */
export function mergeAppearanceDraft(
  remote: Appearance,
  initial: Appearance,
  draft: Appearance,
): Appearance {
  function merge(server: unknown, before: unknown, next: unknown): unknown {
    if (JSON.stringify(before) === JSON.stringify(next)) return server;
    if (
      server &&
      before &&
      next &&
      typeof server === "object" &&
      typeof before === "object" &&
      typeof next === "object"
    ) {
      return Object.fromEntries(
        Object.keys(server).map((key) => [
          key,
          merge(
            (server as Record<string, unknown>)[key],
            (before as Record<string, unknown>)[key],
            (next as Record<string, unknown>)[key],
          ),
        ]),
      );
    }
    return next;
  }
  return merge(remote, initial, draft) as Appearance;
}
