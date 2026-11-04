import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

type Option<T extends string> = {
  value: T;
  label: string;
  color?: string;
  icon?: ReactNode;
};

function focusOption(popup: HTMLDivElement, option?: HTMLButtonElement | null) {
  if (!option) return;
  option.focus({ preventScroll: true });
  const panel = popup.getBoundingClientRect(),
    item = option.getBoundingClientRect();
  if (item.top < panel.top + 8) popup.scrollTop -= panel.top + 8 - item.top;
  else if (item.bottom > panel.bottom - 8)
    popup.scrollTop += item.bottom - panel.bottom + 8;
}

export function SelectMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  variant,
  disabled = false,
  triggerIcon,
  heading = false,
}: {
  label: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  variant?: "compact" | "field";
  disabled?: boolean;
  triggerIcon?: ReactNode;
  heading?: boolean;
}) {
  const id = useId(),
    trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const unavailable = disabled || options.length === 0;
  const displayLabel =
    selected?.label ??
    (!options.length ? "暂无可选项" : value ? "当前选项不可用" : "请选择");
  useEffect(
    () => () => {
      menu.current?.hidePopover();
    },
    [],
  );
  useEffect(() => {
    if (unavailable) menu.current?.hidePopover();
  }, [unavailable]);
  useEffect(() => {
    if (!open) return;
    const dismiss = () => menu.current?.hidePopover();
    const scroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) dismiss();
    };
    const visibility = () => {
      if (document.hidden) dismiss();
    };
    window.addEventListener("resize", dismiss);
    document.addEventListener("scroll", scroll, true);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("resize", dismiss);
      document.removeEventListener("scroll", scroll, true);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={
          "select-menu-trigger" +
          (variant ? " " + variant : "") +
          (triggerIcon ? " icon-only" : "")
        }
        disabled={unavailable}
        aria-label={
          triggerIcon
            ? label + (selected ? "：" + selected.label : "")
            : `${label}：${displayLabel}`
        }
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        popoverTarget={id}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            menu.current?.showPopover();
          }
        }}
      >
        {triggerIcon || (
          <>
            <span className="select-menu-label">
              {selected?.color && (
                <i
                  className="color-dot"
                  style={{ background: selected.color }}
                  aria-hidden="true"
                />
              )}
              {selected?.icon}
              <span>{displayLabel}</span>
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </>
        )}
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        className="select-menu-popup"
        role="listbox"
        aria-label={label}
        onToggle={(event) => {
          const expanded = event.newState === "open";
          setOpen(expanded);
          if (!expanded || !trigger.current) return;
          if (unavailable) {
            menu.current?.hidePopover();
            return;
          }
          const rect = trigger.current.getBoundingClientRect(),
            popup = event.currentTarget;
          const textWidth = Math.max(
            0,
            ...Array.from(
              popup.querySelectorAll<HTMLSpanElement>(
                ".select-menu-label > span",
              ),
              (text) =>
                text.scrollWidth + (text.previousElementSibling ? 26 : 0),
            ),
          );
          popup.style.width = `${Math.min(window.innerWidth - 24, Math.max(190, Math.min(280, Math.max(rect.width, textWidth + 76))))}px`;
          const above = Math.max(0, rect.top - 20);
          const below = Math.max(0, window.innerHeight - rect.bottom - 20);
          popup.style.maxHeight = `${Math.max(0, window.innerHeight - 24)}px`;
          const desiredHeight = Math.min(440, popup.scrollHeight + 2);
          const expandBelow = below >= desiredHeight || below >= above;
          popup.style.maxHeight = `${Math.min(440, expandBelow ? below : above)}px`;
          const left =
            variant === "compact" ? rect.right - popup.offsetWidth : rect.left;
          popup.style.left = `${Math.max(12, Math.min(left, window.innerWidth - popup.offsetWidth - 12))}px`;
          popup.style.top = `${expandBelow ? rect.bottom + 8 : rect.top - popup.offsetHeight - 8}px`;
          focusOption(
            popup,
            popup.querySelector<HTMLButtonElement>('[aria-selected="true"]') ||
              popup.querySelector<HTMLButtonElement>('[role="option"]'),
          );
        }}
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            menu.current?.hidePopover();
            return;
          }
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              '[role="option"]',
            ),
          );
          const index = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          focusOption(
            event.currentTarget,
            items[
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      items.length) %
                    items.length
            ],
          );
        }}
      >
        {heading && (
          <div className="select-menu-heading">
            <span>{label}</span>
            <small>{options.length} 个</small>
          </div>
        )}
        {options.map((option) => (
          <button
            type="button"
            role="option"
            disabled={unavailable}
            aria-selected={value === option.value}
            key={option.value}
            onClick={() => {
              onChange(option.value);
              menu.current?.hidePopover();
              trigger.current?.focus({ preventScroll: true });
            }}
          >
            <span className="select-menu-label">
              {option.icon}
              {option.color && (
                <i
                  className="color-dot"
                  style={{ background: option.color }}
                  aria-hidden="true"
                />
              )}
              <span>{option.label}</span>
            </span>
            {value === option.value && <Check size={17} aria-hidden="true" />}
          </button>
        ))}
      </div>
    </>
  );
}
