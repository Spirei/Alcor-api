import assert from "node:assert/strict";
import test from "node:test";
import { managementReadAllowed } from "../src/management-read-policy.ts";
test("activity feed joins ordinary read snapshots while financial daily summary and operation proofs stay excluded", () => {
  for (const path of [
    "/activities",
    "/profile/activity",
    "/users?q=member",
    "/tasks/owned",
    "/system/overview",
    "/connections/redis",
  ])
    assert.equal(managementReadAllowed(path), true, path);
  for (const path of [
    "/activities/daily-summary",
    "/activities?scope=all",
    "/cash",
    "/cash/operations/proof",
    "/trading/preview",
    "/portfolio/records",
    "/fees/confirmations/known-uuid",
    "/users/receipts/known-uuid",
    "/activities-extra",
  ])
    assert.equal(managementReadAllowed(path), false, path);
});
