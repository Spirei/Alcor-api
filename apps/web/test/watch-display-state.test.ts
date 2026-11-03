import assert from "node:assert/strict";
import test from "node:test";
import {
  WatchDisplayReadScope,
  watchRecordsPath,
  allDisplayedRecordsSelected,
  watchField,
  watchDisplayValue,
  arrangeWatchRows,
  type WatchDisplayState,
} from "../src/watch-display-state.ts";
import { groupRecordsPath, groupRecords } from "../src/watch-groups-state.ts";

test("actual visibility scope resumes reads without changing active prop and rejects old responses", () => {
  const scope = new WatchDisplayReadScope();
  assert.equal(scope.presence(true, true), true);
  const first = scope.begin();
  assert.equal(scope.current(first.generation), true);
  assert.equal(scope.presence(true, false), false);
  assert.equal(first.signal.aborted, true);
  assert.equal(scope.current(first.generation), false);
  assert.equal(scope.presence(true, true), true);
  const restored = scope.begin();
  assert.equal(scope.current(restored.generation), true);
  assert.equal(scope.presence(true, true), false);
  scope.invalidate();
  assert.equal(scope.current(restored.generation), false);
  assert.equal(restored.signal.aborted, true);
  scope.presence(false, false);
  assert.equal(scope.presence(true, true), true);
});
test("watch pagination carries display and collection versions; all mode preserves financial paths", () => {
  const revision = "a".repeat(64),
    original =
      "/portfolio/records?page=1&pageSize=25&brokerAccountId=owner-account";
  assert.equal(watchRecordsPath(original, false, null), original);
  const first = new URLSearchParams(
    watchRecordsPath(original, true, null).split("?")[1],
  );
  assert.equal(first.get("displayMode"), "watch");
  assert.equal(first.has("displayRevision"), false);
  assert.throws(() => groupRecordsPath(2, 3, "__all", "", null, "watch"));
  const next = new URLSearchParams(
    groupRecordsPath(2, 3, "__all", "owner-account", revision, "watch").split(
      "?",
    )[1],
  );
  assert.equal(next.get("collectionRevision"), "3");
  assert.equal(next.get("displayRevision"), revision);
  assert.equal(next.get("displayMode"), "watch");
  assert.equal(next.get("brokerAccountId"), "owner-account");
  assert.throws(() =>
    groupRecords(
      {
        records: [],
        total: 0,
        page: 1,
        pageSize: 25,
        collectionRevision: 1,
        displayMode: "watch",
      },
      1,
    ),
  );
});
test("display preferences use record IDs and preserve zero-visible selection semantics", () => {
  const rows = [
    { id: "record-A", name: "Original", market: "US", code: "SAME" },
    { id: "record-B", name: "Other", market: "US", code: "SAME" },
  ];
  const snapshot: WatchDisplayState = {
    version: 1,
    userId: "owner",
    namespace: "watch",
    fields: {
      [watchField("hidden", "record-B")]: { revision: 1, value: true },
      [watchField("aliases", "record-A")]: {
        revision: 1,
        value: "Display only",
      },
      [watchField("notes", "record-A")]: { revision: 1, value: "Display note" },
      [watchField("pinned", "record-A")]: { revision: 1, value: true },
    },
  };
  assert.deepEqual(
    arrangeWatchRows(snapshot, rows).map((row) => row.id),
    ["record-A"],
  );
  assert.equal(
    watchDisplayValue(snapshot, "aliases", "record-A"),
    "Display only",
  );
  assert.equal(watchDisplayValue(snapshot, "aliases", "record-B"), undefined);
  assert.equal(rows[0].name, "Original");
  assert.equal(allDisplayedRecordsSelected([], new Set(["record-A"])), false);
  assert.equal(allDisplayedRecordsSelected(rows, new Set(["record-A"])), false);
  assert.equal(
    allDisplayedRecordsSelected(rows, new Set(["record-A", "record-B"])),
    true,
  );
});
