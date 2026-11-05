import test from "node:test";
import assert from "node:assert/strict";
import {
  fireObservations,
  observationDate,
  observationRange,
} from "../src/fire-observation-state.ts";

test("observation dates use actual Shanghai day, reject missing timezone and invalid calendar days", () => {
  assert.equal(observationDate("2026-12-31T16:00:00Z"), "2027-01-01");
  assert.equal(observationDate("2026-01-01T00:00:00+08:00"), "2026-01-01");
  assert.equal(observationDate("2024-02-29T00:00:00Z"), "2024-02-29");
  for (const value of [
    null,
    "2026-02-29T00:00:00Z",
    "2026-02-30T00:00:00Z",
    "2026-01-01",
    "2026-01-01T00:00:00",
    "not a date",
  ])
    assert.equal(observationDate(value), null);
});
test("observations preserve exact original amount and missing values, don't mutate history or invent changes", () => {
  const input = [
    {
      recordedAt: "2026-01-05T16:00:00Z",
      amountBase: "0.000000000000000001",
      currency: "CNY",
    },
    {
      recordedAt: "2026-01-04T16:00:00Z",
      amountBase: 0,
      amountUsd: 0,
      currency: "USD",
    },
    { recordedAt: "2026-01-01T00:00:00" },
  ];
  const before = structuredClone(input);
  const result = fireObservations(input);
  assert.deepEqual(input, before);
  assert.equal(result.invalid, 1);
  assert.equal(result.records[0].date, "2026-01-05");
  assert.equal(result.records[0].amountBase, "0");
  assert.equal(result.records[1].amountBase, "0.000000000000000001");
  assert.equal(result.records[1].amountUsd, "");
  assert.equal(Object.hasOwn(result.records[1], "profit"), false);
});
test("periods select actual observations with gaps and year boundaries, without filling missing dates", () => {
  const records = fireObservations(
    ["2025-12-31", "2026-01-01", "2026-01-04", "2026-01-05", "2026-02-01"].map(
      (day) => ({ recordedAt: day + "T01:00:00+08:00" }),
    ),
  ).records;
  const days = (period) =>
    observationRange(records, "2026-01-04", period).map((row) => row.date);
  assert.deepEqual(days("day"), ["2026-01-04"]);
  assert.deepEqual(days("week"), ["2025-12-31", "2026-01-01", "2026-01-04"]);
  assert.deepEqual(days("month"), ["2026-01-01", "2026-01-04", "2026-01-05"]);
  assert.deepEqual(days("total"), ["2025-12-31", "2026-01-01", "2026-01-04"]);
  assert.deepEqual(observationRange(records, "bad", "day"), []);
});
