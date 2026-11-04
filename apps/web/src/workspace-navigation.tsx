import { useLayoutEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { workspaceNavigation } from "./site-navigation";

type Item = { path: string; name: string; icon: LucideIcon };

export function WorkspaceNavigation({
  items,
  collapsed,
  mobileOpen,
  preferInputOrder = false,
  onNavigate,
}: {
  items: readonly Item[];
  collapsed: boolean;
  mobileOpen: boolean;
  preferInputOrder?: boolean;
  onNavigate: (path: string) => void;
}) {
  const { pathname } = useLocation();
  const container = useRef<HTMLElement>(null);
  const paths = items.map((item) => item.path).join("\0");
  useLayoutEffect(() => {
    const nav = container.current;
    const selected =
      nav?.querySelector<HTMLElement>('[aria-current="page"]') ||
      (mobileOpen ? nav?.querySelector<HTMLElement>("a") : null);
    if (!nav || !selected) return;
    const bounds = nav.getBoundingClientRect(),
      item = selected.getBoundingClientRect();
    const section = selected.parentElement;
    const label = section?.querySelector<HTMLElement>(".sidebar-section-label");
    const top =
      section?.querySelector("a") === selected && label?.getClientRects().length
        ? Math.min(label.getBoundingClientRect().top, item.top)
        : item.top;
    // Reveal only within the sidebar; never scroll or remount the active page.
    if (top < bounds.top) nav.scrollTop -= bounds.top - top + 8;
    else if (item.bottom > bounds.bottom)
      nav.scrollTop += item.bottom - bounds.bottom + 8;
  }, [pathname, collapsed, mobileOpen, paths, preferInputOrder]);

  return (
    <nav ref={container} className="sidebar-navigation" aria-label="主导航">
      {workspaceNavigation(items, preferInputOrder).map((section) => (
        <div
          key={section.key}
          className="sidebar-section"
          role="group"
          aria-label={section.label}
        >
          <h2 className="sidebar-section-label nav-text">{section.label}</h2>
          {section.items.map(({ path, name, icon: Icon }) => {
            const connection =
              path === "/" && pathname.startsWith("/connections/");
            return (
              <NavLink
                key={path}
                to={path}
                end={path === "/"}
                className={({ isActive }) =>
                  isActive || connection ? "active" : ""
                }
                aria-label={name}
                aria-current={connection ? "page" : undefined}
                title={collapsed ? name : undefined}
                onClick={() => onNavigate(path)}
              >
                <Icon size={19} />
                <span className="nav-text">{name}</span>
              </NavLink>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
