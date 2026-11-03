import test from "node:test";
import assert from "node:assert/strict";
import { observeVerificationLinks, verificationToken } from "../src/email-verification-token.ts";

const token = "a".repeat(43);
test("new mail keeps verification credential in fragment; old query remains readable", () => {
  assert.equal(verificationToken("", `#token=${token}`), token);
  assert.equal(verificationToken(`?token=${token}`, ""), token);
  const request = new URL(
    `https://example.invalid/verify-email#token=${token}`,
  );
  assert.equal(request.pathname + request.search, "/verify-email");
});
test("ambiguous, missing or malformed credentials cannot verify a different link", () => {
  assert.equal(verificationToken("", ""), "");
  assert.equal(verificationToken(`?token=${token}`, `#token=${token}`), "");
  assert.equal(verificationToken("", `#token=${token}&token=${token}`), "");
  assert.equal(verificationToken("?token=undefined", ""), "");
  assert.equal(verificationToken("", "#token=%00"), "");
  assert.equal(
    verificationToken("", `#token=${"b".repeat(43)}`),
    "b".repeat(43),
  );
});


test("native fragment navigation captures repeat links and unsubscribes", () => {
  const events = new EventTarget();
  const location = { pathname: "/verify-email", search: "", hash: "" };
  const target = {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    location,
  } as unknown as Window;
  const received: string[] = [];
  const stop = observeVerificationLinks(target, (value) => {
    received.push(value);
    location.hash = "";
  });
  for (let i = 0; i < 2; i++) {
    location.hash = `#token=${token}`;
    events.dispatchEvent(new Event("hashchange"));
    assert.equal(location.hash, "");
  }
  assert.deepEqual(received, [token, token]);
  events.dispatchEvent(new Event("hashchange"));
  assert.equal(received.length, 2);
  stop();
  location.hash = `#token=${token}`;
  events.dispatchEvent(new Event("hashchange"));
  assert.equal(received.length, 2);
});
