import assert from "node:assert/strict";
import test from "node:test";
import {
  observationWindow,
  createRequestLifetime,
  observeOriginalRequest,
  requestObservation,
  sendObservedRequest,
} from "../src/deployment-observation.ts";
import {
  buildReceiptPending,
  originalBuildPublished,
  resumeBuildReceipt,
  deploymentPollDelay,
} from "../src/deployment-view.ts";

class ManualClock {
  current = 0;
  next = 0;
  timers = new Map<number, { at: number; run: () => void }>();
  now = () => this.current;
  set = (run: () => void, delay: number) => {
    const id = ++this.next;
    this.timers.set(id, { at: this.current + delay, run });
    return id;
  };
  clear = (id: unknown) => {
    this.timers.delete(id as number);
  };
  async advance(milliseconds: number) {
    const end = this.current + milliseconds;
    while (true) {
      const next = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      this.current = next[1].at;
      this.timers.delete(next[0]);
      next[1].run();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    this.current = end;
  }
}

for (const kind of ["update", "build"] as const) {
  test(`${kind}: lost POST response recovers by original-UUID reads even with an idle empty snapshot`, async () => {
    const id = "original-request",
      time = new ManualClock();
    const snapshot = {
      source: { sha: "current", url: "#" },
      release: {
        revision: "current",
        version: "0.1.1",
        image: "synthetic",
        schema_hash: "synthetic",
      },
      build: null,
      check: null,
      receipts: [],
      build_requests: [],
    };
    assert.equal(
      deploymentPollDelay(snapshot, false, false, false, time.now()),
      null,
    );
    const calls: { method: string; id: string }[] = [];
    const outcomes: string[] = [];
    let armed = false,
      refreshes = 0,
      failures = 0,
      stop = () => {};
    await assert.rejects(
      sendObservedRequest(
        id,
        (original) => {
          armed = true;
          stop = observeOriginalRequest(
            requestObservation(undefined, original, undefined, time.now()),
            {
              clock: time,
              hidden: () => false,
              visibility: () => () => {},
              read: async (original) => {
                calls.push({ method: "GET", id: original });
                if (++failures <= 2)
                  throw Object.assign(new Error("not available yet"), {
                    status: failures === 1 ? 503 : 404,
                  });
                return {
                  request_id: original,
                  status:
                    failures === 3
                      ? "unknown"
                      : kind === "build"
                        ? "failed"
                        : "succeeded",
                };
              },
              result: (receipt) => {
                assert.equal(receipt.request_id, id);
                outcomes.push(receipt.status);
                refreshes++;
                return kind === "build"
                  ? buildReceiptPending(receipt)
                  : receipt.status === "unknown";
              },
              error: () => {
                refreshes++;
                return true;
              },
              expired: () =>
                assert.fail(
                  "the original result should arrive within the window",
                ),
            },
          );
        },
        async () => {
          assert.equal(
            armed,
            true,
            "observation must be armed before the write reaches the server",
          );
          calls.push({ method: "POST", id });
          throw new TypeError("old API stopped before its response arrived");
        },
      ),
    );
    await time.advance(45000);
    assert.deepEqual(
      calls.map((call) => call.method),
      ["POST", "GET", "GET", "GET", "GET"],
    );
    assert(calls.every((call) => call.id === id));
    assert.deepEqual(outcomes, [
      "unknown",
      kind === "build" ? "failed" : "succeeded",
    ]);
    assert.equal(refreshes, 4);
    await time.advance(observationWindow);
    assert.equal(
      calls.length,
      5,
      "a known result must stop automatic receipt reads",
    );
    stop();
  });
}

test("a submitted build keeps its UUID until a later failed receipt and never sends a second POST", async () => {
  const time = new ManualClock(),
    id = "original-build";
  const calls: string[] = [],
    statuses: string[] = [];
  let pending: string | null = id,
    reads = 0,
    stop = () => {};
  function observe(receipt: { request_id: string; status: string }) {
    assert.equal(receipt.request_id, id);
    statuses.push(receipt.status);
    if (!buildReceiptPending(receipt)) pending = null;
    return buildReceiptPending(receipt);
  }
  const accepted = await sendObservedRequest(
    id,
    (original) => {
      stop = observeOriginalRequest(
        requestObservation(undefined, original, undefined, time.now()),
        {
          clock: time,
          hidden: () => false,
          visibility: () => () => {},
          read: async (original) => {
            calls.push("GET " + original);
            return {
              request_id: original,
              status: ++reads === 1 ? "submitted" : "failed",
            };
          },
          result: observe,
          error: () => true,
          expired: () => assert.fail("the workflow failure should be observed"),
        },
      );
    },
    async () => {
      calls.push("POST " + id);
      return { request_id: id, status: "submitted" };
    },
  );
  assert.equal(observe(accepted), true);
  assert.equal(pending, id);
  await time.advance(5000);
  assert.equal(
    pending,
    id,
    "GitHub acceptance cannot unlock a duplicate build",
  );
  await time.advance(5000);
  assert.equal(pending, null);
  assert.deepEqual(statuses, ["submitted", "submitted", "failed"]);
  await time.advance(observationWindow);
  assert.deepEqual(calls, ["POST " + id, "GET " + id, "GET " + id]);
  stop();
});

test("confirmed publication stops a submitted build observation without a second POST", async () => {
  const time = new ManualClock(),
    id = "original-build";
  let pending: string | null = id,
    reads = 0,
    posts = 0,
    stop = () => {};
  const snapshot = {
    source: { sha: "target" },
    release: { revision: "previous" },
  };
  await sendObservedRequest(
    id,
    (original) => {
      stop = observeOriginalRequest(
        requestObservation(undefined, original, undefined, time.now()),
        {
          clock: time,
          hidden: () => false,
          visibility: () => () => {},
          read: async (original) => {
            reads++;
            return { request_id: original, status: "submitted" };
          },
          result: buildReceiptPending,
          error: () => true,
          expired: () =>
            assert.fail("publication should end receipt observation"),
        },
      );
    },
    async () => {
      posts++;
      return { request_id: id, status: "submitted" };
    },
  );
  await time.advance(5000);
  assert.equal(reads, 1);
  assert.equal(pending, id);
  // The deployment snapshot confirms the approved source; React effect cleanup cancels its observer.
  snapshot.release.revision = snapshot.source.sha;
  if (snapshot.release.revision === snapshot.source.sha) {
    pending = null;
    stop();
  }
  await time.advance(observationWindow);
  assert.equal(pending, null);
  assert.equal(reads, 1);
  assert.equal(posts, 1);
  assert.equal(time.timers.size, 0);
  const history = {
    request_id: id,
    status: "submitted",
    created_at: new Date(0).toISOString(),
  };
  const context = {
    source: snapshot.source,
    build: { sha: snapshot.source.sha, title: "publish " + id },
  };
  assert.equal(
    resumeBuildReceipt(history, context, 5000),
    true,
    "a recent acceptance is resumed after reload",
  );
  assert.equal(
    resumeBuildReceipt(history, context, time.now()),
    false,
    "an old accepted build cannot lock a later main commit after reload",
  );
  assert.equal(
    resumeBuildReceipt({ ...history, status: "unknown" }, context, time.now()),
    true,
    "historical uncertainty retains its explicit recovery entry",
  );
});

test("a recent old publication cannot lock a newer main; only its own current-source run resumes a submitted receipt", () => {
  const now = 5 * 60000;
  const old = {
    request_id: "old-request",
    status: "submitted",
    created_at: new Date(0).toISOString(),
  };
  const source = { sha: "revision-two", url: "#" };
  const previousRun = {
    sha: "revision-one",
    title: "publish " + old.request_id,
  };
  assert.equal(
    resumeBuildReceipt(old, { source, build: previousRun }, now),
    false,
  );
  const current = { ...old, request_id: "current-request" };
  assert.equal(
    resumeBuildReceipt(current, { source, build: null }, now),
    false,
    "missing run metadata cannot pin a historical receipt",
  );
  assert.equal(
    resumeBuildReceipt(
      current,
      { source, build: { sha: source.sha, title: previousRun.title } },
      now,
    ),
    false,
    "same commit with another request UUID cannot be substituted",
  );
  const waitingForRun = {
    source,
    release: {
      revision: previousRun.sha,
      version: "0.1.1",
      image: "synthetic",
      schema_hash: "synthetic",
    },
    build: null,
    check: null,
    receipts: [],
    build_requests: [current],
  };
  assert.equal(
    deploymentPollDelay(waitingForRun, false, false, false, now),
    5000,
    "durable recent acceptance keeps checking until run metadata appears",
  );
  const currentRun = {
    sha: source.sha,
    title: "publish " + current.request_id,
  };
  assert.equal(
    resumeBuildReceipt(current, { source, build: currentRun }, now),
    true,
  );
  for (const status of ["unknown", "dispatching"])
    assert.equal(
      resumeBuildReceipt({ ...old, status }, { source, build: null }, now),
      true,
    );
});

test("an in-flight original build stops once its own image is published even when main advances", async () => {
  const time = new ManualClock(),
    id = "original-build";
  const snapshot = {
    source: { sha: "revision-one" },
    build: {
      sha: "revision-one",
      title: "publish " + id,
      status: "in_progress",
      conclusion: null as string | null,
    },
    release: { revision: "previous" },
  };
  const calls: string[] = [],
    ignored = new Set<string>();
  let pending: string | null = id,
    stop = () => {};
  await sendObservedRequest(
    id,
    (original) => {
      stop = observeOriginalRequest(
        requestObservation(undefined, original, undefined, time.now()),
        {
          clock: time,
          hidden: () => false,
          visibility: () => () => {},
          read: async (original) => {
            calls.push("GET " + original);
            return { request_id: original, status: "submitted" };
          },
          result: buildReceiptPending,
          error: () => true,
          expired: () =>
            assert.fail("the original image should be confirmed first"),
        },
      );
    },
    async () => {
      calls.push("POST " + id);
      return { request_id: id, status: "submitted" };
    },
  );
  await time.advance(5000);
  snapshot.source.sha = "revision-two";
  assert.equal(originalBuildPublished(pending, snapshot), false);
  await time.advance(5000);
  snapshot.build.status = "completed";
  snapshot.build.conclusion = "success";
  assert.equal(
    originalBuildPublished(pending, snapshot),
    false,
    "a successful job alone is not proof of a published image",
  );
  snapshot.release.revision = "revision-one";
  assert.equal(originalBuildPublished("another-request", snapshot), false);
  assert.equal(originalBuildPublished(pending, snapshot), true);
  if (originalBuildPublished(pending, snapshot)) {
    ignored.add(pending!);
    pending = null;
    stop();
  }
  await time.advance(observationWindow);
  assert.deepEqual(calls, ["POST " + id, "GET " + id, "GET " + id]);
  assert.equal(pending, null);
  assert.equal(ignored.has(id), true);
  assert.notEqual(
    snapshot.release.revision,
    snapshot.source.sha,
    "the newly advanced main still needs its own build",
  );
  assert.equal(
    resumeBuildReceipt(
      {
        request_id: id,
        status: "submitted",
        created_at: new Date(0).toISOString(),
      },
      snapshot,
      10000,
    ),
    false,
    "the completed old request must not lock the new main again",
  );
  assert.equal(time.timers.size, 0);
});

test("hidden pages issue no reads and a missing original receipt stops after fifteen minutes without resending", async () => {
  const time = new ManualClock(),
    id = "original-request";
  const observed = requestObservation(undefined, id, undefined, time.now());
  let hidden = true,
    resume = () => {},
    reads = 0,
    expired = 0;
  let pending: string | null = id;
  const stop = observeOriginalRequest(observed, {
    clock: time,
    hidden: () => hidden,
    visibility: (read) => {
      resume = read;
      return () => {
        resume = () => {};
      };
    },
    read: async (original) => {
      assert.equal(original, id);
      reads++;
      throw Object.assign(new Error("not accepted yet"), { status: 404 });
    },
    result: () => assert.fail("no receipt exists yet"),
    error: () => true,
    expired: (original) => {
      assert.equal(original, pending);
      expired++;
    },
  });
  await time.advance(20000);
  assert.equal(reads, 0);
  hidden = false;
  resume();
  await time.advance(0);
  assert.equal(reads, 1, "visibility resumes a read of the original UUID");
  assert.equal(
    requestObservation(observed, id, undefined, time.now()),
    observed,
    "retry cannot renew the window",
  );
  await time.advance(observationWindow);
  const finalReads = reads;
  assert.equal(expired, 1);
  assert.equal(pending, id, "expiry preserves the UUID for manual checking");
  await time.advance(observationWindow);
  assert.equal(reads, finalReads);
  stop();
  pending = null;
});

test("a definite read rejection or unmount stops observation without a write", async () => {
  const time = new ManualClock();
  let reads = 0;
  const start = () =>
    observeOriginalRequest(
      requestObservation(undefined, "original", undefined, time.now()),
      {
        clock: time,
        hidden: () => false,
        visibility: () => () => {},
        read: async () => {
          reads++;
          throw Object.assign(new Error("access revoked"), { status: 403 });
        },
        result: () => true,
        error: (error) => {
          assert.equal((error as Error).message, "access revoked");
          return false;
        },
        expired: () => assert.fail("a definitive rejection stops immediately"),
      },
    );
  const stop = start();
  await time.advance(observationWindow);
  assert.equal(reads, 1);
  stop();
  const unmount = start();
  unmount();
  await time.advance(observationWindow);
  assert.equal(reads, 1);
});

test("cleanup aborts an in-flight GET and a retired session cannot process its late result", async () => {
  const time = new ManualClock(),
    lifetime = createRequestLifetime();
  const deactivate = lifetime.activate(),
    current = lifetime.capture();
  let signal: AbortSignal | undefined,
    reads = 0,
    callbacks = 0;
  let resolve: (value: string) => void = () => {};
  const stop = observeOriginalRequest(
    requestObservation(undefined, "original", undefined, time.now()),
    {
      clock: time,
      current,
      hidden: () => false,
      visibility: () => () => {},
      read: async (_id, observedSignal) => {
        reads++;
        signal = observedSignal;
        return new Promise<string>((done) => {
          resolve = done;
        });
      },
      result: () => {
        callbacks++;
        return true;
      },
      error: () => {
        callbacks++;
        return true;
      },
      expired: () => {
        callbacks++;
      },
    },
  );
  await time.advance(5000);
  assert.equal(signal?.aborted, false);
  deactivate();
  stop();
  assert.equal(signal?.aborted, true);
  resolve("late result");
  await time.advance(observationWindow);
  assert.equal(callbacks, 0);
  assert.equal(reads, 1);
  assert.equal(time.timers.size, 0);
});

test("StrictMode reactivation permits new observation while a late POST catch cannot restart the old one", async () => {
  const lifetime = createRequestLifetime();
  const cleanup = lifetime.activate(),
    oldRequest = lifetime.capture();
  let starts = 0,
    reject: (reason: Error) => void = () => {};
  const write = sendObservedRequest(
    "old",
    () => {
      starts++;
    },
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
  ).catch(() => {
    if (oldRequest()) starts++;
  });
  cleanup();
  const stopCurrent = lifetime.activate(),
    currentRequest = lifetime.capture();
  reject(new TypeError("late disconnected POST"));
  await write;
  assert.equal(starts, 1);
  assert.equal(oldRequest(), false);
  assert.equal(
    currentRequest(),
    true,
    "cleanup must not permanently dispose a remounted observer",
  );
  const time = new ManualClock();
  let reads = 0;
  const stop = observeOriginalRequest(
    requestObservation(undefined, "old", undefined, time.now()),
    {
      clock: time,
      current: oldRequest,
      hidden: () => false,
      visibility: () => () => {},
      read: async () => {
        reads++;
        return "unexpected";
      },
      result: () => true,
      error: () => true,
      expired: () => assert.fail("retired session cannot notify"),
    },
  );
  await time.advance(observationWindow);
  assert.equal(reads, 0);
  stop();
  const stopNew = observeOriginalRequest(
    requestObservation(undefined, "new", undefined, time.now()),
    {
      clock: time,
      current: currentRequest,
      hidden: () => false,
      visibility: () => () => {},
      read: async (id) => {
        reads++;
        assert.equal(id, "new");
        return "known";
      },
      result: () => false,
      error: () => assert.fail("new lifetime is active"),
      expired: () => assert.fail("new read should run"),
    },
  );
  await time.advance(5000);
  assert.equal(reads, 1, "reactivation really runs a new read");
  stopNew();
  stopCurrent();
});
