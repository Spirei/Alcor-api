import assert from "node:assert/strict";
import test from "node:test";
import { assetPageKey, assetPageNumbers } from "../src/asset-library-state.ts";

test("catalog pagination stays bounded for large catalogs and retains current and end pages", () => {
  for (const total of [1, 7, 8, 100, 1000000, Number.MAX_SAFE_INTEGER]) {
    for (const page of [1, Math.ceil(total / 2), total]) {
      const items = assetPageNumbers(page, total);
      assert.ok(items.length <= 7);
      assert.ok(
        items.includes(1) && items.includes(page) && items.includes(total),
      );
      const numbers = items.filter((x): x is number => typeof x === "number");
      assert.deepEqual(
        numbers,
        [...new Set(numbers)].sort((a, b) => a - b),
      );
    }
  }
  for (const page of [0, -1, NaN, 1.5, Infinity])
    assert.deepEqual(assetPageNumbers(page, 10), []);
  assert.deepEqual(assetPageNumbers(3, 2), []);
});

test("catalog request identity includes every read filter and safely encodes search text", () => {
  const stock = assetPageKey("stock", "HK", "A & B/中文?", 2);
  const params = new URLSearchParams(stock);
  assert.equal(params.get("q"), "A & B/中文?");
  assert.equal(params.get("market"), "HK");
  assert.equal(params.get("pageSize"), "10");
  assert.notEqual(stock, assetPageKey("stock", "US", "A & B/中文?", 2));
  assert.notEqual(stock, assetPageKey("stock", "HK", "A & B/中文?", 3));
  assert.equal(
    new URLSearchParams(assetPageKey("card", "HK", "", 1)).has("market"),
    false,
  );
});
