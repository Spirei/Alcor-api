import test from "node:test";
import assert from "node:assert/strict";
import { ResourceStore } from "../src/resource-store.ts";
import type { StoreClock } from "../src/resource-store.ts";
import { manualManagementRead } from "../src/management-read-policy.ts";

const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function deferred() {
  let resolve!: (value: unknown) => void, reject!: (reason: unknown) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
class Clock {
  time = 1000;
  next = 1;
  timers = new Map<number, { at: number; run: () => void }>();
  api: StoreClock = {
    now: () => this.time,
    set: (run, ms) => {
      const id = this.next++;
      this.timers.set(id, { at: this.time + ms, run });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clear: (id) => {
      this.timers.delete(id as unknown as number);
    },
  };
  advance(ms: number) {
    this.time += ms;
    for (const [id, timer] of this.timers)
      if (timer.at <= this.time) {
        this.timers.delete(id);
        timer.run();
      }
  }
}
const noop = () => {};

test("migration loads once, ignores polling/focus/reentry, and refreshes only on demand", async () => {
  const clock = new Clock();
  let calls = 0;
  const store = new ResourceStore(async () => ({ revision: ++calls }), {
    clock: clock.api,
    manual: manualManagementRead,
  });
  let stop = store.subscribe("/system/migration", noop, true);
  await flush();
  const cached = store.snapshot("/system/migration").data;
  assert.equal(calls, 1);
  clock.advance(60000);
  store.resume();
  await flush();
  assert.equal(calls, 1);
  stop();
  stop = store.subscribe("/system/migration", noop, false);
  store.resume();
  await flush();
  assert.equal(calls, 1);
  assert.equal(store.snapshot("/system/migration").data, cached);
  store.reload("/system/migration");
  await flush();
  assert.equal(calls, 2);
  assert.deepEqual(store.snapshot("/system/migration").data, { revision: 2 });
  stop();
  store.dispose();
});

test("a saved connection discards the obsolete overview without polling its hidden module", async () => {
  const fresh = deferred();
  let calls = 0;
  const store = new ResourceStore((key) => {
    if (key !== "/system/overview")
      return Promise.resolve({ privateDraft: true });
    return ++calls === 1
      ? Promise.resolve({ connected: false })
      : fresh.promise;
  });
  const stop = store.subscribe("/system/overview", noop, false);
  const stopOther = store.subscribe("/profile", noop, false);
  await flush();
  stop();
  store.invalidate(["/system/overview"], true);
  await flush();
  assert.equal(calls, 1);
  assert.equal(store.snapshot("/system/overview").data, null);
  assert.equal(store.snapshot("/system/overview").updatedAt, null);
  assert.deepEqual(store.snapshot("/profile").data, { privateDraft: true });
  const resume = store.subscribe("/system/overview", noop, false);
  await flush();
  assert.equal(calls, 2);
  assert.equal(store.snapshot("/system/overview").data, null);
  fresh.resolve({ connected: true });
  await flush();
  assert.deepEqual(store.snapshot("/system/overview").data, {
    connected: true,
  });
  resume();
  stopOther();
  store.dispose();
});

test("a warm visit renders the known snapshot immediately and still verifies the server", async () => {
  const jobs = [deferred(), deferred()];
  let calls = 0;
  const store = new ResourceStore(() => jobs[calls++].promise);
  const stop = store.subscribe("/tasks", noop, false);
  await flush();
  jobs[0].resolve({ asOf: "2026-10-31T01:00:00Z", value: 1 });
  await flush();
  stop();
  const prior = store.snapshot("/tasks");
  const stopAgain = store.subscribe("/tasks", noop, false);
  assert.equal(store.snapshot("/tasks").data, prior.data);
  await flush();
  assert.equal(calls, 2);
  jobs[1].resolve({ asOf: "2026-10-31T01:00:02Z", value: 2 });
  await flush();
  assert.equal((store.snapshot("/tasks").data as { value: number }).value, 2);
  stopAgain();
  store.dispose();
});
test("two readers share one in-flight GET, and navigation does not abort it", async () => {
  const job = deferred();
  let calls = 0,
    signal: AbortSignal | undefined;
  const store = new ResourceStore((_, s) => {
    calls++;
    signal = s;
    return job.promise;
  });
  const a = store.subscribe("/a", () => {}, false),
    b = store.subscribe("/a", () => {}, false);
  await flush();
  assert.equal(calls, 1);
  a();
  b();
  assert.equal(signal?.aborted, false);
  job.resolve({ complete: true });
  await flush();
  assert.deepEqual(store.snapshot("/a").data, { complete: true });
  store.dispose();
});
test("late data before a mutation cannot replace the fresh read", async () => {
  const first = deferred(),
    second = deferred();
  let calls = 0;
  const store = new ResourceStore(() =>
    ++calls === 1 ? first.promise : second.promise,
  );
  const stop = store.subscribe("/tasks", noop, false);
  await flush();
  store.invalidate(["/tasks"]);
  first.resolve({ status: "queued" });
  await flush();
  assert.equal(calls, 2);
  assert.equal(store.snapshot("/tasks").data, null);
  second.resolve({ status: "cancelled" });
  await flush();
  assert.deepEqual(store.snapshot("/tasks").data, { status: "cancelled" });
  stop();
  store.dispose();
});
test("temporary errors preserve the exact observation and cache timestamp", async () => {
  const clock = new Clock();
  let fail = false;
  const value = { asOf: "2026-10-30T01:00:00Z" };
  const store = new ResourceStore(
    async () => {
      if (fail) throw new Error("offline");
      return value;
    },
    { clock: clock.api },
  );
  const stop = store.subscribe("/a", noop, false);
  await flush();
  const old = store.snapshot("/a");
  fail = true;
  clock.advance(10000);
  store.reload("/a");
  await flush();
  assert.equal(store.snapshot("/a").data, value);
  assert.equal(store.snapshot("/a").updatedAt, old.updatedAt);
  assert.equal(store.snapshot("/a").error, "offline");
  stop();
  store.dispose();
});
test("403 withdraws all private snapshots, including hidden modules", async () => {
  let forbidden = false;
  const store = new ResourceStore(async (key) => {
    if (forbidden && key === "/a")
      throw Object.assign(new Error("forbidden"), { status: 403 });
    return { key };
  });
  const a = store.subscribe("/a", noop, false),
    b = store.subscribe("/b", () => {}, false);
  await flush();
  b();
  forbidden = true;
  store.reload("/a");
  await flush();
  assert.equal(store.snapshot("/a").data, null);
  assert.equal(store.snapshot("/b").data, null);
  assert.match(store.snapshot("/b").error, /权限/);
  a();
  store.dispose();
});
test("404 removes the missing object without inventing an empty successful result", async () => {
  let gone = false;
  const store = new ResourceStore(async () => {
    if (gone) throw Object.assign(new Error("missing"), { status: 404 });
    return { id: "one" };
  });
  const stop = store.subscribe("/a", noop, false);
  await flush();
  gone = true;
  store.reload("/a");
  await flush();
  assert.equal(store.snapshot("/a").data, null);
  assert.equal(store.snapshot("/a").error, "missing");
  stop();
  store.dispose();
});
test("filter keys never return rows from the previous query", async () => {
  const store = new ResourceStore(async (key) => ({ key }));
  const stop = store.subscribe("/tasks?status=failed", noop, false);
  await flush();
  assert.equal(store.snapshot("/tasks?status=succeeded").data, null);
  stop();
  store.dispose();
});
test("scope disposal rejects late responses and a different identity starts empty", async () => {
  const job = deferred();
  let oldSignal: AbortSignal | undefined;
  const old = new ResourceStore((_, signal) => {
    oldSignal = signal;
    return job.promise;
  });
  old.subscribe("/tasks", noop, false);
  await flush();
  old.dispose();
  job.resolve({ privateOwner: "old" });
  await flush();
  assert.equal(oldSignal?.aborted, true);
  assert.equal(old.snapshot("/tasks").data, null);
  const next = new ResourceStore(async () => ({ privateOwner: "new" }));
  assert.equal(next.snapshot("/tasks").data, null);
  old.dispose();
  next.dispose();
});
test("the five-second visible poll cadence is retained and inactive modules stop polling", async () => {
  const clock = new Clock();
  let calls = 0;
  const store = new ResourceStore(async () => ++calls, { clock: clock.api });
  const stop = store.subscribe("/tasks", noop, true);
  await flush();
  assert.equal(calls, 1);
  clock.advance(4999);
  await flush();
  assert.equal(calls, 1);
  clock.advance(1);
  await flush();
  assert.equal(calls, 2);
  stop();
  clock.advance(20000);
  await flush();
  assert.equal(calls, 2);
  store.dispose();
});
test("document visibility restores verification without a polling storm", async () => {
  const clock = new Clock();
  let visible = false,
    calls = 0;
  const store = new ResourceStore(async () => ++calls, {
    clock: clock.api,
    isVisible: () => visible,
  });
  const stop = store.subscribe("/a", noop, true);
  await flush();
  assert.equal(calls, 0);
  visible = true;
  store.resume();
  store.resume();
  await flush();
  assert.equal(calls, 1);
  visible = false;
  clock.advance(5000);
  await flush();
  assert.equal(calls, 1);
  visible = true;
  store.resume();
  await flush();
  assert.equal(calls, 2);
  stop();
  store.dispose();
});
test("inactive cache entries are bounded", async () => {
  const clock = new Clock();
  const store = new ResourceStore(async (key) => key, {
    limit: 3,
    clock: clock.api,
  });
  for (let i = 0; i < 12; i++) {
    clock.advance(1);
    const stop = store.subscribe("/" + i, noop, false);
    await flush();
    stop();
  }
  assert.equal(store.size, 3);
  store.dispose();
});
test("StrictMode cleanup/re-entry shares work, final disposal clears the scope", async () => {
  const job = deferred();
  let calls = 0;
  const store = new ResourceStore(() => {
    calls++;
    return job.promise;
  });
  const firstRelease = store.retain(),
    stop = store.subscribe("/a", noop, false);
  await flush();
  stop();
  firstRelease();
  const release = store.retain(),
    stopAgain = store.subscribe("/a", noop, false);
  await flush();
  assert.equal(calls, 1);
  job.resolve({ value: 1 });
  await flush();
  assert.deepEqual(store.snapshot("/a").data, { value: 1 });
  stopAgain();
  release();
  await flush();
  assert.equal(store.size, 0);
});
test("a synchronous transport failure can be explicitly retried", async () => {
  let fails = true;
  const store = new ResourceStore(() => {
    if (fails) throw new Error("bad transport");
    return Promise.resolve({ ok: true });
  });
  const stop = store.subscribe("/a", noop, false);
  await flush();
  assert.equal(store.snapshot("/a").error, "bad transport");
  fails = false;
  store.reload("/a");
  await flush();
  assert.deepEqual(store.snapshot("/a").data, { ok: true });
  stop();
  store.dispose();
});

test("manual deployment snapshots read once and survive reentry and visibility resume until explicit refresh", async () => {
  let calls = 0;
  const store = new ResourceStore(async () => ({ revision: ++calls }), {
    manual: (key) => key.startsWith("/deployment"),
  });
  const release = store.retain();
  let stop = store.subscribe("/deployment", () => {}, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  stop();
  stop = store.subscribe("/deployment", () => {}, true);
  store.resume();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  store.reload("/deployment");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 2);
  stop();
  release();
});

test("manual page errors stay explicit on reentry and recover only after refresh", async () => {
  let calls = 0;
  const store = new ResourceStore(
    async () => {
      if (++calls === 1) throw new Error("GitHub unavailable");
      return { sha: "new" };
    },
    { manual: () => true },
  );
  const release = store.retain();
  let stop = store.subscribe("/deployment", () => {}, false);
  await flush();
  assert.equal(store.snapshot("/deployment").error, "GitHub unavailable");
  stop();
  stop = store.subscribe("/deployment", () => {}, false);
  store.resume();
  await flush();
  assert.equal(calls, 1);
  store.reload("/deployment");
  await flush();
  assert.equal(calls, 2);
  assert.equal(store.snapshot("/deployment").error, "");
  stop();
  release();
});
