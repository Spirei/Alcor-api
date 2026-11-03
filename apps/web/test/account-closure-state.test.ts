import assert from "node:assert/strict";
import test from "node:test";
import {
  closureStorageKey,
  closurePending,
  closureObservation,
  newClosurePending,
  readClosurePending,
  releaseClosurePending,
  retainClosurePending,
  sameClosureSession,
  sameClosureOwner,
} from "../src/account-closure-state.ts";
import { observeClosure } from "../src/account-closure-transport.ts";
const instance = "12345678-1234-1234-1234-123456789abc";
const revision = "12345678-1234-1234-1234-123456789abd";
const scope = {
  instanceId: instance,
  userId: "synthetic-owner",
  sessionScope: "synthetic-session-scope",
  revision,
};
const pending = newClosurePending(scope);
function store() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
const receipt = (state: string) => ({
  request_id: pending.requestId,
  scope: "account-closure-only",
  state,
  ...(state === "prepared"
    ? {
        revision,
        prepared_until: "2030-01-01T00:00:00Z",
        expires_at: "2030-01-31T00:00:00Z",
      }
    : state === "closed"
      ? { closed: true, executed: false }
      : { deleted: true }),
});
test("closure record retains only the original ID and minimal read-close capability", () => {
  const memory = store();
  retainClosurePending(memory, pending);
  assert.deepEqual(readClosurePending(memory), pending);
  retainClosurePending(memory, pending);
  assert.throws(
    () => retainClosurePending(memory, newClosurePending(scope)),
    /原注销/,
  );
  assert.throws(
    () => closurePending({ ...pending, password: "SyntheticNeverPersist9" }),
    /记录/,
  );
  assert.match(pending.receiptToken, /^acr_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(pending.receiptToken, newClosurePending(scope).receiptToken);
  releaseClosurePending(memory, newClosurePending(scope));
  assert.deepEqual(readClosurePending(memory), pending);
  releaseClosurePending(memory, pending);
  assert.equal(readClosurePending(memory), null);
});
test("failed or corrupt storage prevents a second request from replacing the unknown original", () => {
  const broken = { ...store(), setItem: () => {} };
  assert.throws(() => retainClosurePending(broken, pending), /可靠保存/);
  const memory = store();
  memory.setItem(closureStorageKey, "broken JSON");
  assert.throws(() => readClosurePending(memory));
  assert.throws(() => retainClosurePending(memory, newClosurePending(scope)));
  assert.equal(memory.getItem(closureStorageKey), "broken JSON");
});
test("closure preparation never inherits another user instance or session", () => {
  const session = {
    instance_id: instance,
    user: { id: scope.userId },
    receipt_scope: scope.sessionScope,
  };
  assert.equal(sameClosureSession(pending, session), true);
  assert.equal(
    sameClosureOwner(pending, { ...session, receipt_scope: "later-session" }),
    true,
  );
  assert.equal(
    sameClosureOwner(pending, { ...session, user: { id: "other-owner" } }),
    false,
  );
  assert.equal(
    sameClosureOwner(pending, { ...session, instance_id: revision }),
    false,
  );
  assert.equal(
    sameClosureSession(pending, { ...session, receipt_scope: "later-session" }),
    false,
  );
  assert.equal(
    sameClosureSession(pending, { ...session, user: { id: "other-owner" } }),
    false,
  );
  assert.equal(
    sameClosureSession(pending, { ...session, instance_id: revision }),
    false,
  );
});
test("only exact original closure proofs authorize terminal UI states", () => {
  for (const state of ["prepared", "completed", "closed"])
    assert.equal(closureObservation(receipt(state), pending).state, state);
  assert.throws(
    () =>
      closureObservation(
        { ...receipt("completed"), request_id: revision },
        pending,
      ),
    /编号/,
  );
  assert.throws(
    () =>
      closureObservation(
        { ...receipt("completed"), scope: "portfolio.write" },
        pending,
      ),
    /编号/,
  );
  assert.throws(() =>
    closureObservation({ ...receipt("closed"), deleted: true }, pending),
  );
  assert.throws(() =>
    closureObservation({ ...receipt("prepared"), executed: false }, pending),
  );
  assert.throws(() =>
    closureObservation({ ...receipt("prepared"), revision: instance }, pending),
  );
});
test("logout-capable receipt calls use body token only after exact instance proof and omit cookies", async () => {
  const previous = globalThis.fetch,
    calls: Array<{ url: string; options: RequestInit }> = [];
  globalThis.fetch = (async (input, options = {}) => {
    const url = String(input);
    calls.push({ url, options });
    return Response.json(
      url.endsWith("/config")
        ? { instance_id: instance, scope: "account-closure-only" }
        : receipt("completed"),
    );
  }) as typeof fetch;
  try {
    assert.equal((await observeClosure(pending)).state, "completed");
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.options.credentials, "omit");
      assert.equal(call.options.referrerPolicy, "no-referrer");
      assert.equal(call.url.includes(pending.receiptToken), false);
      assert.equal(
        call.options.headers && "Authorization" in call.options.headers,
        false,
      );
    }
    assert.deepEqual(JSON.parse(String(calls[1].options.body)), {
      receipt_token: pending.receiptToken,
    });
    assert.equal(
      calls[1].url,
      "/api/account/closure/" + pending.requestId + "/receipt",
    );
  } finally {
    globalThis.fetch = previous;
  }
});
test("a different instance receives no read capability and no automatic retry", async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return Response.json({
      instance_id: revision,
      scope: "account-closure-only",
    });
  }) as typeof fetch;
  try {
    await assert.rejects(observeClosure(pending, true), /实例已变化/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previous;
  }
});

test("unrelated owners and instances retain independent unknown IDs without blocking or inheriting", () => {
  const memory = store(),
    otherOwner = newClosurePending({ ...scope, userId: "other-owner" }),
    otherInstance = newClosurePending({ ...scope, instanceId: revision });
  retainClosurePending(memory, pending);
  retainClosurePending(memory, otherOwner);
  retainClosurePending(memory, otherInstance);
  assert.deepEqual(readClosurePending(memory, scope), pending);
  assert.deepEqual(readClosurePending(memory, otherOwner), otherOwner);
  assert.deepEqual(readClosurePending(memory, otherInstance), otherInstance);
  assert.throws(
    () =>
      retainClosurePending(
        memory,
        newClosurePending({ ...scope, sessionScope: "new-session" }),
      ),
    /原注销请求/,
  );
  releaseClosurePending(memory, pending);
  assert.equal(readClosurePending(memory, scope), null);
  assert.deepEqual(readClosurePending(memory, otherOwner), otherOwner);
  assert.deepEqual(readClosurePending(memory, otherInstance), otherInstance);
});
