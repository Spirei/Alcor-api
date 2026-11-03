import test from "node:test";
import assert from "node:assert/strict";
import { estimateStrength } from "../src/password-strength-estimator.ts";

test("common, keyboard, repeated and long sequential passwords remain weak", () => {
  for (const password of [
    "Password123!",
    "qwertyuiop",
    "aaaaaaaaaaaa",
    "0123456789".repeat(10),
  ]) {
    assert.ok(estimateStrength(password) <= 1);
  }
});

test("a varied synthetic password receives the high score expected by the UI", () => {
  assert.equal(estimateStrength("mK7@vQ4!rT9#xP2$"), 4);
});

test("username context lowers predictable scores without contaminating another evaluation", () => {
  const example = "saffronorbitcactus";
  const original = estimateStrength(example);
  assert.ok(estimateStrength(example, example) < original);
  assert.equal(estimateStrength(example, "unrelated-user"), original);
  assert.equal(estimateStrength(example), original);
});

test("Chinese and emoji input returns a valid score without changing the input", () => {
  const example = "森林A7!星河🌌海洋";
  const score = estimateStrength(example, "星河");
  assert.ok(Number.isInteger(score) && score >= 0 && score <= 4);
  assert.equal(example, "森林A7!星河🌌海洋");
});

test("analysis is bounded to the same 128 UTF-16 units as the form", () => {
  const prefix = "qwerty".repeat(22).slice(0, 128);
  assert.equal(
    estimateStrength(prefix + "synthetic-tail-ignored"),
    estimateStrength(prefix),
  );
});
