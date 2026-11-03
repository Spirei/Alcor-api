import test from "node:test";
import assert from "node:assert/strict";
import { activityStats, calendarDays, countDay } from "../src/activity.ts";
import { requestLevel, requestStats } from "../src/activity.ts";

test("calendar preserves leap days and aligns columns to Monday without future observations", () => {
  const grid = calendarDays("2024-02-28", "2024-03-02");
  assert.deepEqual(grid.dates, [
    "2024-02-26",
    "2024-02-27",
    "2024-02-28",
    "2024-02-29",
    "2024-03-01",
    "2024-03-02",
    "2024-03-03",
  ]);
  assert.equal(grid.columns, 1);
});
test("streak crosses months, ends on a gap, and can continue from yesterday", () => {
  const days = [
    { date: "2026-09-29", login: 1, tasks: 0, profile: 0 },
    { date: "2026-09-30", login: 0, tasks: 2, profile: 0 },
    { date: "2026-10-01", login: 0, tasks: 0, profile: 1 },
    { date: "2026-10-02", login: 0, tasks: 0, profile: 0 },
  ];
  assert.deepEqual(activityStats(days, "all", "2026-10-02"), {
    active: 3,
    total: 4,
    longest: 3,
    current: 3,
  });
  assert.deepEqual(activityStats(days, "tasks", "2026-10-02"), {
    active: 1,
    total: 2,
    longest: 1,
    current: 0,
  });
  assert.equal(activityStats(days, "all", "2026-10-03").current, 0);
  assert.equal(countDay(days[1], "tasks"), 2);
});
test("unknown and missing dates never extend streaks or invent counts", () => {
  assert.deepEqual(activityStats([], "all", "2026-10-31"), {
    active: 0,
    total: 0,
    longest: 0,
    current: 0,
  });
  const days = ["2026-10-29", "2026-10-31"].map((date) => ({
    date,
    login: 1,
    tasks: 0,
    profile: 0,
  }));
  assert.equal(activityStats(days, "all", "2026-10-31").longest, 1);
  assert.equal(activityStats(days, "all", "2026-10-31").current, 1);
});
test("API request statistics keep real counts, collection gaps, and color boundaries", () => {
  assert.deepEqual(
    [undefined, 0, 1, 10, 11, 50, 51, 200, 201].map(requestLevel),
    ["unknown", 0, 1, 1, 2, 2, 3, 3, 4],
  );
  assert.deepEqual(
    requestStats(
      [
        { date: "2026-11-01", requests: 1234 },
        { date: "2026-11-02", requests: 0 },
      ],
      "2026-11-02",
    ),
    { active: 1, total: 1234, longest: 1, current: 1 },
  );
});
