import assert from "node:assert/strict";
import test from "node:test";
import {
  convertObservedFx,
  type ObservedRates,
} from "../src/fx-converter-state.ts";

const rates: ObservedRates = {
  base: "USD",
  rates: { CNY: "7.3", EUR: "0.9", JPY: "150" },
  quoted: ["CNY", "EUR", "JPY"],
};
test("FX calculator uses observed cross ratios without floating point loss", () => {
  assert.deepEqual(convertObservedFx("100", "USD", "CNY", rates), {
    value: "730",
    approximate: false,
  });
  assert.deepEqual(convertObservedFx("73", "CNY", "EUR", rates), {
    value: "9",
    approximate: false,
  });
  assert.deepEqual(convertObservedFx("-73", "CNY", "EUR", rates), {
    value: "-9",
    approximate: false,
  });
  assert.deepEqual(convertObservedFx("9007199254740993", "USD", "CNY", rates), {
    value: "65752554559609248.9",
    approximate: false,
  });
  assert.deepEqual(convertObservedFx("0", "USD", "CNY", rates), {
    value: "0",
    approximate: false,
  });
  assert.deepEqual(convertObservedFx("1", "JPY", "USD", rates), {
    value: "0.006667",
    approximate: true,
  });
});
test("missing, quarantined or invalid source cannot invent a unit rate", () => {
  for (const data of [
    { ...rates, quoted: [] },
    { ...rates, quarantined: true },
    { ...rates, rates: { CNY: "0" } },
    { ...rates, rates: { CNY: "-1" } },
    { ...rates, exactRatios: { CNY: { numerator: "1", denominator: "0" } } },
  ])
    assert.equal(convertObservedFx("100", "USD", "CNY", data), null);
  assert.equal(convertObservedFx("100", "GBP", "CNY", rates), null);
  for (const input of [
    "",
    "NaN",
    "Infinity",
    "1e10",
    "1,000",
    "1/2",
    "9".repeat(31),
  ])
    assert.equal(convertObservedFx(input, "USD", "CNY", rates), null);
  assert.equal(convertObservedFx("1", "usd", "CNY", rates), null);
});
test("exact retained ratios outrank rounded display rates and approximation stays explicit", () => {
  const data = {
    ...rates,
    rates: { CNY: "7.333333" },
    exactRatios: { CNY: { numerator: "22", denominator: "3" } },
  };
  assert.deepEqual(convertObservedFx("3", "USD", "CNY", data), {
    value: "22",
    approximate: false,
  });
  assert.deepEqual(
    convertObservedFx("3", "USD", "CNY", {
      ...data,
      roundedCurrencies: ["CNY"],
    }),
    { value: "22", approximate: true },
  );
  assert.deepEqual(
    convertObservedFx("100", "GBP", "GBP", {
      base: "USD",
      rates: {},
      quoted: [],
      quarantined: true,
    }),
    { value: "100", approximate: false },
  );
});
