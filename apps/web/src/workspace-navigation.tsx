import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown, FolderOpen, LayoutGrid, Settings2, WalletCards, type LucideIcon } from "lucide-react";
import { currentNavigationSection, workspaceNavigation } from "./site-navigation";
import "./workspace-navigation.css";

type Item = { path: string; name: string; icon: LucideIcon };
const sectionIcons: Record<string, LucideIcon> = {
  assets: WalletCards,
  management: FolderOpen,
  system: Settings2,
};

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
  const location = useLocation();
  const { pathname } = location;
  const id = useId();
  const container = useRef<HTMLElement>(null);
  const sections = workspaceNavigation(items, preferInputOrder);
  const activeSection = currentNavigationSection(sections, pathname);
  const fallback = activeSection || sections[0]?.key;
  const [disclosure, setDisclosure] = useState<string | null>();
  useLayoutEffect(() => setDisclosure(undefined), [location.key]);
  useLayoutEffect(() => { if (mobileOpen) setDisclosure(undefined); }, [mobileOpen]);
  // Navigating directly, through search, or Back/Forward reveals the current category.
  // Opening another category never changes or unmounts the current page.
  const selected = disclosure === undefined ? fallback : disclosure;
  const opened = sections.some(section => section.key === selected) ? selected : selected === null ? null : fallback;
  const paths = items.map((item) => item.path).join("\0");
  useEffect(() => {
    if (!mobileOpen) return;
    const panel = container.current?.closest("aside");
    if (!panel) return;
    const containFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = [...panel.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]")]
        .filter(node => node.tabIndex >= 0 && !node.matches(":disabled") && node.getClientRects().length);
      const edge = event.shiftKey ? controls[0] : controls[controls.length - 1];
      if (document.activeElement === edge) {
        event.preventDefault();
        (event.shiftKey ? controls[controls.length - 1] : controls[0])?.focus({ preventScroll: true });
      }
    };
    panel.addEventListener("keydown", containFocus);
    return () => panel.removeEventListener("keydown", containFocus);
  }, [mobileOpen]);

  useLayoutEffect(() => {
    const nav = container.current;
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    const section = nav?.querySelector<HTMLElement>('[data-expanded="true"]');
    const target = current?.getClientRects().length ? current : section?.querySelector<HTMLElement>("button");
    if (!nav || !target) return;
    const bounds = nav.getBoundingClientRect(), item = target.getBoundingClientRect();
    const top = target.closest(".sidebar-section")?.querySelector<HTMLElement>(".sidebar-section-trigger");
    const targetTop = target === section?.querySelector("a") && top ? top.getBoundingClientRect().top : item.top;
    if (targetTop < bounds.top) nav.scrollTop -= bounds.top - targetTop + 8;
    else if (item.bottom > bounds.bottom) nav.scrollTop += item.bottom - bounds.bottom + 8;
  }, [pathname, collapsed, mobileOpen, paths, preferInputOrder, opened]);

  return (
    <nav ref={container} className="sidebar-navigation" aria-label="主导航">
      {sections.map((section) => {
        const expanded = opened === section.key;
        const Icon = sectionIcons[section.key] || LayoutGrid;
        const contentId = `${id}-${section.key}`;
        return (
          <section key={section.key} className="sidebar-section" aria-label={section.label} data-expanded={expanded}>
            <h2 className="sidebar-section-heading">
              <button type="button" className="sidebar-section-trigger"
                aria-label={section.label} aria-expanded={expanded} aria-controls={contentId}
                title={collapsed ? `${section.label}导航` : undefined}
                onClick={() => setDisclosure(expanded ? null : section.key)}>
                <Icon className="sidebar-section-icon" size={16} aria-hidden="true" />
                <span className="sidebar-section-label nav-text">{section.label}</span>
                <ChevronDown className="sidebar-section-chevron" size={14} aria-hidden="true" />
              </button>
            </h2>
            <div id={contentId} className="sidebar-section-links" hidden={!expanded}>
              {section.items.map(({ path, name, icon: ItemIcon }) => {
                const connection = path === "/" && pathname.startsWith("/connections/");
                return (
                  <NavLink key={path} to={path} end={path === "/"}
                    className={({ isActive }) => isActive || connection ? "active" : ""}
                    aria-label={name} aria-current={connection ? "page" : undefined}
                    title={collapsed ? name : undefined} onClick={() => onNavigate(path)}>
                    <ItemIcon size={19} aria-hidden="true" />
                    <span className="nav-text">{name}</span>
                  </NavLink>
                );
              })}
            </div>
          </section>
        );
      })}
    </nav>
  );
}
