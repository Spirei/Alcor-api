import assert from "node:assert/strict";
import test from "node:test";
import { requestId } from "../src/request-id.ts";

test("HTTP LAN without randomUUID still produces UUIDv4 with crypto entropy", () => {
  let calls = 0;
  const id = requestId({
    getRandomValues: (bytes) => {
      calls++;
      bytes.fill(255);
      return bytes;
    },
  });
  assert.equal(id, "ffffffff-ffff-4fff-bfff-ffffffffffff");
  assert.equal(calls, 1);
});

test("native randomUUID retains its receiver and does not consume fallback entropy", () => {
  const source = {
    randomUUID() {
      assert.equal(this, source);
      return "00112233-4455-4677-8899-aabbccddeeff";
    },
    getRandomValues() {
      throw new Error("fallback should not run");
    },
  };
  assert.equal(requestId(source), "00112233-4455-4677-8899-aabbccddeeff");
});
