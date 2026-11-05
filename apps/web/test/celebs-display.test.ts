import assert from "node:assert/strict";
import test from "node:test";
import {
  disclosedExact,
  disclosedText,
  disclosureChart,
  disclosureScope,
  disclosureReturnSummary,
  disclosedWeightSegments,
  disclosureReasonText,
} from "../src/celebs-display.ts";

test("source reasons use clear text while unknown diagnostic payloads stay out of the ordinary view", () => {
  assert.equal(
    disclosureReasonText("return_series_source_evidence_missing"),
    "观察来源尚未登记",
  );
  assert.equal(
    disclosureReasonText("return_observation_value_unknown"),
    "部分日期的观察值未知",
  );
  assert.equal(
    disclosureReasonText({ secret: "never show inline" }),
    "部分来源仍待核对，详情见来源依据",
  );
});

test("public exact values preserve decimal strings and genuine zero while missing/malformed values remain unknown", () => {
  for (const value of [
    null,
    undefined,
    "",
    "  ",
    "NaN",
    "Infinity",
    0,
    1.5,
    false,
    "0x10",
  ])
    assert.equal(disclosedExact(value), "未知");
  for (const value of [
    "0",
    "-0",
    "0.000000000000000001",
    "123456789123456789.123456789",
    "1e-999999",
  ])
    assert.equal(disclosedExact(value), value);
  assert.equal(disclosedText("  "), "未知");
  assert.equal(disclosedText(null), "未知");
  assert.equal(disclosedText("HK"), "HK");
});

test("summary keeps declared precise annual zero and never derives a 250 day return or infers one from points", () => {
  assert.deepEqual(
    disclosureReturnSummary({ y1: null, y3: "0", gain250: 30 }),
    { value: "0", label: "原声明 · 3年" },
  );
  assert.deepEqual(
    disclosureReturnSummary({ y1: "1.000000000000000001" }, true),
    { value: "1.000000000000000001", label: "保留声明 · 1年" },
  );
  assert.deepEqual(
    disclosureReturnSummary({
      y1: 12,
      gain250: 30,
      dates: ["2026-01-01"],
      values: ["5"],
    }),
    { value: null, label: "查看日期观察" },
  );
  assert.deepEqual(disclosureReturnSummary({}), {
    value: null,
    label: "未登记收益",
  });
});
test("disclosed weight ring preserves unknown space without normalizing or accepting impossible source weights", () => {
  const value = disclosedWeightSegments([
    { weight: "25.000000000000000001" },
    { weight: null },
    { weight: "15" },
  ]);
  assert.deepEqual(value.segments, [
    { index: 0, weight: 25, offset: 0 },
    { index: 2, weight: 15, offset: 25 },
  ]);
  assert.equal(value.unfilled, 60);
  for (const rows of [
    [{ weight: "101" }],
    [{ weight: "-0.01" }],
    [{ weight: "60" }, { weight: "50" }],
    [{ weight: "100" }, { weight: "1e-99" }],
    [{ weight: "1e999" }],
  ])
    assert.deepEqual(disclosedWeightSegments(rows), {
      segments: [],
      unfilled: 100,
      invalid: true,
    });
  assert.deepEqual(
    disclosedWeightSegments([{ weight: 25 }, { weight: "NaN" }]),
    { segments: [], unfilled: 100, invalid: false },
  );
});
test("observed disclosure graph keeps exact small differences and underflow values, real date spacing and unknown gaps", () => {
  const dates = ["2020-01-01", "2020-01-02", "2020-01-11"];
  const precise = disclosureChart(dates, [
    "1.000000000000000001",
    "1.000000000000000002",
    null,
  ]);
  assert.equal(precise.state, "partial");
  assert.equal(precise.dots[0].y, 156);
  assert.equal(precise.dots[1].y, 24);
  assert.ok(Math.abs(precise.dots[1].x - 79.2) < 1e-9);
  const tiny = disclosureChart(dates, ["1e-999", null, "2e-999"]);
  assert.equal(tiny.state, "partial");
  assert.equal(tiny.dots[0].y, 156);
  assert.equal(tiny.dots[1].y, 24);
  assert.equal((tiny.path.match(/ M /g) || []).length, 2);
  assert.equal((tiny.path.match(/ L /g) || []).length, 0);
  const missing = disclosureChart(dates, [null, "", "  "]);
  assert.equal(missing.state, "unknown");
  assert.equal(missing.dots.length, 0);
  assert.equal(
    disclosureChart(dates, ["1e-999999", null, "2e-999999"]).state,
    "unrepresentable",
  );
  for (const invalid of [
    ["2020-02-30"],
    ["0000-01-01"],
    ["2020-01-02", "2020-01-01"],
    ["9999-01-01"],
  ])
    assert.equal(
      disclosureChart(
        invalid,
        invalid.map(() => "0"),
      ).state,
      "invalid",
    );
  assert.equal(disclosureChart(["2020-01-01"], []).state, "invalid");
});
test("unavailable and partial disclosure evidence never becomes administrator verified complete holdings", () => {
  assert.equal(
    disclosureScope("registered_disclosure_source_retained_unavailable", null)
      .state,
    "unavailable",
  );
  assert.equal(
    disclosureScope("verified_disclosure_original", {
      sourceIntegrity: { state: "retained_unavailable" },
    }).state,
    "unavailable",
  );
  const partial = disclosureScope("verified_disclosure_original", {
    reportedSourceEvidence: {
      coverage: {
        state: "observed_filings_only",
        wholePortfolioKnown: false,
        unparsedAccessions: ["one"],
      },
    },
  });
  assert.equal(partial.state, "partial");
  assert.match(partial.label, /完整持仓与交易历史未知/);
  assert.match(partial.label, /1 份申报未解析/);
  assert.equal(disclosureScope("example_data", null).state, "sample");
  assert.equal(disclosureScope(undefined, null).state, "unknown");
});
