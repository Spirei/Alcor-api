import assert from "node:assert/strict";
import test from "node:test";
import { ConfirmationState } from "../src/confirmation-state.ts";

test("a later confirmation cancels earlier work and stale accept cannot approve the new action", async () => {
  const state = new ConfirmationState(),
    first = state.begin("删除草稿"),
    second = state.begin("替换草稿");
  assert.equal(await first.promise, false);
  assert.equal(state.settle(first.frame, true), false);
  assert.equal(state.settle(second.frame, true), true);
  assert.equal(await second.promise, true);
});
test("route, identity or visibility cancellation leaves no delayed approval", async () => {
  const state = new ConfirmationState(),
    pending = state.begin("保存前核对");
  state.cancel();
  assert.equal(await pending.promise, false);
  assert.equal(state.settle(pending.frame, true), false);
  state.cancel();
});
test("accepting once cannot execute an action twice", async () => {
  const state = new ConfirmationState(),
    pending = state.begin("继续");
  let writes = 0;
  const done = pending.promise.then((accepted) => {
    if (accepted) writes++;
  });
  assert.equal(state.settle(pending.frame, true), true);
  assert.equal(state.settle(pending.frame, true), false);
  await done;
  assert.equal(writes, 1);
});
test("cancelled action cannot alter the next dialog labels or outcome", async () => {
  const state = new ConfirmationState(),
    cancelled = state.begin("旧操作", { title: "旧标题" });
  state.cancel();
  const next = state.begin("新操作", {
    title: "移除草稿",
    confirmLabel: "明确移除",
  });
  assert.equal(await cancelled.promise, false);
  assert.equal(next.frame.title, "移除草稿");
  assert.equal(next.frame.confirmLabel, "明确移除");
  assert.equal(state.settle(cancelled.frame, true), false);
  state.settle(next.frame, false);
  assert.equal(await next.promise, false);
});
