import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PasswordField, PasswordStrength } from "./password-fields";
import { SelectMenu } from "./select-menu";
import type {
  RecoveryAction,
  RecoverySecrets,
  RecoveryTarget,
} from "./admin-credential-state";
export function AdminCredentialRecovery({
  target,
  disabled,
  onSubmit,
}: {
  target: RecoveryTarget;
  disabled: boolean;
  onSubmit: (
    action: RecoveryAction,
    target: RecoveryTarget,
    secrets: RecoverySecrets,
  ) => void;
}) {
  const [open, setOpen] = useState(false),
    [action, setAction] = useState<RecoveryAction | "">(""),
    [currentPassword, setCurrentPassword] = useState(""),
    [code, setCode] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const form = useRef<HTMLFormElement | null>(null);
  function clear() {
    setCurrentPassword("");
    setCode("");
    setNewPassword("");
    setConfirmation("");
    setConfirmed(false);
    for (const input of form.current?.querySelectorAll("input") ?? [])
      if (input.type !== "checkbox") input.value = "";
  }
  useLayoutEffect(() => () => clear(), []);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) clear();
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  useEffect(() => {
    clear();
    setAction("");
  }, [target.id, target.revision]);
  return (
    <details
      className="admin-credential-recovery"
      open={open}
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
        if (!e.currentTarget.open) clear();
      }}
    >
      <summary>账号恢复</summary>
      {open && (
        <div className="admin-credential-fields">
          <SelectMenu
            label="恢复操作"
            value={action}
            disabled={disabled}
            variant="field"
            options={[
              { value: "", label: "选择操作" },
              { value: "reset-password", label: "重置密码" },
              ...(target.two_factor_enabled === true
                ? [{ value: "disable-totp", label: "停用双重验证" }]
                : []),
            ]}
            onChange={(value) => {
              clear();
              setAction(value as RecoveryAction | "");
            }}
          />
          {target.two_factor_enabled === undefined && (
            <p role="status">双重验证状态未知</p>
          )}
          {action && (
            <form
              ref={form}
              onSubmit={(e) => {
                e.preventDefault();
                if (disabled || !confirmed) return;
                const values = {
                  currentPassword,
                  code,
                  newPassword,
                  confirmation,
                };
                clear();
                onSubmit(action, { ...target }, values);
              }}
            >
              <label htmlFor="admin-recovery-current">当前管理员密码</label>
              <PasswordField
                id="admin-recovery-current"
                value={currentPassword}
                autoComplete="current-password"
                required
                disabled={disabled}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
              <label htmlFor="admin-recovery-code">验证码</label>
              <input
                id="admin-recovery-code"
                value={code}
                autoComplete="one-time-code"
                maxLength={64}
                disabled={disabled}
                onChange={(e) => setCode(e.target.value)}
              />
              {action === "reset-password" && (
                <>
                  <label htmlFor="admin-recovery-new">新密码</label>
                  <PasswordField
                    id="admin-recovery-new"
                    value={newPassword}
                    autoComplete="new-password"
                    required
                    disabled={disabled}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <PasswordStrength
                    password={newPassword}
                    username={target.username}
                  />
                  <label htmlFor="admin-recovery-confirm">确认新密码</label>
                  <PasswordField
                    id="admin-recovery-confirm"
                    value={confirmation}
                    autoComplete="new-password"
                    required
                    disabled={disabled}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </>
              )}
              <p>
                {action === "reset-password"
                  ? "该账号的全部会话、客户端授权、双重验证和通行密钥将失效。"
                  : "该账号的全部会话和客户端授权将失效，双重验证将停用。"}
              </p>
              <label className="access-check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={disabled}
                  required
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                {action === "reset-password" ? "确认重置" : "确认停用"}{" "}
                {target.username}
                {action === "reset-password" ? " 的密码" : " 的双重验证"}
              </label>
              <button
                className="button secondary"
                type="submit"
                disabled={
                  disabled ||
                  !confirmed ||
                  !currentPassword ||
                  (action === "reset-password" &&
                    (!newPassword || !confirmation))
                }
              >
                {action === "reset-password" ? "重置密码" : "停用双重验证"}
              </button>
            </form>
          )}
        </div>
      )}
    </details>
  );
}
