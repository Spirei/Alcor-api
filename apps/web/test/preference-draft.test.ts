import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultAppearance,
  parseAppearance,
} from "../src/appearance-preferences.ts";
import {
  rebasePreferenceDraft,
  savePreferenceDraft,
  readPreferenceDraft,
  clearPreferenceDrafts,
} from "../src/preference-draft.ts";
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
const before = defaultAppearance(),
  next = { ...before, mode: "light" as const };
const snapshot = (
  appearance = before,
  revision: string | null = a,
  avatar_status: "online" | "focus" | "doNotDisturb" = "online",
) => ({ appearance, revision, avatar_status });
const draft = (appearance = next) => ({
  revision: a,
  base: snapshot(),
  patch: { appearance },
});
test("reload resumes an uncommitted intent and recognizes a write already accepted by PG", () => {
  assert.equal(rebasePreferenceDraft(snapshot(), draft()).kind, "retry");
  assert.equal(rebasePreferenceDraft(snapshot(next, b), draft()).kind, "saved");
});
test("a refresh after the first serialized save preserves the later queued selection", () => {
  const head = { ...before, contrast: 70 },
    tail = { ...head, mode: "light" as const };
  const result = rebasePreferenceDraft(snapshot(head, b), draft(tail));
  assert.equal(result.kind, "retry");
  assert.deepEqual(result.patch.appearance, tail);
});
test("a non-overlapping change from another browser is preserved while resuming local edits", () => {
  const foreign = { ...before, contentSize: 20 };
  const result = rebasePreferenceDraft(snapshot(foreign, b), draft());
  assert.equal(result.kind, "retry");
  assert.equal(result.patch.appearance?.contentSize, 20);
  assert.equal(result.patch.appearance?.mode, "light");
});
test("concurrent edits to the same field stop until explicit confirmation, preserving unrelated fields", () => {
  const foreign = { ...before, contrast: 80, contentSize: 20 },
    pending = draft({ ...before, contrast: 70 });
  assert.equal(
    rebasePreferenceDraft(snapshot(foreign, b), pending).kind,
    "conflict",
  );
  const confirmed = rebasePreferenceDraft(snapshot(foreign, b), pending, true);
  assert.equal(confirmed.patch.appearance?.contrast, 70);
  assert.equal(confirmed.patch.appearance?.contentSize, 20);
});
test("PG JSON ordering does not make a committed preference look unsaved", () => {
  const reordered = {
    ...next,
    shared: Object.fromEntries(Object.entries(next.shared).reverse()),
  } as typeof next;
  assert.equal(
    rebasePreferenceDraft(snapshot(reordered, b), draft()).kind,
    "saved",
  );
});
test("avatar status conflicts do not silently replace another device's selection", () => {
  assert.equal(
    rebasePreferenceDraft(snapshot(before, b, "doNotDisturb"), {
      revision: a,
      base: snapshot(),
      patch: { avatar_status: "focus" },
    }).kind,
    "conflict",
  );
});
function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
    key: (n: number) => [...values.keys()][n] ?? null,
    get length() {
      return values.size;
    },
  };
}
test("drafts retain their base and are isolated by identity/session; logout preserves unrelated storage", () => {
  const store = memory();
  store.setItem("unrelated", "preserve");
  savePreferenceDraft(store, "instance/user/session-a", draft());
  assert.deepEqual(
    readPreferenceDraft(store, "instance/user/session-a", parseAppearance),
    draft(),
  );
  assert.equal(
    readPreferenceDraft(store, "instance/peer/session-b", parseAppearance),
    null,
  );
  clearPreferenceDrafts(store);
  assert.equal(store.getItem("unrelated"), "preserve");
  assert.equal(store.length, 1);
});
