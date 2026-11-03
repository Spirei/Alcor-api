import test from "node:test";
import assert from "node:assert/strict";
import {
  apiSessionSnapshot,
  bindApiSession,
  isCurrentApiSession,
} from "../src/api-session.ts";

test("late reads and errors from a prior login cannot enter the current account", () => {
  bindApiSession("session-a");
  const first = apiSessionSnapshot();
  bindApiSession("session-b");
  assert.equal(isCurrentApiSession(first), false);
  const second = apiSessionSnapshot();
  bindApiSession("session-b");
  assert.equal(isCurrentApiSession(second), true);
  bindApiSession(null);
  assert.equal(isCurrentApiSession(second), false);
  bindApiSession("session-a");
  assert.equal(isCurrentApiSession(first), false);
  bindApiSession(null);
});
