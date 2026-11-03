import test from "node:test";
import assert from "node:assert/strict";
import {
  interruptedRecovery,
  observeRecoveryPrivacy,
} from "../src/password-recovery-state.ts";

test("interruption never treats an in-flight password mutation as uncommitted", () => {
  assert.equal(interruptedRecovery("confirm", true), "unknown");
  assert.equal(interruptedRecovery("confirm", false), "request");
  assert.equal(interruptedRecovery("request", true), "request");
  assert.equal(interruptedRecovery("verify", true), "request");
  assert.equal(interruptedRecovery("unknown", false), "unknown");
  assert.equal(interruptedRecovery("done", false), "done");
});

test("hidden page and expired session clear memory; visible event and cleanup do not", () => {
  const page = Object.assign(new EventTarget(), { hidden: false });
  const session = new EventTarget();
  let cleared = 0;
  const stop = observeRecoveryPrivacy(page, session, () => {
    cleared++;
  });
  page.dispatchEvent(new Event("visibilitychange"));
  assert.equal(cleared, 0);
  page.hidden = true;
  page.dispatchEvent(new Event("visibilitychange"));
  session.dispatchEvent(new Event("alcor:session-expired"));
  assert.equal(cleared, 2);
  stop();
  page.dispatchEvent(new Event("visibilitychange"));
  session.dispatchEvent(new Event("alcor:session-expired"));
  assert.equal(cleared, 2);
});
