import test from "node:test";
import assert from "node:assert/strict";
import {
  AccountChangeObserver,
  accountDomains,
  accountSignalDelta,
  type AccountSignal,
} from "../src/account-change-observer.ts";
const identity = { userId: "owner", instanceId: "instance", role: "user" };
function signal(revision = 1): AccountSignal {
  return {
    ...identity,
    context: "a".repeat(64),
    epoch: "epoch",
    binding: {
      ...identity,
      principal: "session",
      scopes: ["new-web-owner"],
      sessionVersion: 2,
      apiVersion: 1,
    },
    domains: Object.fromEntries(
      accountDomains.map((name) => [
        name,
        { state: "observed", revision, commitSignalComplete: true },
      ]),
    ),
  };
}
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function harness() {
  let visible = true,
    retired = 0;
  const jobs: {
    signal: AbortSignal;
    context?: string;
    resolve: (v: AccountSignal) => void;
    reject: (e: unknown) => void;
  }[] = [];
  const timers = new Map<number, { run: () => void; ms: number }>();
  const changes: { domains: string[]; retire: boolean }[] = [];
  let seq = 0;
  const observer = new AccountChangeObserver({
    identity,
    visible: () => visible,
    read: (signal, context) =>
      new Promise((resolve, reject) =>
        jobs.push({ signal, context, resolve, reject }),
      ),
    changed: (change) => changes.push(change),
    retired: () => retired++,
    clock: {
      set: (run, ms) => {
        const id = ++seq;
        timers.set(id, { run, ms });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clear: (id) => {
        timers.delete(id as unknown as number);
      },
    },
  });
  return {
    observer,
    jobs,
    changes,
    timers,
    hide: () => {
      visible = false;
      observer.pause();
    },
    show: () => {
      visible = true;
      observer.resume();
    },
    retired: () => retired,
  };
}
test("only committed-domain changes invalidate reads; baseline is not a financial confirmation", () => {
  const a = signal(),
    b = signal();
  b.domains.portfolio.revision = 7;
  b.domains.watch.revision = 9;
  assert.deepEqual(accountSignalDelta(null, a, identity), {
    domains: accountDomains,
    retire: false,
  });
  assert.deepEqual(accountSignalDelta(a, b, identity), {
    domains: ["portfolio", "watch"],
    retire: false,
  });
  assert.deepEqual(accountSignalDelta(b, structuredClone(b), identity), {
    domains: [],
    retire: false,
  });
});
test("source epoch or cursor rollback withdraws old evidence rather than treating it as current", () => {
  const a = signal(5),
    b = signal(4);
  assert.equal(accountSignalDelta(a, b, identity).retire, true);
  b.epoch = "restored";
  assert.deepEqual(accountSignalDelta(a, b, identity), {
    domains: accountDomains,
    retire: true,
  });
});
test("incomplete cursors continue bounded read verification even when their watermark is unchanged", () => {
  const a = signal(),
    b = signal();
  for (const value of [a, b]) {
    value.domains.watch.state = "partial";
    value.domains.watch.commitSignalComplete = false;
    value.domains.brokers.state = "unavailable";
    value.domains.brokers.revision = null;
  }
  assert.deepEqual(accountSignalDelta(a, b, identity), {
    domains: ["watch", "brokers"],
    retire: false,
  });
});
test("other users, instances, role, session and malformed cursors never drive cache changes", () => {
  const a = signal();
  for (const mutate of [
    (v: AccountSignal) => {
      v.userId = "other";
    },
    (v: AccountSignal) => {
      v.binding.instanceId = "other";
    },
    (v: AccountSignal) => {
      v.binding.role = "admin";
    },
    (v: AccountSignal) => {
      v.binding.principal = "other-session";
    },
    (v: AccountSignal) => {
      v.context = "b".repeat(64);
    },
    (v: AccountSignal) => {
      v.domains.brokers.revision = -1;
    },
  ]) {
    const b = signal();
    mutate(b);
    assert.throws(() => accountSignalDelta(a, b, identity));
  }
});
test("one poll at a time; hide aborts and late response cannot invalidate the foreground session", async () => {
  const h = harness();
  h.observer.resume();
  h.observer.resume();
  assert.equal(h.jobs.length, 1);
  h.hide();
  assert.equal(h.jobs[0].signal.aborted, true);
  h.show();
  assert.equal(h.jobs.length, 2);
  h.jobs[1].resolve(signal());
  await flush();
  h.jobs[0].resolve(signal(90));
  await flush();
  assert.deepEqual(h.changes, [{ domains: accountDomains, retire: false }]);
  assert.equal(h.timers.size, 1);
  assert.equal([...h.timers.values()][0].ms, 15000);
  h.observer.dispose();
  assert.equal(h.timers.size, 0);
});
test("resume checks original context and reports only the changed domain", async () => {
  const h = harness();
  h.observer.resume();
  h.jobs[0].resolve(signal());
  await flush();
  h.observer.resume();
  assert.equal(h.jobs[1].context, "a".repeat(64));
  const next = signal();
  next.domains.brokers.revision = 2;
  h.jobs[1].resolve(next);
  await flush();
  assert.deepEqual(h.changes, [
    { domains: accountDomains, retire: false },
    { domains: ["brokers"], retire: false },
  ]);
  h.observer.dispose();
});
test("transient offline failures back off without a popup or retiring the identity", async () => {
  const h = harness();
  h.observer.resume();
  h.jobs[0].reject(new Error("offline"));
  await flush();
  assert.equal([...h.timers.values()][0].ms, 30000);
  assert.deepEqual(h.changes, []);
  assert.equal(h.retired(), 0);
  h.hide();
  assert.equal(h.timers.size, 0);
  h.show();
  h.jobs[1].resolve(signal());
  await flush();
  assert.equal([...h.timers.values()][0].ms, 15000);
  h.observer.dispose();
});
test("revocation retires views once and stops polling until session revalidation", async () => {
  for (const status of [401, 403]) {
    const h = harness();
    h.observer.resume();
    h.jobs[0].reject({ status });
    await flush();
    assert.equal(h.retired(), 1);
    assert.deepEqual(h.changes, [{ domains: accountDomains, retire: true }]);
    h.observer.resume();
    assert.equal(h.jobs.length, 1);
    assert.equal(h.timers.size, 0);
  }
});
test("dispose suppresses even a late fulfilled response from an old mounted provider", async () => {
  const h = harness();
  h.observer.resume();
  h.observer.dispose();
  h.jobs[0].resolve(signal(99));
  await flush();
  assert.deepEqual(h.changes, []);
  assert.equal(h.timers.size, 0);
});
