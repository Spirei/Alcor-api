import test from "node:test";
import assert from "node:assert/strict";
import {
  clearPersonalProfileRequests,
  restorePersonalProfileRequest,
} from "../src/personal-profile-state.ts";
function storage() {
  const value = Object.create(null);
  Object.defineProperties(value, {
    getItem: { value: (key) => value[key] ?? null },
    setItem: {
      value: (key, item) => {
        value[key] = item;
      },
    },
    removeItem: {
      value: (key) => {
        delete value[key];
      },
    },
  });
  return value;
}
test("identity changes retain only the current original profile operation", () => {
  const s = storage();
  const first = "alcor.personal-profile.first",
    second = "alcor.personal-profile.second";
  const id = "00000000-0000-4000-8000-000000000001";
  s.setItem(first, id);
  s.setItem(first + ".replace", "true");
  s.setItem(second, id);
  s.setItem(second + ".replace", "false");
  assert.equal(restorePersonalProfileRequest(s, second), id);
  assert.equal(s.getItem(first), null);
  assert.equal(s.getItem(first + ".replace"), null);
  assert.equal(s.getItem(second + ".replace"), "false");
});
test("invalid original locator cannot be silently replaced by a new write", () => {
  const s = storage(),
    key = "alcor.personal-profile.current";
  s.setItem(key, "invalid");
  assert.throws(() => restorePersonalProfileRequest(s, key));
  assert.equal(s.getItem(key), "invalid");
});
test("logout removes profile operation locators without deleting other storage", () => {
  const s = storage();
  s.setItem("alcor.personal-profile.old", "id");
  s.setItem("alcor.personal-profile.old.replace", "true");
  s.setItem("appearance", "dark");
  clearPersonalProfileRequests(s);
  assert.equal(s.getItem("alcor.personal-profile.old"), null);
  assert.equal(s.getItem("alcor.personal-profile.old.replace"), null);
  assert.equal(s.getItem("appearance"), "dark");
});
