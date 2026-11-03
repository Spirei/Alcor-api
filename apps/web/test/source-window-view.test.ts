import assert from "node:assert/strict";
import test from "node:test";
import {
  sourceWindowActive,
  sourceWindowLabel,
} from "../src/source-window-view.ts";
const start = "2026-11-01T00:00:00Z",
  end = "2026-11-02T00:00:00Z";
test("operator cutoff keeps exact Shanghai times without a redundant zone suffix", () => {
  const window = { state: "active", notBefore: start, expiresAt: end };
  assert.ok(sourceWindowActive(window));
  const text = sourceWindowLabel(window);
  assert.ok(text.includes("取数窗口有效"));
  assert.ok(text.includes("2026/11/01"));
  assert.ok(text.includes("2026/11/02"));
  assert.equal((text.match(/08:00:00/g) || []).length, 2);
});
test("expired revoked future and unknown source windows never become new-capture authority or password/network errors", () => {
  for (const state of [
    "expired",
    "revoked",
    "not_started",
    "unknown",
    "unavailable",
  ]) {
    const window = { state, notBefore: start, expiresAt: end };
    assert.equal(sourceWindowActive(window), false);
    const text = sourceWindowLabel(window);
    assert.ok(!text.includes("密码"));
    assert.ok(!text.includes("网络"));
  }
  assert.ok(
    sourceWindowLabel({
      state: "expired",
      notBefore: start,
      expiresAt: end,
    }).includes("已到期"),
  );
  assert.ok(
    sourceWindowLabel({
      state: "revoked",
      notBefore: start,
      expiresAt: end,
    }).includes("已撤销"),
  );
});
test("old or malformed active metadata is unknown rather than a fabricated unlimited window", () => {
  for (const window of [
    undefined,
    { state: "active" },
    { state: "active", notBefore: "bad", expiresAt: end },
    { state: "active", notBefore: "2026-01-01", expiresAt: "2026-01-02" },
    { state: "active", notBefore: end, expiresAt: start },
  ]) {
    assert.equal(sourceWindowActive(window), false);
    assert.ok(!sourceWindowLabel(window).includes("窗口有效"));
  }
});
