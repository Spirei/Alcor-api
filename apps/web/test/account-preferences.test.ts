import test from "node:test";
import assert from "node:assert/strict";
import { mergeAppearanceDraft } from "../src/account-preference-merge.ts";
import {
  defaultAppearance,
  presetPalette,
} from "../src/appearance-preferences.ts";
test("a sidebar edit during the PG read preserves the stored account theme and typography", () => {
  const before = defaultAppearance(),
    stored = defaultAppearance();
  stored.shared = presetPalette("meta", "dark");
  stored.contentSize = 18;
  stored.mode = "dark";
  const draft = { ...before, sidebarCollapsed: true };
  const merged = mergeAppearanceDraft(stored, before, draft);
  assert.equal(merged.sidebarCollapsed, true);
  assert.deepEqual(merged.shared, stored.shared);
  assert.equal(merged.contentSize, 18);
  assert.equal(merged.mode, "dark");
});
test("an early palette font edit does not overwrite the server's accent or theme", () => {
  const before = defaultAppearance(),
    stored = defaultAppearance();
  stored.shared = presetPalette("meta", "light");
  const draft = {
    ...before,
    shared: { ...before.shared, font: "serif" as const },
  };
  const merged = mergeAppearanceDraft(stored, before, draft);
  assert.equal(merged.shared.font, "serif");
  assert.equal(merged.shared.theme, "meta");
  assert.equal(merged.shared.accent, stored.shared.accent);
});
