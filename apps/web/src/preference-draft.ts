import type { Appearance } from "./appearance-preferences";
export type AvatarStatus = "online" | "focus" | "doNotDisturb";
export type Preferences = {
  appearance: Appearance | null;
  avatar_status: AvatarStatus;
  revision: string | null;
};
export type PreferencePatch = Partial<
  Pick<Preferences, "appearance" | "avatar_status">
>;
export type PreferenceDraft = {
  revision: string | null;
  patch: PreferencePatch;
  base: Preferences;
};
type StorageLike = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
const prefix = "alcor.pending-preferences:";
function canonical(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value))
    return JSON.stringify(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          canonical((value as Record<string, unknown>)[key]),
        ]),
    );
  return JSON.stringify(value);
}
function matches(remote: Preferences, patch: PreferencePatch): boolean {
  return Object.keys(patch).every(
    (key) =>
      canonical(remote[key as keyof PreferencePatch]) ===
      canonical(patch[key as keyof PreferencePatch]),
  );
}
/** A stored draft is an intent, never evidence that PostgreSQL accepted a write. */
export function rebasePreferenceDraft(
  remote: Preferences,
  draft: PreferenceDraft,
  force = false,
): { kind: "saved" | "retry" | "conflict"; patch: PreferencePatch } {
  const conflict = Symbol("conflict");
  function merge(server: unknown, before: unknown, desired: unknown): unknown {
    if (canonical(before) === canonical(desired)) return server;
    if (
      canonical(server) === canonical(before) ||
      canonical(server) === canonical(desired)
    )
      return desired;
    if (
      server &&
      before &&
      desired &&
      typeof server === "object" &&
      typeof before === "object" &&
      typeof desired === "object"
    ) {
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(desired)) {
        result[key] = merge(
          (server as Record<string, unknown>)[key],
          (before as Record<string, unknown>)[key],
          (desired as Record<string, unknown>)[key],
        );
        if (result[key] === conflict) return conflict;
      }
      return result;
    }
    return force ? desired : conflict;
  }
  const patch: PreferencePatch = {};
  for (const key of Object.keys(draft.patch) as (keyof PreferencePatch)[]) {
    const value = merge(remote[key], draft.base[key], draft.patch[key]);
    if (value === conflict) return { kind: "conflict", patch: draft.patch };
    Object.assign(patch, { [key]: value });
  }
  return { kind: matches(remote, patch) ? "saved" : "retry", patch };
}
export function savePreferenceDraft(
  storage: StorageLike,
  scope: string,
  draft: PreferenceDraft | null,
) {
  if (draft) storage.setItem(prefix + scope, JSON.stringify(draft));
  else storage.removeItem(prefix + scope);
}
export function readPreferenceDraft(
  storage: StorageLike,
  scope: string,
  parse: (value: unknown) => Appearance,
): PreferenceDraft | null {
  const raw = storage.getItem(prefix + scope);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (
      !data ||
      typeof data !== "object" ||
      !(
        data.revision === null ||
        (typeof data.revision === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            data.revision,
          ))
      )
    )
      return null;
    const patch = (value: unknown): PreferencePatch | null => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
      const result: PreferencePatch = {},
        fields = value as Record<string, unknown>;
      if ("appearance" in fields) {
        if (
          !fields.appearance ||
          typeof fields.appearance !== "object" ||
          (fields.appearance as { version?: number }).version !== 1
        )
          return null;
        result.appearance = parse(fields.appearance);
      }
      if ("avatar_status" in fields) {
        if (
          !["online", "focus", "doNotDisturb"].includes(
            String(fields.avatar_status),
          )
        )
          return null;
        result.avatar_status = fields.avatar_status as AvatarStatus;
      }
      return Object.keys(result).length ? result : null;
    };
    const pending = patch(data.patch),
      original = patch(data.base);
    if (!pending || !original?.appearance || !original.avatar_status)
      return null;
    return {
      revision: data.revision,
      patch: pending,
      base: {
        appearance: original.appearance,
        avatar_status: original.avatar_status,
        revision: data.revision,
      },
    };
  } catch {
    return null;
  }
}
export function clearPreferenceDrafts(storage: StorageLike) {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const key of keys) if (key?.startsWith(prefix)) storage.removeItem(key);
}
