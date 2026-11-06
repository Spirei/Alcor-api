import test from "node:test";
import assert from "node:assert/strict";
import { modulePreload } from "../src/module-preload.ts";

test("intent loading stays idle until requested and shares an in-flight module", async () => {
  let calls = 0;
  let finish!: (value: string) => void;
  const read = modulePreload(() => {
    calls++;
    return new Promise<string>((resolve) => {
      finish = resolve;
    });
  });
  assert.equal(calls, 0);
  const first = read(),
    second = read();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish("module");
  assert.equal(await first, "module");
  assert.equal(await read(), "module");
  assert.equal(calls, 1);
});

test("failed intent loading can retry when the page is opened", async () => {
  let calls = 0;
  const read = modulePreload(() => {
    if (++calls === 1) throw new Error("offline");
    return Promise.resolve("recovered");
  });
  await assert.rejects(read(), /offline/);
  assert.equal(await read(), "recovered");
  assert.equal(calls, 2);
});
