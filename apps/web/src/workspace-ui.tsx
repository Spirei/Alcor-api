import {
  Activity,
  Suspense,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import "./workspace-ui.css";

export function WorkspaceTabs<T extends string>({
  label,
  value,
  items,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  items: readonly { value: T; label: string; icon?: LucideIcon }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const container = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = container.current;
    if (!nav) return;
    const reveal = () => {
      const selected = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!selected) return;
      const bounds = nav.getBoundingClientRect(),
        item = selected.getBoundingClientRect();
      if (item.left < bounds.left) nav.scrollLeft -= bounds.left - item.left;
      else if (item.right > bounds.right)
        nav.scrollLeft += item.right - bounds.right;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [value]);
  return (
    <nav className="workspace-tabs" aria-label={label} ref={container}>
      {items.map(({ value: key, label: title, icon: Icon }) => (
        <button
          type="button"
          key={key}
          disabled={disabled}
          aria-current={value === key ? "page" : undefined}
          onClick={() => {
            if (value !== key) onChange(key);
          }}
        >
          {Icon && <Icon size={17} aria-hidden="true" />}
          <span>{title}</span>
        </button>
      ))}
    </nav>
  );
}

/** First visit mounts the view; subsequent switches preserve drafts and stop hidden effects. */
export function WorkspaceView({
  active,
  children,
  label,
  keepEffects = false,
}: {
  active: boolean;
  children: ReactNode;
  label: string;
  keepEffects?: boolean;
}) {
  const visited = useRef(active);
  if (active) visited.current = true;
  // Cross-panel operation journals must be read even before their visual panel is opened.
  if (keepEffects)
    return (
      <section className="workspace-view" aria-label={label} hidden={!active}>
        {children}
      </section>
    );
  return visited.current ? (
    <Activity mode={active ? "visible" : "hidden"}>
      <section className="workspace-view" aria-label={label}>
        <Suspense
          fallback={
            <div
              className="workspace-view-loading"
              role="status"
              aria-label="正在读取"
            >
              <i />
              <i />
              <i />
            </div>
          }
        >
          {children}
        </Suspense>
      </section>
    </Activity>
  ) : null;
}

export function WorkspacePanel({
  title,
  actions,
  children,
  className = "",
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`workspace-panel ${className}`}>
      {(title || actions) && (
        <header className="workspace-panel-heading">
          {title && <h2>{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function WorkspaceEmpty({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="workspace-empty" role="status">
      <span className="workspace-empty-icon">
        <Inbox size={25} strokeWidth={1.4} />
      </span>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {actions}
    </div>
  );
}
