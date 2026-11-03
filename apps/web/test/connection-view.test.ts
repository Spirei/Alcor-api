import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyConnectionConfig,
  connectionResultView,
  servicePresentation,
} from "../src/connection-view.ts";
import type { ConnectionReceipt, ConnectionSettings } from "../src/api.ts";

const savedSettings: ConnectionSettings = {
  config: emptyConnectionConfig("postgresql"),
  effective: emptyConnectionConfig("postgresql"),
  revision: "saved-revision",
  saved_at: "2026-10-31T08:00:00Z",
  password_set: true,
  state: "applied",
  worker_applied: true,
};
const saveReceipt: ConnectionReceipt = {
  request_id: "original-request",
  kind: "postgresql",
  operation: "save",
  status: "saved",
  message: "已保存并应用",
  observed_at: "2026-10-31T08:00:00Z",
  revision: "saved-revision",
};

test("recovered results for another draft remain explicitly historical", () => {
  assert.deepEqual(connectionResultView(saveReceipt, false, savedSettings), {
    text: "上次保存：已保存并应用",
    tone: "historical",
  });
  const testReceipt: ConnectionReceipt = {
    ...saveReceipt,
    operation: "test",
    status: "passed",
    revision: null,
    message: "连接成功",
  };
  assert.deepEqual(connectionResultView(testReceipt, false, savedSettings), {
    text: "上次测试：连接成功",
    tone: "historical",
  });
  assert.equal(
    connectionResultView(testReceipt, true, savedSettings).tone,
    "success",
  );
});
test("application waits for the exact revision and both process confirmations", () => {
  const pending = connectionResultView(saveReceipt, true, {
    ...savedSettings,
    state: "pending",
    worker_applied: false,
  });
  assert.deepEqual(pending, { text: "已保存，正在应用", tone: "pending" });
  const partial = connectionResultView(saveReceipt, true, {
    ...savedSettings,
    worker_applied: false,
  });
  assert.deepEqual(partial, {
    text: "API 已应用，Worker 待同步",
    tone: "pending",
  });
  assert.equal(
    connectionResultView(saveReceipt, true, savedSettings).tone,
    "success",
  );
  assert.equal(
    connectionResultView(saveReceipt, true, {
      ...savedSettings,
      revision: "another-revision",
    }).tone,
    "pending",
  );
});
test("a receipt without fresh matching settings cannot establish full application", () => {
  assert.equal(connectionResultView(saveReceipt, true, null).tone, "pending");
  assert.equal(
    connectionResultView({ ...saveReceipt, revision: undefined }, true, null)
      .tone,
    "pending",
  );
});
test("a failure is an error only for its matching editable draft", () => {
  const failed: ConnectionReceipt = {
    ...saveReceipt,
    status: "failed",
    message: "连接失败",
  };
  assert.deepEqual(connectionResultView(failed, true, null), {
    text: "连接失败",
    tone: "failed",
  });
  assert.deepEqual(connectionResultView(failed, false, null), {
    text: "上次保存：连接失败",
    tone: "historical",
  });
});

test("an unconfigured database or cache never inherits a green runtime connection", () => {
  for (const id of ["postgresql", "redis"])
    assert.deepEqual(
      servicePresentation({ id, state: "up", configured: false }),
      { state: "unconfigured", label: "未配置" },
    );
});
test("older backend observations without configuration proof remain unverified", () => {
  assert.deepEqual(servicePresentation({ id: "postgresql", state: "up" }), {
    state: "unknown",
    label: "待核对",
  });
});
test("a saved setting remains pending until applied, then follows its real live result", () => {
  assert.deepEqual(
    servicePresentation({ id: "redis", state: "pending", configured: true }),
    { state: "pending", label: "应用中" },
  );
  assert.deepEqual(
    servicePresentation({ id: "redis", state: "up", configured: true }),
    { state: "up", label: "已连接" },
  );
  assert.deepEqual(
    servicePresentation({ id: "postgresql", state: "down", configured: true }),
    { state: "down", label: "未连接" },
  );
});
test("the internal Worker reports its real heartbeat independently", () => {
  assert.deepEqual(
    servicePresentation({ id: "worker", state: "up", configured: false }),
    { state: "up", label: "运行中" },
  );
});
test("an empty form contains no bootstrap address, account, database name or password", () => {
  for (const kind of ["postgresql", "redis"] as const) {
    const draft = emptyConnectionConfig(kind);
    assert.equal(draft.host, "");
    assert.equal(draft.username, "");
    assert.equal("password" in draft, false);
    if (draft.kind === "postgresql") assert.equal(draft.database, "");
  }
});
