import {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
} from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { MessageCircle, Target, BellOff } from "lucide-react";
import type { Session } from "./api";
import "./avatar-status.css";
import { useAccountStatus } from "./account-preferences";

const choices = [
  { value: "online", label: "在线", icon: MessageCircle },
  { value: "focus", label: "专注", icon: Target },
  { value: "doNotDisturb", label: "勿扰", icon: BellOff },
] as const;
type Status = (typeof choices)[number]["value"];
const Context = createContext<{
  status: Status;
  select: (value: Status) => void;
} | null>(null);

export function AvatarStatusProvider({
  children,
}: {
  session: Session;
  children: ReactNode;
}) {
  const value = useAccountStatus();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function AvatarStatusDot() {
  const value = useContext(Context);
  if (!value) return null;
  const label = choices.find((choice) => choice.value === value.status)!.label;
  return (
    <span
      className={`avatar-status-dot ${value.status}`}
      role="img"
      aria-label={`状态：${label}`}
      title={label}
    />
  );
}

function AvatarStatusPicker({ onSelected }: { onSelected: () => void }) {
  const value = useContext(Context);
  if (!value) return null;
  return (
    <div className="avatar-status-picker" role="group" aria-label="状态">
      {choices.map(({ value: status, label, icon: Icon }) => (
        <button
          key={status}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={value.status === status}
          className={`avatar-status-choice ${status} ${value.status === status ? "selected" : ""}`}
          onClick={() => {
            value.select(status);
            onSelected();
          }}
        >
          <Icon
            size={24}
            strokeWidth={2.4}
            fill={status === "online" ? "currentColor" : "none"}
          />
        </button>
      ))}
    </div>
  );
}

export function AvatarStatusControl({
  className = "",
  onOpen,
}: {
  className?: string;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const trigger = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const location = useLocation();
  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }
  function show() {
    cancel();
    onOpen?.();
    setOpen(true);
  }
  function close(focus = false) {
    setOpen(false);
    if (focus) trigger.current?.focus();
  }
  useEffect(() => {
    cancel();
    setOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) {
        cancel();
        setOpen(false);
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancel();
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  useLayoutEffect(() => {
    if (!open || !popup.current || !trigger.current) return;
    const anchor = trigger.current.getBoundingClientRect(),
      rect = popup.current.getBoundingClientRect();
    setPosition({
      left: Math.max(
        12,
        Math.min(anchor.right + 12, window.innerWidth - rect.width - 12),
      ),
      top: Math.max(
        12,
        Math.min(
          anchor.top + anchor.height / 2 - rect.height / 2,
          window.innerHeight - rect.height - 12,
        ),
      ),
    });
    popup.current
      .querySelector<HTMLButtonElement>('[aria-pressed="true"]')
      ?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (
        !popup.current?.contains(e.target as Node) &&
        !trigger.current?.contains(e.target as Node)
      )
        close();
    };
    const resize = () => close();
    const hidden = () => {
      if (document.hidden) {
        cancel();
        close();
      }
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("visibilitychange", hidden);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("visibilitychange", hidden);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", resize);
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`avatar-status-trigger ${className}`}
        aria-label="更改状态"
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          cancel();
          origin.current = { x: e.clientX, y: e.clientY };
          timer.current = setTimeout(show, 450);
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onPointerLeave={cancel}
        onPointerMove={(e) => {
          if (
            Math.hypot(
              e.clientX - origin.current.x,
              e.clientY - origin.current.y,
            ) > 10
          )
            cancel();
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (["Enter", " ", "ArrowDown"].includes(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            show();
          }
        }}
      >
        <AvatarStatusDot />
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            className="avatar-status-popover"
            role="dialog"
            aria-label="选择状态"
            style={position}
          >
            <AvatarStatusPicker onSelected={() => close(true)} />
          </div>,
          document.body,
        )}
    </>
  );
}
