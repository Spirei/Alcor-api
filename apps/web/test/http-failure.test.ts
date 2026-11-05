import test from "node:test";
import assert from "node:assert/strict";
import { httpFailureMessage } from "../src/http-failure.ts";
test("framework details remain visible and proxy HTML is never rendered", () => {
  assert.equal(httpFailureMessage(409, "已有镜像发布正在运行"), "已有镜像发布正在运行");
  assert.match(httpFailureMessage(504, null), /HTTP 504/);
  assert.match(httpFailureMessage(403, {}), /权限/);
  assert.match(httpFailureMessage(422, [{msg: "invalid"}]), /HTTP 422/);
});
