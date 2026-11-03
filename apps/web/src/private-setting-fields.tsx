import { PasswordField } from "./password-fields";
export type PrivateField = { key: string; label: string; type: "string" | "number" | "boolean" | "secret"; choices?: string[]; configured?: boolean };
export type SecretChange = { mode: "keep" | "replace" | "clear"; value: string };
export function PrivateSettingFields({ fields, value, secrets, disabled, onChange, onSecret }: {
  fields: PrivateField[]; value: Record<string, unknown>; secrets: Record<string, SecretChange>; disabled: boolean;
  onChange: (key: string, value: unknown) => void; onSecret: (key: string, value: SecretChange) => void;
}) {
  return <>{fields.map(field => {
    if (field.type === "secret") {
      const draft = secrets[field.key] ?? { mode: "keep", value: "" };
      return <div key={field.key}><label>{field.label} · {field.configured ? "已配置" : "未配置"}<select disabled={disabled} value={draft.mode} onChange={event => onSecret(field.key, { mode: event.target.value as SecretChange["mode"], value: "" })}><option value="keep">保留当前值</option><option value="replace">替换</option><option value="clear">清除</option></select></label>{draft.mode === "replace" && <PasswordField id={"private-secret-" + field.key} value={draft.value} autoComplete="off" disabled={disabled} onChange={event => onSecret(field.key, { mode: "replace", value: event.target.value })} />}</div>;
    }
    if (field.type === "boolean") return <label key={field.key}><input type="checkbox" disabled={disabled} checked={value[field.key] === true} onChange={event => onChange(field.key, event.target.checked)} />{field.label}</label>;
    return <label key={field.key}>{field.label}{field.choices ? <select disabled={disabled} value={String(value[field.key] ?? "")} onChange={event => onChange(field.key, event.target.value)}><option value="">未设置</option>{field.choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}</select> : <input disabled={disabled} type={field.type === "number" ? "number" : "text"} value={String(value[field.key] ?? "")} onChange={event => onChange(field.key, field.type === "number" && event.target.value !== "" ? Number(event.target.value) : event.target.value)} />}</label>;
  })}</>;
}
