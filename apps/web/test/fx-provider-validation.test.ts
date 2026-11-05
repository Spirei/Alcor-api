import test from "node:test";
import assert from "node:assert/strict";
import { providerInputError } from "../src/fx-provider-validation.ts";
test("default source needs no custom fields and incomplete custom input stays local", () => {
  assert.equal(providerInputError(undefined), "");
  assert.equal(providerInputError({ type: "builtin" }), "");
  assert.match(
    providerInputError({
      url: "",
      approval: {
        target: ["https", "example.invalid", 443, "/"],
        addresses: [],
        allow_plaintext: false,
      },
    }),
    /地址/,
  );
  assert.match(
    providerInputError({
      url: "https://example.invalid/rates",
      approval: {
        target: ["https", "example.invalid", 443, "/rates"],
        addresses: [],
        allow_plaintext: false,
      },
    }),
    /IP/,
  );
});
