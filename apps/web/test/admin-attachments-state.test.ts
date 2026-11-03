import test from "node:test";
import assert from "node:assert/strict";
import {
  attachmentCommand,
  attachmentReceipt,
  clearAttachmentRequests,
  readAttachmentRequest,
  releaseAttachmentRequest,
  retainAttachmentRequest,
} from "../src/admin-attachments-state.ts";
function store() {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}
const id = "448fca63-e431-4968-86c0-d701c60046bf",
  next = "558fca63-e431-4968-86c0-d701c60046bf";
test("shared attachment journal stores only UUID and cannot overwrite an unknown original operation", () => {
  const s = store();
  retainAttachmentRequest(s, "scope", id);
  assert.equal(s.getItem("alcor.admin-attachment-request:scope"), id);
  assert.throws(() => retainAttachmentRequest(s, "scope", next), /原操作/);
  assert.equal(readAttachmentRequest(s, "scope"), id);
  releaseAttachmentRequest(s, "scope", next);
  assert.equal(readAttachmentRequest(s, "scope"), id);
  releaseAttachmentRequest(s, "scope", id);
  assert.equal(readAttachmentRequest(s, "scope"), null);
});
test("identity transition clears shared attachment coordinates without touching personal resource or preferences", () => {
  const s = store();
  s.setItem("alcor.resource-request:scope", id);
  s.setItem("appearance", "dark");
  retainAttachmentRequest(s, "old", id);
  assert.equal(readAttachmentRequest(s, "new"), null);
  retainAttachmentRequest(s, "new", next);
  releaseAttachmentRequest(s, "old", id);
  assert.equal(readAttachmentRequest(s, "new"), next);
  clearAttachmentRequests(s);
  assert.equal(s.length, 2);
});
test("corrupt coordinates never become arbitrary URLs or replace retained original evidence", () => {
  const s = store();
  s.setItem("alcor.admin-attachment-request:scope", "../../private");
  assert.throws(() => readAttachmentRequest(s, "scope"), /编号/);
  assert.throws(() => retainAttachmentRequest(s, "scope", id), /编号/);
  assert.equal(
    s.getItem("alcor.admin-attachment-request:scope"),
    "../../private",
  );
});
test("only same UUID and admin_shared terminal receipts release the original operation", () => {
  const good = {
    requestId: id,
    namespace: "admin_shared",
    state: "completed",
    revision: 2,
    httpStatus: 200,
    result: { ok: true, path: "one" },
    message: "ok",
  };
  assert.deepEqual(attachmentReceipt(good, id), good);
  for (const bad of [
    { ...good, requestId: next },
    { ...good, namespace: "personal" },
    { ...good, state: "pending" },
    { ...good, revision: 0 },
    { ...good, httpStatus: 503 },
    { ...good, message: { fake: true } },
  ])
    assert.throws(() => attachmentReceipt(bad, id), /回执/);
  assert.equal(
    attachmentReceipt(
      { ...good, state: "failed", httpStatus: 409, result: null },
      id,
    ).state,
    "failed",
  );
});
test("DELETE contract puts path and force in query while body carries exactly CAS and original UUID", () => {
  const command = attachmentCommand(
    "delete",
    { path: "报告/a?.txt", force: true },
    7,
    id,
  );
  assert.equal(command.method, "DELETE");
  const url = new URL(command.path, "https://example.invalid");
  assert.equal(url.pathname, "/admin/attachments");
  assert.equal(url.searchParams.get("path"), "报告/a?.txt");
  assert.equal(url.searchParams.get("force"), "1");
  assert.deepEqual(JSON.parse(command.body), {
    expectedRevision: 7,
    requestId: id,
  });
});
test("rename move and copy retain current revision and original UUID without invented financial or owner scope", () => {
  for (const action of ["rename", "move", "copy"]) {
    const value = attachmentCommand(
      action,
      {
        source: "one",
        name: "two",
        targetDir: "archive",
        conflict: "keep-both",
      },
      8,
      id,
    );
    assert.equal(value.path, "/admin/attachments");
    assert.equal(value.method, "POST");
    assert.deepEqual(JSON.parse(value.body), {
      action,
      source: "one",
      name: "two",
      targetDir: "archive",
      conflict: "keep-both",
      expectedRevision: 8,
      requestId: id,
    });
  }
  assert.throws(() => attachmentCommand("copy", {}, 0, id));
  assert.throws(() => attachmentCommand("copy", {}, 2, "../../private"));
});
