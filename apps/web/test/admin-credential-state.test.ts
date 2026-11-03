import assert from "node:assert/strict";
import test from "node:test";
import {
  recoveryCommand,
  removalReceipt,
  recoveryReceipt,
  recoveryLabel,
  retainRecoveryId,
  releaseRecoveryId,
} from "../src/admin-credential-state.ts";
const id = "448fca63-e431-4968-86c0-d701c60046bf",
  revision = "558fca63-e431-4968-86c0-d701c60046bf",
  target = {
    id: "u-synthetic-target",
    username: "Target",
    revision,
    two_factor_enabled: true,
  },
  secrets = {
    currentPassword: "Administrator9!",
    code: "backup-code",
    newPassword: "NewTarget9!",
    confirmation: "NewTarget9!",
  };
test("managed recovery freezes target revision and original UUID, carries only explicit credential fields, and never turns disable-totp into reset", () => {
  const body = recoveryCommand("reset-password", target, secrets, id);
  assert.deepEqual(body, {
    request_id: id,
    revision,
    current_password: secrets.currentPassword,
    code: secrets.code,
    new_password: secrets.newPassword,
  });
  target.revision = id;
  assert.equal(body.revision, revision);
  target.revision = revision;
  assert.deepEqual(recoveryCommand("disable-totp", target, secrets, id), {
    request_id: id,
    revision,
    current_password: secrets.currentPassword,
    code: secrets.code,
  });
  for (const [action, t, s] of [
    ["reset-password", target, { ...secrets, currentPassword: "" }],
    ["reset-password", target, { ...secrets, confirmation: "wrong" }],
    [
      "reset-password",
      target,
      { ...secrets, newPassword: "short", confirmation: "short" },
    ],
    ["disable-totp", { ...target, two_factor_enabled: undefined }, secrets],
    ["disable-totp", { ...target, two_factor_enabled: false }, secrets],
  ] as const)
    assert.throws(() => recoveryCommand(action, t, s, id));
  assert.equal(
    recoveryCommand(
      "reset-password",
      target,
      { ...secrets, newPassword: "😀".repeat(8), confirmation: "😀".repeat(8) },
      id,
    ).new_password,
    "😀".repeat(8),
  );
});
test("credential receipts bind original UUID and target; different target, malformed flags or partial success never clear unknown", () => {
  const result = {
    request_id: id,
    action: "reset-password",
    target_id: target.id,
    revision,
    ok: true,
    totpDisabled: true,
    passkeysRevoked: true,
  };
  assert.deepEqual(recoveryReceipt(result, id, target.id), result);
  assert.match(
    recoveryLabel(recoveryReceipt(result, id, target.id)),
    /密码已重置/,
  );
  assert.equal(
    recoveryLabel(
      recoveryReceipt(
        { ...result, action: "disable-totp", passkeysRevoked: false },
        id,
        target.id,
      ),
    ),
    "双重验证已停用",
  );
  for (const bad of [
    { ...result, request_id: revision },
    { ...result, action: "unknown" },
    { ...result, target_id: "other" },
    { ...result, revision: "unknown" },
    { ...result, ok: false },
    { ...result, totpDisabled: false },
    { ...result, passkeysRevoked: undefined },
  ])
    assert.throws(() => recoveryReceipt(bad, id, target.id));
  assert.equal(recoveryReceipt(result, id).target_id, target.id);
  assert.throws(() =>
    recoveryReceipt(result, id, target.id, {
      action: "disable-totp",
      revision: id,
    }),
  );
  assert.throws(() =>
    recoveryReceipt(result, id, target.id, {
      action: "reset-password",
      revision,
    }),
  );
});
test("refresh journal stores only original ID, blocks replacement, and a late release cannot erase another operation", () => {
  const values = new Map<string, string>(),
    s = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    },
    key = "same-owner";
  retainRecoveryId(s, key, id);
  assert.deepEqual([...values.values()], [id]);
  assert.throws(() => retainRecoveryId(s, key, revision), /原账号操作/);
  releaseRecoveryId(s, key, revision);
  assert.equal(values.get(key), id);
  releaseRecoveryId(s, key, id);
  retainRecoveryId(s, key, revision);
  releaseRecoveryId(s, key, id);
  assert.equal(values.get(key), revision);
  assert.ok(
    ![...values.values()].some(
      (v) =>
        v.includes(secrets.currentPassword) ||
        v.includes(secrets.newPassword) ||
        v.includes(secrets.code),
    ),
  );
});

test("account deletion accepts only the original committed UUID and target, including recovery after the target disappears", () => {
  const committed = { request_id: id, user_id: target.id, deleted: true };
  assert.deepEqual(removalReceipt(committed, id, target.id), committed);
  assert.deepEqual(removalReceipt(committed, id), committed);
  for (const bad of [
    null,
    [],
    { ...committed, request_id: revision },
    { ...committed, deleted: false },
    { ...committed, user_id: "" },
  ])
    assert.throws(() => removalReceipt(bad, id));
  assert.throws(() => removalReceipt(committed, id, "another-owner"));
});
