import { useEffect, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { X } from "lucide-react";

export function Dialog({
  title,
  onClose,
  children,
  className,
  returnFocusRef,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  const outside = (x: number, y: number) => {
    const rect = ref.current?.getBoundingClientRect();
    return (
      !!rect &&
      (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom)
    );
  };
  useEffect(() => {
    const previous =
      returnFocusRef?.current ??
      (document.activeElement === document.body
        ? document.querySelector<HTMLElement>(
            '[data-module-active="true"] [data-dialog-return]',
          ) ||
          document.querySelector<HTMLElement>("[data-global-search-trigger]")
        : document.activeElement);
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>("[data-dialog-autofocus]")?.focus();
    return () => {
      dialog?.close();
      const target = returnFocusRef?.current ?? previous;
      if (
        target instanceof HTMLElement &&
        target.isConnected &&
        target.getClientRects().length &&
        !target.closest("[inert]")
      )
        target.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={className}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onPointerDown={(event) => {
        backdropPress.current =
          event.isPrimary &&
          event.button === 0 &&
          event.target === ref.current &&
          outside(event.clientX, event.clientY);
      }}
      onPointerCancel={() => {
        backdropPress.current = false;
      }}
      onClick={(event) => {
        const dismiss =
          backdropPress.current &&
          event.target === ref.current &&
          outside(event.clientX, event.clientY);
        backdropPress.current = false;
        if (dismiss) onClose();
      }}
      aria-label={title}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
