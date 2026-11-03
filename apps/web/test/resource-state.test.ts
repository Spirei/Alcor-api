import test from "node:test";
import assert from "node:assert/strict";
import {
  readResourceRequest,
  retainResourceRequest,
  releaseResourceRequest,
  clearResourceRequests,
  resourceSize,
} from "../src/resource-state.ts";
function storage() {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
const id = "448fca63-e431-4968-86c0-d701c60046bf",
  next = "558fca63-e431-4968-86c0-d701c60046bf";
test("recovery keeps only original UUID/kind and refuses replacement or invented cancellation kinds", () => {
  const s = storage();
  retainResourceRequest(s, "scope", { id, kind: "upload" });
  assert.deepEqual(readResourceRequest(s, "scope"), { id, kind: "upload" });
  assert.throws(
    () => retainResourceRequest(s, "scope", { id: next, kind: "upload" }),
    /先核对/,
  );
  assert.throws(
    () => retainResourceRequest(s, "scope", { id, kind: "delete" }),
    /先核对/,
  );
  releaseResourceRequest(s, "scope", next);
  assert.deepEqual(readResourceRequest(s, "scope"), { id, kind: "upload" });
  releaseResourceRequest(s, "scope", id);
  retainResourceRequest(s, "scope", { id: next, kind: "folder_create" });
  releaseResourceRequest(s, "scope", id);
  assert.deepEqual(readResourceRequest(s, "scope"), {
    id: next,
    kind: "folder_create",
  });
  assert.deepEqual(JSON.parse(s.getItem("alcor.resource-request:scope")!), {
    id: next,
    kind: "folder_create",
  });
});
test("scope transition and late completion cannot erase a newer identity's operation", () => {
  const s = storage();
  s.setItem("appearance", "dark");
  retainResourceRequest(s, "old", { id, kind: "upload" });
  assert.equal(readResourceRequest(s, "new"), null);
  retainResourceRequest(s, "new", { id: next, kind: "delete" });
  releaseResourceRequest(s, "old", id);
  assert.deepEqual(readResourceRequest(s, "new"), { id: next, kind: "delete" });
  clearResourceRequests(s);
  assert.equal(s.length, 1);
  assert.equal(s.getItem("appearance"), "dark");
});
test("old UUID-only prototypes remain queryable but cannot guess a cancel kind", () => {
  const s = storage();
  s.setItem("alcor.resource-request:scope", id);
  assert.deepEqual(readResourceRequest(s, "scope"), { id, kind: null });
  assert.throws(
    () => retainResourceRequest(s, "scope", { id, kind: "upload" }),
    /先核对/,
  );
  releaseResourceRequest(s, "scope", id);
  assert.equal(readResourceRequest(s, "scope"), null);
});
test("corrupt coordinates and unrecognized kinds never become receipt paths or overwrite the retained evidence", () => {
  for (const raw of ["../../private", JSON.stringify({ id, kind: "trade" })]) {
    const s = storage();
    s.setItem("alcor.resource-request:scope", raw);
    assert.throws(() => readResourceRequest(s, "scope"), /编号/);
    assert.equal(s.getItem("alcor.resource-request:scope"), raw);
  }
});
test("small nonempty resources never display as zero, while unavailable capacity stays unknown", () => {
  assert.equal(resourceSize(31), "31 B");
  assert.equal(resourceSize(0), "0 B");
  assert.equal(resourceSize(1024), "1 KiB");
  assert.equal(resourceSize(1024 ** 3), "1 GiB");
  assert.equal(resourceSize(Number.NaN), "未知");
  assert.equal(resourceSize(-1), "未知");
});
