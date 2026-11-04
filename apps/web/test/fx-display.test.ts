import test from "node:test";
import assert from "node:assert/strict";
import {
  currencyCodes,
  defaultFxOrder,
  formatFxAmount,
  formatFxCurrency,
  fxInput,
} from "../src/fx-display.ts";
import {
  parseAppearance,
  defaultAppearance,
} from "../src/appearance-preferences.ts";

test("FX display order preserves explicit codes without inventing missing rates", () => {
  const values = parseAppearance({
    ...defaultAppearance(),
    fxOrder: ["JPY", "USD", "JPY"],
    fxHidden: ["USD"],
  });
  assert.deepEqual(values.fxOrder, ["JPY", "USD"]);
  assert.deepEqual(values.fxHidden, ["USD"]);
  assert.deepEqual(parseAppearance({ version: 1 }).fxOrder, defaultFxOrder);
  assert.deepEqual(currencyCodes(["usd"], defaultFxOrder), defaultFxOrder);
  assert.deepEqual(
    currencyCodes(Array(65).fill("USD"), defaultFxOrder),
    defaultFxOrder,
  );
});
test("FX grouping retains large precise decimal strings and signs", () => {
  assert.equal(
    formatFxAmount("123456789012345678901234567890.123456"),
    "123,456,789,012,345,678,901,234,567,890.123456",
  );
  assert.equal(formatFxAmount("-1234.000001"), "-1,234.000001");
  assert.equal(formatFxAmount(""), "");
});

test("currency rounding keeps large exact strings and rejects malformed grouping", () => {
  assert.equal(formatFxCurrency("784.4", "HKD"), "784.40");
  assert.equal(formatFxCurrency("15758.9", "JPY"), "15,759");
  assert.equal(formatFxCurrency("0.123456", "EUR"), "0.1235");
  assert.equal(formatFxCurrency("9007199254740993.995", "USD"), "9,007,199,254,740,994.00");
  assert.equal(fxInput("1,234.56"), "1234.56");
  for (const text of ["1,23", "1e3", "Infinity", "1/2", "abc100"]) assert.equal(fxInput(text), text);
});
