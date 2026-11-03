import test from "node:test";
import assert from "node:assert/strict";
import {
  observeDeviceSession,
  readDeviceState,
} from "../src/device-session.ts";
import { emailReadGate } from "../src/email-change-read.ts";

test("hidden device view clears content and credentials; resume performs a new read", () => {
  const page = Object.assign(new EventTarget(), { hidden: false }),
    session = new EventTarget();
  const gate = emailReadGate();
  let reads = 0,
    clear = 0,
    active = false;
  const stop = observeDeviceSession(page, session, {
    active: (v) => {
      active = v;
    },
    clear: () => {
      clear++;
      gate.invalidate();
    },
    read: () => {
      reads++;
    },
  });
  const ticket = gate.begin();
  assert.equal(reads, 1);
  assert(active);
  page.hidden = true;
  page.dispatchEvent(new Event("visibilitychange"));
  assert.equal(clear, 2);
  assert.equal(reads, 1);
  assert(!ticket.current());
  page.hidden = false;
  page.dispatchEvent(new Event("visibilitychange"));
  assert.equal(reads, 2);
  stop();
  assert(!active);
  assert.equal(clear, 3);
});

test("expired identity or Activity cleanup cannot restore an old device response", () => {
  const page = Object.assign(new EventTarget(), { hidden: false }),
    session = new EventTarget();
  const gate = emailReadGate();
  let reads = 0,
    active = false;
  const stop = observeDeviceSession(page, session, {
    active: (v) => {
      active = v;
    },
    clear: () => gate.invalidate(),
    read: () => {
      reads++;
    },
  });
  const ticket = gate.begin();
  session.dispatchEvent(new Event("alcor:session-expired"));
  assert(!active);
  assert(!ticket.current());
  page.dispatchEvent(new Event("visibilitychange"));
  assert.equal(reads, 1);
  stop();
  page.dispatchEvent(new Event("visibilitychange"));
  assert.equal(reads, 1);
});

test("403 device read removes prior content and sensitive draft before reporting failure", async () => {
  const gate = emailReadGate();
  let state: string[] | null = ["previous owner device"];
  let password = "synthetic password";
  let failure: unknown;
  await readDeviceState<string[]>(
    gate,
    async () => {
      throw { status: 403 };
    },
    {
      active: () => true,
      clear: () => {
        state = null;
        password = "";
      },
      publish: (value) => {
        state = value;
      },
      failed: (value) => {
        failure = value;
      },
      done: () => {},
    },
  );
  assert.equal(state, null);
  assert.equal(password, "");
  assert.deepEqual(failure, { status: 403 });
});

test("an earlier successful response cannot restore devices after identity cleanup", async () => {
  const gate = emailReadGate();
  let finish!: (value: string[]) => void;
  let published = false;
  const pending = readDeviceState(
    gate,
    () =>
      new Promise<string[]>((resolve) => {
        finish = resolve;
      }),
    {
      active: () => true,
      clear: () => {},
      publish: () => {
        published = true;
      },
      failed: () => {},
      done: () => {},
    },
  );
  gate.invalidate();
  finish(["old identity device"]);
  await pending;
  assert.equal(published, false);
});
