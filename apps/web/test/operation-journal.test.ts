import test from "node:test";
import assert from "node:assert/strict";
import {
  clearOperationJournal,
  restoreOperation,
  saveOperation,
  updateOperation,
} from "../src/operation-journal.ts";
function storage() {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (i: number) => Array.from(data.keys())[i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
const id = "448fca63-e431-4968-86c0-d701c60046bf";
test("refresh restores only the original receipt locator and never financial input or proof", () => {
  const s = storage();
  saveOperation(s, "instance/user/session", {
    id,
    kind: "record",
    submissionStatus: 0,
  });
  assert.deepEqual(restoreOperation(s, "instance/user/session"), {
    id,
    kind: "record",
    submissionStatus: 0,
  });
  assert.deepEqual(restoreOperation(s, "instance/user/session"), {
    id,
    kind: "record",
    submissionStatus: 0,
  });
  assert.equal(s.length, 1);
});
test("identity or session change clears pending metadata and logout removes only journal keys", () => {
  const s = storage();
  s.setItem("appearance", "dark");
  saveOperation(s, "old", { id, kind: "broker" });
  assert.equal(restoreOperation(s, "new"), null);
  assert.equal(s.length, 1);
  saveOperation(s, "new", { id, kind: "record" });
  clearOperationJournal(s);
  assert.equal(s.getItem("appearance"), "dark");
  assert.equal(s.length, 1);
});
test("corrupt or injected journal content cannot become a receipt path", () => {
  const s = storage();
  s.setItem(
    "alcor.pending-operation:scope",
    JSON.stringify({ id: "../../users", kind: "record", preview: "secret" }),
  );
  assert.throws(() => restoreOperation(s, "scope"), /操作编号/);
  assert.equal(s.length, 1);
});

test("late responses cannot revive a logged-out scope or overwrite a newer operation", () => {
  const s = storage();
  saveOperation(s, "scope", { id, kind: "record" });
  clearOperationJournal(s);
  assert.equal(
    updateOperation(s, "scope", id, {
      id,
      kind: "record",
      submissionStatus: 0,
    }),
    false,
  );
  assert.equal(s.length, 0);
  const next = "558fca63-e431-4968-86c0-d701c60046bf";
  saveOperation(s, "scope", { id: next, kind: "broker" });
  assert.equal(updateOperation(s, "scope", id, null), false);
  assert.equal(restoreOperation(s, "scope")?.id, next);
  assert.equal(updateOperation(s, "scope", next, null), true);
  assert.equal(restoreOperation(s, "scope"), null);
});

test("restoration failure does not destroy the only copy of an unresolved UUID", () => {
  const s = storage();
  saveOperation(s, "scope", { id, kind: "record", submissionStatus: 0 });
  const before = s.getItem("alcor.pending-operation:scope");
  const broken = {
    ...s,
    setItem: () => {
      throw new Error("storage blocked");
    },
  };
  assert.throws(() => restoreOperation(broken, "scope"), /storage blocked/);
  assert.equal(s.getItem("alcor.pending-operation:scope"), before);
  assert.equal(restoreOperation(s, "scope")?.id, id);
});

test("only receipt coordinates survive restored metadata", () => {
  const s = storage();
  s.setItem(
    "alcor.pending-operation:scope",
    JSON.stringify({
      id,
      kind: "record",
      amount: "42",
      previewId: "proof",
      token: "not-stored",
      submissionStatus: 0,
    }),
  );
  assert.deepEqual(restoreOperation(s, "scope"), {
    id,
    kind: "record",
    submissionStatus: 0,
  });
  assert.deepEqual(JSON.parse(s.getItem("alcor.pending-operation:scope")!), {
    id,
    kind: "record",
    submissionStatus: 0,
  });
});

test("financial domains restore their own receipt paths without storing financial inputs", async () => {
  const { operationPath } = await import("../src/operation-journal.ts");
  for (const [kind, path] of [
    ["cash", "/cash"],
    ["trade", "/trading"],
    ["order", "/trading/orders"],
  ] as const) {
    const s = storage();
    saveOperation(s, "session", { id, kind, submissionStatus: 0 });
    const restored = restoreOperation(s, "session")!;
    assert.equal(operationPath(restored.kind), path);
    assert.equal(restored.id, id);
    assert.deepEqual(
      Object.keys(
        JSON.parse(s.getItem("alcor.pending-operation:session")!),
      ).sort(),
      ["id", "kind", "submissionStatus"],
    );
    assert.equal(updateOperation(s, "session", id, null), true);
  }
});

test("a second module cannot replace the only unresolved financial receipt", () => {
  const s = storage();
  saveOperation(s, "scope", { id, kind: "fee_repair" });
  assert.throws(
    () =>
      saveOperation(s, "scope", {
        id: "558fca63-e431-4968-86c0-d701c60046bf",
        kind: "trade",
      }),
    /尚未核对/,
  );
  assert.throws(
    () => saveOperation(s, "scope", { id, kind: "fee_plan" }),
    /尚未核对/,
  );
  assert.deepEqual(restoreOperation(s, "scope"), { id, kind: "fee_repair" });
  assert.equal(updateOperation(s, "scope", id, null), true);
  saveOperation(s, "scope", { id, kind: "fee_plan" });
  assert.deepEqual(restoreOperation(s, "scope"), { id, kind: "fee_plan" });
});
