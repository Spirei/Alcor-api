import assert from "node:assert/strict";
import test from "node:test";
import {
  clearGroupRequests,
  readGroupRequest,
  retainGroupRequest,
  releaseGroupRequest,
  groupListing,
  groupRecords,
  groupReceipt,
  groupCommand,
  groupLabel,
  groupName,
  groupRecordsPath,
  type WatchGroup,
} from "../src/watch-groups-state.ts";
const id = "448fca63-e431-4968-86c0-d701c60046bf",
  other = "558fca63-e431-4968-86c0-d701c60046bf";
const market: WatchGroup = {
  id: "market-owned",
  name: "美股",
  kind: "market",
  market: "US",
  sort: 0,
  visible: -1,
  revision: 1,
};
const custom: WatchGroup = {
  id: "custom-owned",
  name: "观察",
  kind: "custom",
  market: "",
  sort: 1,
  visible: 0,
  revision: 2,
};
const list = { revision: 7, initialized: true, groups: [market, custom] };
const record = {
  id: "mapped-platform-record",
  name: "合成记录",
  code: "SYN",
  market: "US",
  watchGroupId: "legacy-unmapped-id",
};
const page = {
  records: [record],
  total: 1,
  page: 1,
  pageSize: 25,
  collectionRevision: 23,
};
function storage() {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
    values: () => [...m.values()],
  };
}
test("watch group journal persists only the original UUID and never overwrites an unknown request", () => {
  const s = storage();
  retainGroupRequest(s, "owner-admin", id);
  assert.deepEqual(s.values(), [id]);
  assert.throws(() => retainGroupRequest(s, "owner-admin", other), /先核对/);
  releaseGroupRequest(s, "owner-admin", other);
  assert.equal(readGroupRequest(s, "owner-admin"), id);
  assert.equal(readGroupRequest(s, "owner-user"), null);
  assert.equal(s.length, 0);
  retainGroupRequest(s, "owner-user", other);
  clearGroupRequests(s);
  assert.equal(s.length, 0);
});
test("explicit initialization and preference commands retain canonical CAS and exact visible values", () => {
  assert.deepEqual(
    groupCommand(
      { ...list, revision: 0, initialized: false, groups: [] },
      "initialize",
      {},
      id,
    ),
    { requestId: id, expectedRevision: 0, action: "initialize", data: {} },
  );
  assert.deepEqual(
    groupCommand(list, "create", { name: "  新分组 " }, id).data,
    { name: "新分组" },
  );
  for (const value of ["-1", "0", "1"])
    assert.deepEqual(
      groupCommand(
        list,
        "update",
        { id: custom.id, name: "改名", visible: value },
        id,
      ),
      {
        requestId: id,
        expectedRevision: 7,
        action: "update",
        data: { id: custom.id, name: "改名", visible: Number(value) },
      },
    );
  assert.throws(
    () =>
      groupCommand(
        list,
        "update",
        { id: custom.id, name: "x", visible: "" },
        id,
      ),
    /显示方式/,
  );
  assert.throws(
    () => groupCommand(list, "delete", { id: market.id }, id),
    /仅自定义/,
  );
  assert.throws(
    () =>
      groupCommand(
        list,
        "update",
        { id: "another-owner", name: "x", visible: 1 },
        id,
      ),
    /已变化/,
  );
});
test("name length follows actual legacy UTF16 contract rather than silently truncating emoji", () => {
  assert.equal(groupName("😀".repeat(15)), "😀".repeat(15));
  for (const value of ["😀".repeat(16), "", "x\ny", "x\u007f"])
    assert.throws(() => groupName(value));
});
test("record assignment carries both snapshot revisions and only loaded mapped record IDs", () => {
  assert.deepEqual(
    groupCommand(
      list,
      "assign",
      { ids: [record.id], groupId: custom.id },
      id,
      page,
    ),
    {
      requestId: id,
      expectedRevision: 7,
      action: "assign",
      data: { ids: [record.id], groupId: custom.id, collectionRevision: 23 },
    },
  );
  assert.equal(
    groupCommand(list, "assign", { ids: [record.id], groupId: "" }, id, page)
      .data.groupId,
    "",
  );
  for (const fields of [
    { ids: ["legacy-source-id"], groupId: custom.id },
    { ids: [record.id], groupId: market.id },
    { ids: [record.id, record.id], groupId: custom.id },
    { ids: [], groupId: custom.id },
  ])
    assert.throws(
      () => groupCommand(list, "assign", fields, id, page),
      /重新读取/,
    );
  assert.throws(
    () =>
      groupCommand(
        list,
        "assign",
        { ids: [record.id], groupId: custom.id },
        id,
        null,
      ),
    /重新读取/,
  );
});
test("page projection keeps identity and actual totals while dropping financial amounts and unknown mapping remains unknown", () => {
  const safe = groupRecords(
    {
      ...page,
      records: [
        {
          ...record,
          qty: "999",
          cost: "123",
          price: "456",
          source: { secret: "not-retained" },
        },
      ],
      extraFinancial: "not-retained",
    },
    1,
  );
  assert.deepEqual(safe, { ...page, displayRevision: undefined, membershipBasis: undefined });
  assert.ok(!JSON.stringify(safe).includes("999"));
  assert.equal(
    groupLabel("legacy-unmapped-id", list.groups),
    "分组待核对 · legacy-unmapped-id",
  );
  assert.equal(groupLabel(custom.id, list.groups), "观察");
  assert.equal(groupLabel("", list.groups), "未分组");
  assert.throws(
    () => groupRecords({ ...page, records: [record, record] }, 1),
    /待核对/,
  );
  assert.throws(() => groupRecords({ ...page, records: [null] }, 1), /待核对/);
  assert.throws(() => groupRecords({ ...page, total: 0 }, 1), /待核对/);
});
test("receipt validation accepts terminal no-op zero and rejects a different UUID or shape", () => {
  for (const result of [
    { group: custom },
    { initialized: true },
    { deleted: false },
    { updated: 0, collectionRevision: 23 },
  ])
    assert.equal(
      groupReceipt({ requestId: id, revision: 7, ...result }, id).requestId,
      id,
    );
  for (const value of [
    { requestId: other, revision: 7, deleted: true },
    { requestId: id, revision: 7 },
    { requestId: id, revision: 7, state: "completed" },
    { requestId: id, revision: 7, updated: -1 },
  ])
    assert.throws(() => groupReceipt(value, id), /回执/);
});
test("read listing never invents initialization and record paging pins the collection and exact account/view", () => {
  assert.deepEqual(
    groupListing({ revision: 0, initialized: false, groups: [] }),
    { revision: 0, initialized: false, groups: [] },
  );
  assert.throws(
    () => groupListing({ ...list, groups: [custom, custom] }),
    /待核对/,
  );
  assert.throws(() => groupRecordsPath(2, null, "__all", ""), /第一页/);
  const path = groupRecordsPath(2, 23, custom.id, "account-with-scope");
  const query = new URL("https://synthetic.invalid" + path).searchParams;
  assert.equal(query.get("collectionRevision"), "23");
  assert.equal(query.get("view"), custom.id);
  assert.equal(query.get("brokerAccountId"), "account-with-scope");
});
