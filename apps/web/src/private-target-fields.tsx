import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { privateFieldLabel } from "./private-field-labels";
import { SelectMenu } from "./select-menu";
import { SettingRow, ToggleSwitch } from "./workspace-forms";
const fields: Record<
  string,
  "text" | "number" | "boolean" | "strings" | "object" | "objects"
> = {
  deepseek: "object",
  openai: "object",
  jev: "object",
  custom: "object",
  apiUrl: "text",
  selectedModel: "text",
  items: "objects",
  key: "text",
  label: "text",
  interval: "number",
  sourceOwnerId: "text",
  sourceRevision: "text",
  targetFingerprint: "text",
  source_version: "text",
  target_id: "text",
  target_fingerprint: "text",
  owner_id: "text",
  license_revision: "text",
  approved_access: "boolean",
  allow_plaintext: "boolean",
  scheme: "text",
  stale_seconds: "number",
  fixture: "boolean",
  approval: "object",
  license: "object",
  policy: "object",
  query: "object",
  id: "text",
  name: "text",
  provider: "text",
  host: "text",
  port: "number",
  path: "text",
  url: "text",
  endpoint: "text",
  addresses: "strings",
  approvedAccess: "boolean",
  allowPlaintext: "boolean",
  licenseRevision: "text",
  expiresAt: "text",
  ownerId: "text",
  instanceId: "text",
  purpose: "text",
  purposes: "strings",
  market: "text",
  markets: "strings",
  code: "text",
  model: "text",
  models: "strings",
  source: "text",
  targetId: "text",
  publicDisplay: "boolean",
  enabled: "boolean",
  allowPrivate: "boolean",
  timeout: "number",
  maxBytes: "number",
  maxPages: "number",
  cik: "text",
  celebId: "text",
  sourceKind: "text",
  authors: "strings",
  baseCurrency: "text",
  symbols: "strings",
  currency: "text",
  frame: "text",
  frames: "strings",
  adjusts: "strings",
  sessions: "strings",
  timezone: "text",
  kind: "text",
  instrument: "text",
  instruments: "strings",
  display: "boolean",
  derivatives: "boolean",
  allowLatest: "boolean",
  allowHistory: "boolean",
};
const secret =
  /password|api.?key|token|credential|secret|cookie|aeskey|webhook/i;
export function PrivateTargetFields({
  value,
  onChange,
  disabled,
  path = "target",
}: {
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  disabled: boolean;
  path?: string;
}) {
  const [addition, setAddition] = useState("");
  return (
    <div className="form-grid">
      {Object.entries(value)
        .filter(([key]) => !secret.test(key))
        .map(([key, item]) => {
          const set = (next: unknown) => onChange({ ...value, [key]: next }),
            label = privateFieldLabel(key);
          if (Array.isArray(item) && fields[key] === "objects")
            return (
              <fieldset key={key}>
                <legend>{label}</legend>
                {item.map((nested, index) => (
                  <fieldset key={index}>
                    <PrivateTargetFields
                      value={nested as Record<string, unknown>}
                      disabled={disabled}
                      path={path + "." + key + "." + index}
                      onChange={(next) =>
                        set(item.map((old, i) => (i === index ? next : old)))
                      }
                    />
                    <button
                      type="button"
                      className="button"
                      disabled={disabled}
                      onClick={() => set(item.filter((_, i) => i !== index))}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                      移除此项
                    </button>
                  </fieldset>
                ))}
                <button
                  type="button"
                  className="button"
                  disabled={disabled}
                  onClick={() => set([...item, {}])}
                >
                  <Plus size={15} aria-hidden="true" />
                  添加一项
                </button>
              </fieldset>
            );
          if (Array.isArray(item) && item.every((v) => typeof v === "string"))
            return (
              <label className="workspace-form-field" key={key}>
                <span>{label}</span>
                <textarea
                  disabled={disabled}
                  value={item.join("\n")}
                  onChange={(event) =>
                    set(event.target.value.split("\n").filter(Boolean))
                  }
                />
                <small>每行一项</small>
              </label>
            );
          if (Array.isArray(item))
            return (
              <fieldset key={key}>
                <legend>{label}</legend>
                {item.map((nested, index) =>
                  nested &&
                  typeof nested === "object" &&
                  !Array.isArray(nested) ? (
                    <PrivateTargetFields
                      key={index}
                      path={path + "." + key + "." + index}
                      value={nested as Record<string, unknown>}
                      disabled={disabled}
                      onChange={(next) =>
                        set(item.map((old, i) => (i === index ? next : old)))
                      }
                    />
                  ) : (
                    <p key={index}>此字段需使用对应来源管理入口</p>
                  ),
                )}
              </fieldset>
            );
          if (item && typeof item === "object")
            return (
              <fieldset key={key}>
                <legend>{label}</legend>
                <PrivateTargetFields
                  value={item as Record<string, unknown>}
                  disabled={disabled}
                  path={path + "." + key}
                  onChange={set}
                />
              </fieldset>
            );
          if (typeof item === "boolean" || fields[key] === "boolean")
            return (
              <div className="private-boolean-field" key={key}>
                <SettingRow title={label}>
                  <ToggleSwitch
                    label={label}
                    disabled={disabled}
                    checked={item === true}
                    onChange={set}
                  />
                </SettingRow>
              </div>
            );
          return (
            <label className="workspace-form-field" key={key}>
              <span>{label}</span>
              <input
                disabled={disabled}
                type={
                  typeof item === "number" || fields[key] === "number"
                    ? "number"
                    : "text"
                }
                value={item == null ? "" : String(item)}
                onChange={(event) =>
                  set(
                    (typeof item === "number" || fields[key] === "number") &&
                      event.target.value !== ""
                      ? Number(event.target.value)
                      : event.target.value,
                  )
                }
              />
            </label>
          );
        })}
      <div className="private-target-add">
        <SelectMenu
          label="添加目标字段"
          disabled={disabled}
          value={addition}
          options={[
            { value: "", label: "选择字段" },
            ...Object.keys(fields)
              .filter((key) => !(key in value))
              .map((key) => ({ value: key, label: privateFieldLabel(key) })),
          ]}
          onChange={setAddition}
        />
        <button
          type="button"
          className="button"
          disabled={disabled || !addition}
          onClick={() => {
            onChange({
              ...value,
              [addition]:
                fields[addition] === "objects"
                  ? []
                  : fields[addition] === "object"
                    ? {}
                    : fields[addition] === "strings"
                      ? []
                      : fields[addition] === "boolean"
                        ? false
                        : fields[addition] === "number"
                          ? null
                          : "",
            });
            setAddition("");
          }}
        >
          <Plus size={15} aria-hidden="true" />
          添加字段
        </button>
      </div>
    </div>
  );
}
