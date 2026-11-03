import test from "node:test";
import assert from "node:assert/strict";
import {
  ReportLifetime,
  reportScope,
  reportStorageKey,
} from "../src/financial-report-lifetime.ts";

test("hidden or retired generations cannot display a late upload receipt or read", async () => {
  let visible = true,
    displayed = true;
  const life = new ReportLifetime(
    () => displayed,
    () => visible,
  );
  life.resume(true);
  const upload = life.begin()!,
    read = life.begin()!;
  let resolve!: (value: string) => void;
  const delayed = new Promise<string>((done) => {
    resolve = done;
  });
  let shown: string | null = null;
  const completion = delayed.then((value) => {
    if (upload.current()) shown = value;
    upload.finish();
  });
  visible = false;
  life.pause();
  assert.equal(upload.signal.aborted, true);
  assert.equal(read.signal.aborted, true);
  visible = true;
  life.resume(true);
  resolve("original receipt");
  await completion;
  assert.equal(shown, null);
  assert.equal(read.current(), false);
  const current = life.begin()!;
  displayed = false;
  assert.equal(current.current(), false);
  assert.equal(life.begin(), null);
});

test("Activity deactivation blocks work and resuming cannot revive old tickets", () => {
  const life = new ReportLifetime(
    () => true,
    () => true,
  );
  life.resume(true);
  const original = life.begin()!;
  life.pause();
  life.resume(false);
  assert.equal(life.begin(), null);
  life.resume(true);
  assert.equal(original.current(), false);
  assert.equal(life.begin()!.current(), true);
});

test("pending UUID storage separates instance user role and receipt session", () => {
  const base = {
    instance_id: "instance-a",
    user: { id: "owner", role: "admin" },
    receipt_scope: "session-a",
  };
  const keys = [
    base,
    { ...base, instance_id: "instance-b" },
    { ...base, user: { id: "peer", role: "admin" } },
    { ...base, user: { id: "owner", role: "user" } },
    { ...base, receipt_scope: "session-b" },
  ].map((session) => reportStorageKey(reportScope(session)));
  assert.equal(new Set(keys).size, 5);
  const storage = new Map([[keys[0], "448fca63-e431-4968-86c0-d701c60046bf"]]);
  assert.equal(storage.get(keys[4]), undefined);
  assert.equal(
    JSON.stringify([...storage.values()]).includes("template"),
    false,
  );
});
