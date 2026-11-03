import { AvatarStatusControl } from "./avatar-status";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LogOut, Settings2 } from "lucide-react";
import type { Profile, Session } from "./api";
import { ProfileAvatar } from "./profile";

export function AccountMenu({
  session,
  profile,
  onNavigate,
  onLogout,
  location,
}: {
  session: Session;
  profile: Profile | null;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  location: string;
}) {
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({ left: 12, bottom: 72, width: 236 });
  const trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const name = profile?.display_name || session.user.username;
  const role = session.user.role === "admin" ? "管理员" : "用户";
  useEffect(() => setOpen(false), [location]);
  useLayoutEffect(() => {
    if (!open) return;
    const rect = trigger.current!.getBoundingClientRect();
    const collapsed = !!trigger.current?.closest(".collapsed");
    const side = trigger.current!.closest(".sidebar")?.getBoundingClientRect();
    const width = Math.max(
      0,
      Math.min(
        300,
        window.innerWidth - 24,
        !collapsed && side ? side.width - 24 : 300,
      ),
    );
    const height = menu.current?.getBoundingClientRect().height || 220;
    setPosition({
      width,
      left: Math.max(
        12,
        Math.min(
          collapsed ? rect.right + 14 : (side?.left || 0) + 12,
          window.innerWidth - width - 12,
        ),
      ),
      bottom: Math.max(
        12,
        Math.min(
          collapsed ? 12 : window.innerHeight - rect.top + 12,
          window.innerHeight - height - 12,
        ),
      ),
    });
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);
  function close(focus = false) {
    setOpen(false);
    if (focus) trigger.current?.focus();
  }
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (
        !menu.current?.contains(e.target as Node) &&
        !trigger.current?.contains(e.target as Node)
      )
        close();
    };
    const resize = () => close();
    const hide = () => {
      if (document.hidden) close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("resize", resize);
    };
  }, [open]);
  function navigate(path: string) {
    close();
    onNavigate(path);
  }
  return (
    <>
      <div className="account-profile-shell">
        <button
          ref={trigger}
          className={"account-profile " + (open ? "active" : "")}
          aria-label="账户菜单"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? "account-menu" : undefined}
          onClick={() => setOpen(!open)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
            }
          }}
        >
          <span className="avatar-status-wrap">
            <ProfileAvatar profile={profile} username={session.user.username} />
          </span>
          <span className="account-name nav-text">
            <strong>{name}</strong>
            <span>{role}</span>
          </span>
        </button>
        <AvatarStatusControl
          className="sidebar-status-control"
          onOpen={() => setOpen(false)}
        />
      </div>
      {open &&
        createPortal(
          <div
            id="account-menu"
            ref={menu}
            role="menu"
            aria-label="账户"
            className="account-menu"
            style={position}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) close();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                close(true);
              }
              if (["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const buttons = Array.from(
                    menu.current!.querySelectorAll<HTMLButtonElement>("button"),
                  ),
                  index = buttons.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                buttons[
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? buttons.length - 1
                      : (index +
                          (e.key === "ArrowDown" ? 1 : -1) +
                          buttons.length) %
                        buttons.length
                ]?.focus();
              }
            }}
          >
            <button
              role="menuitem"
              className="account-menu-profile"
              onClick={() => navigate("/profile")}
            >
              <ProfileAvatar
                profile={profile}
                username={session.user.username}
              />
              <span className="account-name">
                <strong>{name}</strong>
                <span>{role}</span>
              </span>
            </button>
            <div className="account-menu-separator" role="separator" />
            <button role="menuitem" onClick={() => navigate("/settings")}>
              <Settings2 size={19} />
              <span>设置</span>
            </button>
            <div className="account-menu-separator" role="separator" />
            <button
              role="menuitem"
              onClick={() => {
                close();
                onLogout();
              }}
            >
              <LogOut size={19} />
              <span>退出登录</span>
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
