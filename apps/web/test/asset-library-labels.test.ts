import test from "node:test";
import assert from "node:assert/strict";
import {
  materialLabel,
  localizedMaterials,
} from "../src/asset-library-labels.ts";
import { brokerOrder } from "../src/asset-library-market.ts";
test("flags use Chinese names and Chinese order without replacing explicit user labels", () => {
  const a = { id: "ad", name: "ad", code: "AD" },
    b = { id: "al", name: "al", code: "AL" },
    c = { id: "hk", name: "本人香港标签", code: "HK" };
  assert.equal(materialLabel(a, "flag").name, "安道尔");
  assert.equal(materialLabel(c, "flag").name, "本人香港标签");
  assert.deepEqual(
    localizedMaterials([a, b, c], "flag", "阿尔", "").map((a) => a.code),
    ["AL"],
  );
  assert.equal(localizedMaterials([a, b], "flag", "", "")[0].code, "AL");
});
test("broker ordering is bounded and cannot accept paths or duplicate IDs", () => {
  assert.deepEqual(
    brokerOrder(["broker:US:A", "broker:HK:A", "broker:US:A", "../secret"]),
    ["broker:US:A", "broker:HK:A"],
  );
});
