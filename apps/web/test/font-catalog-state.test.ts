import assert from "node:assert/strict";
import test from "node:test";
import {
  fontCatalogSummary,
  fontCatalogPage,
  fontCatalogReceipt,
  fontCatalogSources,
  retainFontCatalogRequest,
  readFontCatalogRequest,
  clearFontCatalogRequest,
} from "../src/font-catalog-state.ts";
const id = "6d61c2ca-8c53-4de0-8e89-d26722d61606",
  other = "4c6d11a6-e939-4bcc-a874-59ece08054e9",
  sha = "a".repeat(64);
const summary = {
  id,
  requestId: id,
  sourceAlias: "registered-old",
  sourceInstance: "original-source",
  sha256: sha,
  scanState: "sealed",
  truncated: false,
  changed: false,
  ignored: 1,
  visited: 2,
  maxEntries: 1000,
  counts: {
    knownItems: 1,
    sourceBlocked: 0,
    unassigned: 1,
    pendingConfirmation: 0,
    authorizedNotCaptured: 0,
    archived: 0,
    mapped: 0,
    revoked: 0,
    ownerClosed: 0,
    ownerDisabled: 0,
    historyGap: 0,
  },
  contentVerified: false,
  historicalUploaderVerified: false,
  entireSourceComplete: false,
  instanceReenrollmentRequired: false,
};
const item = {
  ordinal: 0,
  originalId: `custom-831-${sha}.ttf`,
  filenameSha256: sha,
  size: null,
  metadataState: "candidate",
  reason: null,
  assignmentState: "unassigned",
  permissionId: null,
  ownerId: null,
  contentVerified: false,
  historicalUploaderVerified: false,
};
test("metadata listing preserves unknown content/owner and never upgrades filename SHA into verified original", () => {
  assert.equal(fontCatalogSummary(summary), summary);
  const page = { ...summary, items: [item], nextAfter: null };
  assert.equal(fontCatalogPage(page).items[0].size, null);
  for (const v of [
    { ...summary, contentVerified: true },
    { ...summary, historicalUploaderVerified: true },
    { ...summary, entireSourceComplete: true },
    { ...summary, truncated: true },
    { ...summary, changed: true },
  ])
    assert.throws(() => fontCatalogSummary(v));
  for (const change of [
    { ownerId: "guessed-from-831" },
    { originalId: "https://unapproved.example.invalid/font.ttf" },
    { filenameSha256: "b".repeat(64) },
    { size: -1 },
    { contentVerified: true },
    { historicalUploaderVerified: true },
  ])
    assert.throws(() =>
      fontCatalogPage({ ...page, items: [{ ...item, ...change }] }),
    );
});
test("counts and cursors cannot invent a complete migration or repeat a page", () => {
  for (const v of [
    { ...summary, visited: 0 },
    { ...summary, counts: { ...summary.counts, mapped: 1 } },
    { ...summary, counts: { ...summary.counts, unassigned: 2 } },
  ])
    assert.throws(() => fontCatalogSummary(v));
  assert.throws(() =>
    fontCatalogPage({ ...summary, items: [item], nextAfter: 12 }),
  );
  assert.throws(() =>
    fontCatalogPage({ ...summary, items: [item, item], nextAfter: null }),
  );
  assert.throws(() =>
    fontCatalogPage({ ...summary, items: null, nextAfter: null }),
  );
});
test("configuration absence is distinct from failed config and archive metadata remains a separate read", () => {
  for (const state of ["not_configured", "unavailable", "configured"]) {
    const raw = { configuration: { state }, items: [], maxEntries: 5000 };
    assert.equal(fontCatalogSources(raw).configuration.state, state);
  }
  assert.throws(() =>
    fontCatalogSources({
      configuration: { state: "configured" },
      items: [],
      maxEntries: 100000,
    }),
  );
});
test("global catalog receipt keeps original UUID and canceled/reading never mean archived fonts", () => {
  assert.equal(
    fontCatalogReceipt(
      {
        requestId: id,
        kind: "catalog",
        state: "reading",
        entireSourceComplete: false,
      },
      id,
    ).state,
    "reading",
  );
  assert.equal(
    fontCatalogReceipt(
      {
        requestId: id,
        kind: "catalog",
        state: "failed",
        canceled: true,
        entireSourceComplete: false,
      },
      id,
    ).state,
    "failed",
  );
  for (const v of [
    {
      requestId: other,
      kind: "catalog",
      state: "completed",
      catalogId: id,
      sha256: sha,
      entireSourceComplete: false,
    },
    {
      requestId: id,
      kind: "capture",
      state: "reading",
      entireSourceComplete: false,
    },
    {
      requestId: id,
      kind: "catalog",
      state: "completed",
      catalogId: id,
      sha256: sha,
      canceled: true,
      entireSourceComplete: false,
    },
  ])
    assert.throws(() => fontCatalogReceipt(v, id));
});
test("catalog journal only retains UUID in current session and refuses replacement", () => {
  const m = new Map<string, string>(),
    s = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => {
        m.set(k, v);
      },
      removeItem: (k: string) => {
        m.delete(k);
      },
      key: (i: number) => [...m.keys()][i] ?? null,
      get length() {
        return m.size;
      },
    };
  retainFontCatalogRequest(s, "scope", id);
  assert.equal([...m.values()][0], id);
  assert.throws(() => retainFontCatalogRequest(s, "scope", other));
  assert.equal(readFontCatalogRequest(s, "other-scope"), null);
  retainFontCatalogRequest(s, "other-scope", other);
  clearFontCatalogRequest(s);
  assert.equal(m.size, 0);
});
