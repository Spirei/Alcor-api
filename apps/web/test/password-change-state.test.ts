import assert from "node:assert/strict";
import test from "node:test";
import { passwordChangeGate } from "../src/password-change-state.ts";

test("network timeout server error and changed-session outcomes never allow another write", () => {
  for (const failure of [
    undefined,
    { status: 0 },
    { status: 503 },
    { status: 408 },
    { status: 409, code: "session_changed" },
  ]) {
    const gate = passwordChangeGate(),
      ticket = gate.begin()!;
    assert.equal(gate.begin(), null);
    assert.equal(gate.settle(ticket, false, failure), true);
    assert.equal(gate.phase(), "unknown");
    assert.equal(gate.begin(), null);
  }
});
test("explicit rejected validation or proof permits only a new user initiated attempt", () => {
  for (const status of [400, 401, 403, 409, 413, 422, 429]) {
    const gate = passwordChangeGate(),
      ticket = gate.begin()!;
    assert.equal(gate.settle(ticket, false, { status }), true);
    assert.equal(gate.phase(), "idle");
    assert.notEqual(gate.begin(), ticket);
  }
});
test("hiding or leaving an in-flight password action makes late success untrusted", () => {
  const gate = passwordChangeGate(),
    ticket = gate.begin()!;
  gate.interrupt();
  assert.equal(gate.phase(), "unknown");
  assert.equal(gate.settle(ticket, true), false);
  assert.equal(gate.begin(), null);
});
test("hiding an idle form does not invent an unknown request", () => {
  const gate = passwordChangeGate();
  gate.interrupt();
  assert.equal(gate.phase(), "idle");
  assert.notEqual(gate.begin(), null);
});
test("only current confirmed success yields done and blocks a duplicate submission", () => {
  const gate = passwordChangeGate(),
    ticket = gate.begin()!;
  assert.equal(gate.settle(ticket + 1, true), false);
  assert.equal(gate.phase(), "sending");
  assert.equal(gate.settle(ticket, true), true);
  assert.equal(gate.phase(), "done");
  assert.equal(gate.begin(), null);
});
