import assert from "node:assert/strict";
import test from "node:test";
import {
  preferenceCards,
  readPreferenceOperation,
  releasePreferenceOperation,
  retainPreferenceOperation,
} from "../src/card-preference-state.ts";
function store() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  };
}
test("card choices use explicit catalog/owned identifiers, normalize aliases, and never synthesize a missing key", () => {
  const manifest = {
    regions: [
      {
        banks: [
          {
            name: "Bank",
            cards: [
              {
                name: "One",
                file: "银行/A%20Card.png",
                faces: [{ file: "银行/back.png" }],
              },
              { name: "Unknown identity", url: "/uploads/looks-valid.png" },
            ],
          },
        ],
      },
    ],
  };
  const result = preferenceCards(manifest, [
    { image: "银行/A Card.png", name: "Alias", bank: "Mine" },
    { image: "/uploads/custom.png", name: "Custom", bank: "Mine" },
  ]);
  assert.deepEqual(
    result.cards.map((card) => card.key),
    [
      "%E9%93%B6%E8%A1%8C/A%20Card.png",
      "%E9%93%B6%E8%A1%8C/back.png",
      "/uploads/custom.png",
    ],
  );
  assert.equal(result.invalid, 1);
  assert.equal(result.cards[0].label, "Bank · One");
});
test("a pending preference stores only its UUID/kind, prevents replacement, and clears at identity change", () => {
  const memory = store(),
    operation = {
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "tags" as const,
    };
  retainPreferenceOperation(memory, "first/session", {
    ...operation,
    value: ["private"],
    cardKey: "private-card",
  } as typeof operation);
  assert.deepEqual(JSON.parse([...memory.data.values()][0]), operation);
  assert.throws(() =>
    retainPreferenceOperation(memory, "first/session", {
      ...operation,
      kind: "holdings",
    }),
  );
  assert.throws(() =>
    releasePreferenceOperation(
      memory,
      "first/session",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ),
  );
  assert.deepEqual(readPreferenceOperation(memory, "first/session"), operation);
  assert.equal(readPreferenceOperation(memory, "different/session"), null);
  assert.equal(memory.length, 0);
});
test("corrupt pending data cannot smuggle a preference payload into request recovery", () => {
  const memory = store();
  memory.setItem(
    "alcor.card-preference-request:owner",
    JSON.stringify({
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "tags",
      value: ["private"],
    }),
  );
  assert.throws(() => readPreferenceOperation(memory, "owner"));
});
