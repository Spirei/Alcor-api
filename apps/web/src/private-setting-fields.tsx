import { useId } from "react";
import { Trash2, Undo2 } from "lucide-react";
import { PasswordField } from "./password-fields";
import { SelectMenu } from "./select-menu";
import { SettingRow, ToggleSwitch } from "./workspace-forms";
import "./private-settings.css";
export type PrivateField = {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "secret";
  choices?: string[];
  configured?: boolean;
};
export type SecretChange = {
  mode: "keep" | "replace" | "clear";
  value: string;
};
export function PrivateSettingFields({
  fields,
  value,
  secrets,
  disabled,
  onChange,
  onSecret,
}: {
  fields: PrivateField[];
  value: Record<string, unknown>;
  secrets: Record<string, SecretChange>;
  disabled: boolean;
  onChange: (key: string, value: unknown) => void;
  onSecret: (key: string, value: SecretChange) => void;
}) {
  const id = useId();
  return (
    <>
      {fields.map((field) => {
        if (field.type === "secret") {
          const draft = secrets[field.key] ?? { mode: "keep", value: "" };
          const inputId = id + "-" + field.key;
          return (
            <div
              key={field.key}
              className="workspace-form-field private-secret-field"
            >
              <div className="private-secret-label">
                <label htmlFor={inputId}>{field.label}</label>
                <span>
                  {draft.mode === "clear"
                    ? "保存时清除"
                    : draft.mode === "replace"
                      ? "待更新"
                      : field.configured
                        ? "已配置"
                        : "未配置"}
                </span>
              </div>
              <div className="private-secret-input">
                <PasswordField
                  id={inputId}
                  value={draft.mode === "replace" ? draft.value : ""}
                  autoComplete="off"
                  disabled={disabled || draft.mode === "clear"}
                  placeholder={
                    draft.mode === "clear"
                      ? "已标记清除"
                      : field.configured
                        ? "留空保留当前值"
                        : "请输入"
                  }
                  onChange={(event) =>
                    onSecret(field.key, {
                      mode: event.target.value ? "replace" : "keep",
                      value: event.target.value,
                    })
                  }
                />
                {(field.configured || draft.mode === "clear") && (
                  <button
                    type="button"
                    className="icon-button"
                    disabled={disabled}
                    aria-label={`${draft.mode === "clear" ? "撤销清除" : "清除"}${field.label}`}
                    aria-pressed={draft.mode === "clear"}
                    onClick={() =>
                      onSecret(field.key, {
                        mode: draft.mode === "clear" ? "keep" : "clear",
                        value: "",
                      })
                    }
                  >
                    {draft.mode === "clear" ? (
                      <Undo2 size={16} aria-hidden="true" />
                    ) : (
                      <Trash2 size={16} aria-hidden="true" />
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        }
        if (field.type === "boolean")
          return (
            <div className="private-boolean-field" key={field.key}>
              <SettingRow title={field.label}>
                <ToggleSwitch
                  label={field.label}
                  disabled={disabled}
                  checked={value[field.key] === true}
                  onChange={(next) => onChange(field.key, next)}
                />
              </SettingRow>
            </div>
          );
        return (
          <label className="workspace-form-field" key={field.key}>
            <span>{field.label}</span>
            {field.choices ? (
              <SelectMenu
                label={field.label}
                variant="field"
                disabled={disabled}
                value={String(value[field.key] ?? "")}
                options={[
                  { value: "", label: "未设置" },
                  ...field.choices.map((choice) => ({
                    value: choice,
                    label:
                      (
                        {
                          deepseek: "DeepSeek",
                          openai: "OpenAI",
                          jev: "Jev",
                          custom: "自定义",
                        } as Record<string, string>
                      )[choice] || choice,
                  })),
                ]}
                onChange={(next) => onChange(field.key, next)}
              />
            ) : (
              <input
                disabled={disabled}
                type={field.type === "number" ? "number" : "text"}
                value={String(value[field.key] ?? "")}
                onChange={(event) =>
                  onChange(
                    field.key,
                    field.type === "number" && event.target.value !== ""
                      ? Number(event.target.value)
                      : event.target.value,
                  )
                }
              />
            )}
          </label>
        );
      })}
    </>
  );
}
