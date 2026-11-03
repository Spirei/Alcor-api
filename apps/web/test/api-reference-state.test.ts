import assert from "node:assert/strict";
import test from "node:test";
import {
  referenceReceipt,
  retainReferenceOperation,
} from "../src/api-reference-state.ts";

test("unknown outcome retains only original UUID and storage failure blocks a new document write", () => {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) || null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
  retainReferenceOperation(storage, "instance/owner/version", "original-id");
  assert.equal(entries.get("instance/owner/version"), "original-id");
  assert.throws(
    () =>
      retainReferenceOperation(
        storage,
        "instance/owner/version",
        "replacement-id",
      ),
    /原文档操作/,
  );
  assert.throws(
    () =>
      retainReferenceOperation(
        { getItem: () => null, setItem: () => {} },
        "another",
        "id",
      ),
    /保存原操作编号/,
  );
  assert.equal(
    referenceReceipt(
      { requestId: "original-id", state: "closed", status: 409 },
      "original-id",
    ).state,
    "closed",
  );
  assert.throws(
    () =>
      referenceReceipt(
        {
          requestId: "other-id",
          state: "completed",
          status: 200,
          revision: "a".repeat(64),
        },
        "original-id",
      ),
    /回执无效/,
  );
});
