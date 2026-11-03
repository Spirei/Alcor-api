import test from "node:test";
import assert from "node:assert/strict";
import {
  submissionDisposition,
  mayReleaseMissingReceipt,
  recordsPagePath,
  accountLabel,
  previewAccountLabel,
} from "../src/portfolio-operation.ts";

test("lost fill response retains its UUID even when receipt is not visible yet", () => {
  for (const status of [undefined, 0, 408, 499, 500, 502, 503, 504, 409]) {
    assert.equal(submissionDisposition(status), "lookup");
  }
  assert.equal(mayReleaseMissingReceipt(0), false);
  assert.equal(mayReleaseMissingReceipt(503), false);
  assert.equal(mayReleaseMissingReceipt(undefined), false);
  assert.equal(mayReleaseMissingReceipt(409), true);
});

test("definite rejected HTTP inputs can be corrected without resending an unknown write", () => {
  for (const status of [400, 401, 403, 404, 413, 422, 429])
    assert.equal(submissionDisposition(status), "rejected");
});

test("later pages must use the first page collection revision", () => {
  assert.equal(
    recordsPagePath(1, null),
    "/portfolio/records?page=1&pageSize=25",
  );
  assert.equal(
    recordsPagePath(2, 12),
    "/portfolio/records?page=2&pageSize=25&collectionRevision=12",
  );
  assert.throws(() => recordsPagePath(2, null));
});

test("unknown account association cannot be displayed as unassigned or inferred from a label", () => {
  const brokers = [{ id: "account-a", name: "Directory label" }];
  assert.equal(accountLabel("", brokers), "未归属");
  assert.equal(accountLabel("account-a", brokers), "Directory label");
  assert.equal(accountLabel("account-b", brokers), "账户待核对 · account-b");
  assert.equal(
    previewAccountLabel("", { group: "A remembered broker label" }),
    "未归属",
  );
  assert.equal(
    previewAccountLabel("account-a", { group: "Confirmed new label" }),
    "Confirmed new label · account-a",
  );
  assert.equal(previewAccountLabel("account-a", {}), "账户待核对 · account-a");
});

test("explicit account paging keeps its scope and encodes opaque IDs", () => {
  assert.equal(
    recordsPagePath(1, null, "account/a&b"),
    "/portfolio/records?page=1&pageSize=25&brokerAccountId=account%2Fa%26b",
  );
  assert.equal(
    recordsPagePath(2, 7, "account-a"),
    "/portfolio/records?page=2&pageSize=25&collectionRevision=7&brokerAccountId=account-a",
  );
});
