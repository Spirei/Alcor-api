import test from "node:test";
import assert from "node:assert/strict";
import { emailReadGate } from "../src/email-change-read.ts";

test("a refresh aborts and rejects a late older reply", () => {
  const gate = emailReadGate();
  const old = gate.begin();
  const next = gate.begin();
  assert.equal(old.signal.aborted, true);
  assert.equal(old.current(), false);
  assert.equal(next.current(), true);
});

test("hiding or an identity boundary invalidates all prior security reads", () => {
  const gate = emailReadGate();
  const old = gate.begin();
  gate.invalidate();
  assert.equal(old.signal.aborted, true);
  assert.equal(old.current(), false);
  const resumed = gate.begin();
  assert.equal(resumed.current(), true);
  assert.equal(old.current(), false);
});
