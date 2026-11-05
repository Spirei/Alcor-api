import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
type Callbacks = {
  move: (event: PointerEvent) => void;
  end: (moved: boolean) => void;
  cancel: () => void;
};
/** Listen above sortable DOM nodes, which may move or lose pointer capture. */
export function trackSortPointer(
  start: { pointerId: number; clientX: number; clientY: number },
  callbacks: Callbacks,
  target: EventTarget = window,
  page: EventTarget & { hidden: boolean } = document,
) {
  const id = start.pointerId,
    x = start.clientX,
    y = start.clientY;
  let moved = false,
    closed = false;
  function cleanup() {
    closed = true;
    target.removeEventListener("pointermove", move, true);
    target.removeEventListener("pointerup", end, true);
    target.removeEventListener("pointercancel", abort, true);
    target.removeEventListener("blur", abort);
    target.removeEventListener("keydown", key, true);
    page.removeEventListener("visibilitychange", visibility);
  }
  function move(raw: Event) {
    const next = raw as PointerEvent;
    if (closed || next.pointerId !== id) return;
    if (!moved && Math.hypot(next.clientX - x, next.clientY - y) < 6) return;
    moved = true;
    callbacks.move(next);
  }
  function end(raw: Event) {
    if (closed || (raw as PointerEvent).pointerId !== id) return;
    cleanup();
    callbacks.end(moved);
  }
  function abort(event?: Event) {
    if (event?.type === "pointercancel" && (event as PointerEvent).pointerId !== id) return;
    if (closed) return;
    cleanup();
    callbacks.cancel();
  }
  function visibility() {
    if (page.hidden) abort();
  }
  function key(raw: Event) {
    const next = raw as KeyboardEvent;
    if (next.key === "Escape") {
      next.preventDefault();
      abort();
    }
  }
  target.addEventListener("pointermove", move, true);
  target.addEventListener("pointerup", end, true);
  target.addEventListener("pointercancel", abort, true);
  target.addEventListener("blur", abort);
  target.addEventListener("keydown", key, true);
  page.addEventListener("visibilitychange", visibility);
  return abort;
}
export function useSortPointer() {
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);
  return (event: ReactPointerEvent<HTMLElement>, callbacks: Callbacks) => {
    if (event.button !== 0) return;
    cancel.current?.();
    event.preventDefault();
    cancel.current = trackSortPointer(event, callbacks);
  };
}
