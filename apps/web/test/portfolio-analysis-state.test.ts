import test from "node:test";
import assert from "node:assert/strict";
import {
  analysisToday,
  analysisRange,
  observedPricePlot,
} from "../src/portfolio-analysis-state.ts";
const custom = { start: "2026-01-01", through: "2026-11-05" };
test("analysis uses Shanghai calendar and the entire selected range, not recent available bars", () => {
  assert.equal(analysisToday(new Date("2026-12-31T16:00:00Z")), "2027-01-01");
  assert.deepEqual(analysisRange("ytd", "2026-11-05", custom), {
    start: "2026-01-01",
    through: "2026-11-05",
    days: 309,
  });
  assert.deepEqual(analysisRange("month", "2026-11-05", custom), {
    start: "2026-11-01",
    through: "2026-11-05",
    days: 60,
  });
  assert.equal(analysisRange("6m", "2026-08-31", custom)?.start, "2026-02-28");
  assert.equal(analysisRange("1y", "2024-02-29", custom)?.start, "2023-02-28");
  assert.equal(analysisRange("retained", "2026-11-05", custom)?.days, 1200);
  for (const range of [
    { start: "2026-02-29", through: "2026-11-05" },
    { start: "2027-01-01", through: "2026-11-05" },
    { start: "2026-01-01", through: "2027-01-01" },
    { start: "2000-01-01", through: "2026-11-05" },
  ])
    assert.equal(analysisRange("custom", "2026-11-05", range), null);
});
test("price drawings use actual date spacing and leave missing observations disconnected", () => {
  const rows = [
    { d: "2026-11-01", c: "12.000000000000000001" },
    { d: "2026-11-02", c: "13" },
    { d: "2026-11-05", c: "14" },
  ];
  const before = structuredClone(rows);
  const result = observedPricePlot(rows, {
    start: "2026-01-01",
    through: "2026-11-05",
  })!;
  assert.deepEqual(rows, before);
  assert.equal(result.points[0].c, "12.000000000000000001");
  assert.ok(result.points[0].x > 560);
  assert.equal(result.points.at(-1)?.x, 576);
  assert.equal((result.path.match(/M /g) || []).length, 2);
  assert.equal((result.path.match(/L /g) || []).length, 1);
  const narrowed = observedPricePlot(rows, {
    start: "2026-11-03",
    through: "2026-11-05",
  })!;
  assert.equal(narrowed.points.length, 1);
  assert.equal(narrowed.points[0].x, 576);
  assert.deepEqual(
    observedPricePlot(rows, { start: "2026-01-01", through: "2026-01-10" }),
    { points: [], path: "" },
  );
});
test("invalid dates, duplicate dates and values that cannot be drawn don't become fabricated geometry", () => {
  const range = { start: "2026-01-01", through: "2026-12-31" };
  for (const c of ["NaN", "Infinity", "1e999", "1e-999", ""])
    assert.equal(observedPricePlot([{ d: "2026-01-01", c }], range), null);
  assert.equal(observedPricePlot([{ d: "2026-02-30", c: "1" }], range), null);
  assert.equal(
    observedPricePlot(
      [
        { d: "2026-01-01", c: "1" },
        { d: "2026-01-01", c: "2" },
      ],
      range,
    ),
    null,
  );
});
