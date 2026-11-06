import test from "node:test";
import assert from "node:assert/strict";
import {
  watchRowDraft,
  reconcileWatchDrafts,
  watchDraftChanges,
} from "../src/watch-edit-state.ts";
import {
  watchField,
  type WatchDisplayState,
} from "../src/watch-display-state.ts";

function snapshot(alias = "Original", revision = 3): WatchDisplayState {
  return {
    version: 1,
    userId: "synthetic-owner",
    namespace: "watch",
    fields: {
      [watchField("aliases", "record-a")]: { revision, value: alias },
      [watchField("notes", "record-a")]: {
        revision: 2,
        value: "Original note",
      },
    },
  };
}
test("another client update refreshes display without rebasing an unsaved alias or its original CAS", () => {
  const draft = {
    ...watchRowDraft(snapshot(), "record-a"),
    alias: "My unsaved alias",
  };
  const remote = snapshot("Changed in App", 4);
  const kept = reconcileWatchDrafts({ "record-a": draft }, remote);
  assert.equal(kept["record-a"].alias, "My unsaved alias");
  assert.deepEqual(
    watchDraftChanges(kept["record-a"], "record-a", ["alias", "note"]),
    [
      {
        key: watchField("aliases", "record-a"),
        value: "My unsaved alias",
        revision: 3,
      },
      {
        key: watchField("notes", "record-a"),
        value: "Original note",
        revision: 2,
      },
    ],
  );
  assert.equal(remote.fields[watchField("aliases", "record-a")].revision, 4);
});
test("an acknowledged edit clears only drafts now represented by the confirmed state", () => {
  const first = {
    ...watchRowDraft(snapshot(), "record-a"),
    alias: "Saved alias",
  };
  const second = {
    ...watchRowDraft(snapshot(), "record-b"),
    note: "Another unsaved row",
  };
  const kept = reconcileWatchDrafts(
    { "record-a": first, "record-b": second },
    snapshot("Saved alias", 4),
  );
  assert.equal(kept["record-a"], undefined);
  assert.equal(kept["record-b"].note, "Another unsaved row");
});
test("clearing a field retains its original revision and sends null rather than an invented value", () => {
  const draft = { ...watchRowDraft(snapshot(), "record-a"), alias: "" };
  assert.deepEqual(watchDraftChanges(draft, "record-a", ["alias"]), [
    { key: watchField("aliases", "record-a"), value: null, revision: 3 },
  ]);
  assert.deepEqual(reconcileWatchDrafts({ "record-a": draft }, null), {});
});
