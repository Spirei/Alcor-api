import type { ReactNode } from "react";
import "./workspace-forms.css";

export function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="workspace-setting-row">
      <div className="workspace-setting-label">
        <span>{title}</span>
        {description && <small>{description}</small>}
      </div>
      <div className="workspace-setting-control">{children}</div>
    </div>
  );
}
export function SettingGroup({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className="workspace-setting-group">
      {title && <h3>{title}</h3>}
      <div className="workspace-setting-rows">{children}</div>
    </section>
  );
}
export function ToggleSwitch({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="workspace-switch"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="workspace-switch-track" aria-hidden="true">
        <span />
      </span>
    </button>
  );
}
export function FormActions({ children }: { children: ReactNode }) {
  return <div className="workspace-form-actions">{children}</div>;
}

/** A page/tab is already an explicit entry; it must not ask the user to open it again. */
export function SettingsSurface({
  title,
  expanded = false,
  open = true,
  onOpenChange,
  children,
}: {
  title: string;
  expanded?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  return expanded ? (
    <section className="workspace-settings-surface" aria-label={title}>
      {children}
    </section>
  ) : (
    <details
      className="workspace-settings-surface"
      open={open}
      onToggle={(event) => onOpenChange?.(event.currentTarget.open)}
    >
      <summary>{title}</summary>
      {children}
    </details>
  );
}
