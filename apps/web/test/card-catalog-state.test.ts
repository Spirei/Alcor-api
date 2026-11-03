import assert from "node:assert/strict";
import test from "node:test";
import {
  readCardOperation,
  releaseCardOperation,
  retainCardOperation,
} from "../src/card-catalog-state.ts";
function store() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}
test("an unknown request retains only its original UUID and operation kind across reload", () => {
  const memory = store(),
    pending = {
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "source_import" as const,
    };
  retainCardOperation(memory, "owner/session", pending);
  assert.deepEqual(readCardOperation(memory, "owner/session"), pending);
  assert.equal(
    JSON.stringify([...memory.values.values()]).includes("manifestText"),
    false,
  );
  assert.throws(() =>
    retainCardOperation(memory, "owner/session", {
      ...pending,
      requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    }),
  );
  assert.throws(() =>
    releaseCardOperation(
      memory,
      "owner/session",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ),
  );
  assert.deepEqual(readCardOperation(memory, "owner/session"), pending);
  releaseCardOperation(memory, "owner/session", pending.requestId);
  assert.equal(readCardOperation(memory, "owner/session"), null);
});
test("changing account/instance/session removes old pending state without copying its payload", () => {
  const memory = store();
  retainCardOperation(memory, "old-owner/session", {
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    kind: "custom_delete",
  });
  assert.equal(readCardOperation(memory, "other-owner/session"), null);
  assert.equal(memory.length, 0);
});
