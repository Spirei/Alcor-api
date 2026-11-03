import assert from "node:assert/strict";
import test from "node:test";
import {
  bindApiSession,
  apiSessionSnapshot,
  isCurrentApiSession,
} from "../src/api-session.ts";
import {
  clearLegacyImportRequests,
  readLegacyImportRequest,
  retainLegacyImportRequest,
  releaseLegacyImportRequest,
  sourceOriginalBytes,
  SourceDownloadError,
  sourceOperationLabel,
  sourcePermissionLabel,
  sourceFinancialReceiptLabel,
  sourceBlockerLabel,
  sourceSessionMatches,
  clearLegacyImportScope,
} from "../src/legacy-import-state.ts";

function storage() {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (n: number) => [...data.keys()][n] ?? null,
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
  next = "558fca63-e431-4968-86c0-d701c60046bf",
  digest = "a".repeat(64);
test("only an original UUID persists; unknown registration/consent/export bodies cannot be replayed", () => {
  const s = storage();
  retainLegacyImportRequest(s, "owner", id);
  assert.equal(s.getItem("alcor.legacy-import-request:owner"), id);
  assert.throws(() => retainLegacyImportRequest(s, "owner", next), /先查询/);
  releaseLegacyImportRequest(s, "owner", next);
  assert.equal(readLegacyImportRequest(s, "owner"), id);
  releaseLegacyImportRequest(s, "owner", id);
  assert.equal(readLegacyImportRequest(s, "owner"), null);
  s.setItem(
    "alcor.legacy-import-request:owner",
    JSON.stringify({ id, password: "must-never-restore" }),
  );
  assert.throws(() => readLegacyImportRequest(s, "owner"), /编号/);
});
test("identity/scope change clears old journal; late completion cannot erase new owner evidence", () => {
  const s = storage();
  s.setItem("appearance", "dark");
  retainLegacyImportRequest(s, "old", id);
  assert.equal(readLegacyImportRequest(s, "new"), null);
  retainLegacyImportRequest(s, "new", next);
  releaseLegacyImportRequest(s, "old", id);
  clearLegacyImportScope(s, "old");
  assert.equal(readLegacyImportRequest(s, "new"), next);
  clearLegacyImportRequests(s);
  assert.equal(s.length, 1);
  assert.equal(sourceOperationLabel("reading"), "读取未确认");
  assert.equal(
    sourcePermissionLabel("source_registry_unavailable_or_changed"),
    "来源登记缺失或已变化",
  );
});
function response(bytes: string, headers: Record<string, string> = {}) {
  return new Response(bytes, {
    headers: {
      etag: `"${digest}"`,
      "content-length": String(new TextEncoder().encode(bytes).length),
      ...headers,
    },
  });
}
test("original bytes use same-origin Cookie, displayed-session CSRF and exact server digest/length", async () => {
  const binding = { csrf: "displayed-session", current: () => true };
  let calls = 0;
  const blob = await sourceOriginalBytes(
    id,
    digest,
    binding,
    new AbortController().signal,
    async (path, init) => {
      calls++;
      assert.equal(path, `/api/legacy-financial/manifests/${id}/raw`);
      assert.equal(init?.credentials, "same-origin");
      assert.equal(init?.redirect, "error");
      assert.equal(
        (init?.headers as Record<string, string>)["X-CSRF-Token"],
        binding.csrf,
      );
      return response('{"original":true}');
    },
  );
  assert.equal(await blob.text(), '{"original":true}');
  assert.equal(calls, 1);
  await assert.rejects(
    sourceOriginalBytes(
      "../../secret",
      digest,
      binding,
      new AbortController().signal,
      async () => {
        throw new Error("must not fetch");
      },
    ),
    /编号/,
  );
});
test("session epoch changes before headers or during body never produce a downloadable Blob", async () => {
  bindApiSession("old");
  const binding = apiSessionSnapshot();
  assert.ok(sourceSessionMatches("old", binding));
  assert.ok(!sourceSessionMatches("other-displayed-session", binding));
  await assert.rejects(
    sourceOriginalBytes(
      id,
      digest,
      { csrf: "old", current: () => isCurrentApiSession(binding) },
      new AbortController().signal,
      async () => {
        bindApiSession("new");
        return response("original");
      },
    ),
    /身份已变化/,
  );
  bindApiSession("old-again");
  const second = apiSessionSnapshot();
  let send!: ReadableStreamDefaultController<Uint8Array>,
    cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      send = c;
    },
    cancel() {
      cancelled = true;
    },
  });
  const promise = sourceOriginalBytes(
    id,
    digest,
    { csrf: "old-again", current: () => isCurrentApiSession(second) },
    new AbortController().signal,
    async () =>
      new Response(stream, {
        headers: { etag: `"${digest}"`, "content-length": "3" },
      }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  bindApiSession(null);
  send.enqueue(new Uint8Array([1, 2, 3]));
  await assert.rejects(promise, /身份已变化/);
  assert.ok(cancelled);
});
test("wrong digest, truncation, extra bytes, unbounded length and authorization failures cannot download", async () => {
  const context = { csrf: "displayed", current: () => true },
    signal = new AbortController().signal;
  for (const value of [
    response("a", { etag: '"wrong"' }),
    response("a", { "content-length": "2" }),
    response("ab", { "content-length": "1" }),
    response("a", { "content-length": String(64 * 1024 * 1024 + 1) }),
  ])
    await assert.rejects(
      sourceOriginalBytes(id, digest, context, signal, async () => value),
    );
  for (const status of [401, 403])
    await assert.rejects(
      sourceOriginalBytes(
        id,
        digest,
        context,
        signal,
        async () => new Response("", { status }),
      ),
      (error: unknown) =>
        error instanceof SourceDownloadError && error.status === status,
    );
});

test("unknown financial evidence never becomes zero or a completed migration", () => {
  assert.equal(sourceFinancialReceiptLabel(null), "金融导入回执待核对");
  assert.equal(sourceFinancialReceiptLabel(0), "此清单暂无已确认金融导入回执");
  assert.equal(sourceFinancialReceiptLabel(1), "已确认金融导入回执 1 条");
  assert.equal(
    sourceBlockerLabel({ code: "stored_binary_number_not_original_decimal" }),
    "原始十进制数值无法核实",
  );
  assert.ok(
    sourceBlockerLabel({ code: "new_unknown_reason" }).includes(
      "new_unknown_reason",
    ),
  );
});
