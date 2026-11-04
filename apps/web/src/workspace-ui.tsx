import {
  Activity,
  Suspense,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronLeft, ChevronRight, Inbox } from "lucide-react";
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
  const [edges, setEdges] = useState({ start: false, end: false });
  const contentKey = items
    .map((item) => item.value + ":" + item.label)
    .join("\0");
  const measure = () => {
    const nav = container.current;
    if (!nav) return;
    const start = nav.scrollLeft > 2;
    const end = nav.scrollWidth - nav.clientWidth - nav.scrollLeft > 2;
    setEdges((previous) =>
      previous.start === start && previous.end === end
        ? previous
        : { start, end },
    );
  };
  useLayoutEffect(() => {
    const nav = container.current;
    if (!nav) return;
    const reveal = () => {
      const selected = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!selected) {
        measure();
        return;
      }
      const bounds = nav.getBoundingClientRect(),
        item = selected.getBoundingClientRect();
      if (item.left < bounds.left + 6)
        nav.scrollLeft -= bounds.left + 6 - item.left;
      else if (item.right > bounds.right - 6)
        nav.scrollLeft += item.right - bounds.right + 6;
      measure();
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(nav);
    for (const item of nav.children) observer.observe(item);
    return () => observer.disconnect();
  }, [value, contentKey]);
  return (
    <div
      className="workspace-tabs-shell"
      data-scroll-start={edges.start || undefined}
      data-scroll-end={edges.end || undefined}
    >
      <nav
        className="workspace-tabs"
        aria-label={label}
        ref={container}
        onScroll={measure}
      >
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
      <span className="workspace-tab-hint start" aria-hidden="true">
        <ChevronLeft size={15} />
      </span>
      <span className="workspace-tab-hint end" aria-hidden="true">
        <ChevronRight size={15} />
      </span>
    </div>
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

/** Paging is a deliberate navigation: reveal the new content without moving the sidebar. */
export function usePageReveal(page: number) {
  const ref = useRef<HTMLDivElement>(null);
  const requested = useRef(false);
  useLayoutEffect(() => {
    if (!requested.current) return;
    requested.current = false;
    const content = ref.current;
    if (!content || !content.getClientRects().length) return;
    content.focus({ preventScroll: true });
    content.scrollIntoView({ block: "start", behavior: "instant" });
  }, [page]);
  return {
    ref,
    request: () => {
      requested.current = true;
    },
  };
}
