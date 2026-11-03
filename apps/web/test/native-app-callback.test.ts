import test from "node:test";
import assert from "node:assert/strict";
import { authorizationCallback } from "../src/native-app-callback.ts";
const redirect = "com.fire.app:/oauth/callback",
  state = "bound-state";
test("authorization code and explicit denial return only to the bound App callback", () => {
  for (const result of ["code=fac_original", "error=access_denied"]) {
    const callback = `${redirect}?state=${state}&${result}`;
    assert.equal(authorizationCallback(callback, redirect, state), callback);
  }
});
test("foreign origins, changed state and ambiguous credentials never navigate", () => {
  for (const value of [
    `https://other.example.invalid/oauth/callback?state=${state}&code=fac_a`,
    `${redirect}?state=other&code=fac_a`,
    `${redirect}?state=${state}&state=${state}&code=fac_a`,
    `${redirect}?state=${state}&code=fac_a&code=fac_b`,
    `${redirect}?state=${state}&code=fac_a&error=access_denied`,
    `${redirect}?state=${state}&access_token=secret`,
    `${redirect}?state=${state}&code=fac_a#other`,
  ])
    assert.throws(() => authorizationCallback(value, redirect, state));
});
