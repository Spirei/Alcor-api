import assert from "node:assert/strict";
import test from "node:test";
import {
  marketSlots,
  libraryMarketOrder,
  moveLibraryMarket,
} from "../src/asset-library-market.ts";

test("market slots retain the old fourteen-market order without turning file aliases or index icons into extra markets", () => {
  const rows = marketSlots(
    [
      { id: "short-us", name: "美股", code: "US", readOnly: true },
      { id: "alias-us", name: "美国", code: "US", readOnly: true },
      { id: "index", name: "标普500", code: "SPX" },
      { id: "region", name: "欧洲", code: "EU" },
    ],
    { GB: "/uploads/asset/flag/GB.svg" },
  );
  assert.deepEqual(
    rows.map((r) => r.code),
    [
      "US",
      "HK",
      "CN",
      "JP",
      "KR",
      "SG",
      "UK",
      "DE",
      "FR",
      "AU",
      "CA",
      "IN",
      "TW",
      "BR",
    ],
  );
  assert.equal(rows[0].id, "short-us");
  assert.equal(rows[6].imageUrl, "/uploads/asset/flag/GB.svg");
  assert.equal(rows[6].placeholder, true);
});

test("registered market artwork wins over readonly filenames while explicit custom markets retain their own slot", () => {
  const rows = marketSlots([
    { id: "legacy-us", name: "美股", code: "US", readOnly: true },
    {
      id: "registered-us",
      name: "自定义美股",
      market: "US",
      code: "US",
      readOnly: false,
    },
    { id: "custom", name: "自定义市场", code: "NZ" },
  ]);
  assert.equal(rows.length, 15);
  assert.equal(rows[0].id, "registered-us");
  assert.equal(rows[14].id, "custom");
});

test("market reorder retains every preset once without accepting arbitrary stored codes", () => {
  assert.deepEqual(libraryMarketOrder(["HK", "HK", "NOT_A_MARKET"]), [
    "HK",
    "US",
    "CN",
    "JP",
    "KR",
    "SG",
    "UK",
    "DE",
    "FR",
    "AU",
    "CA",
    "IN",
    "TW",
    "BR",
  ]);
  const original = libraryMarketOrder(null);
  const moved = moveLibraryMarket(original, "HK", "US");
  assert.deepEqual(moved.slice(0, 3), ["HK", "US", "CN"]);
  assert.equal(moved.length, 14);
  assert.deepEqual(original.slice(0, 2), ["US", "HK"]);
});
