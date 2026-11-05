import { useLayoutEffect, useRef, type RefObject } from "react";
/** Animate only the displacement caused by reordering, without changing layout. */
export function useSortMotion(
  root: RefObject<HTMLElement | null>,
  selector: string,
  order: string,
  layout = "",
) {
  const previous = useRef(new Map<string, { left: number; top: number }>());
  const shape = useRef({ width: 0, layout });
  useLayoutEffect(() => {
    const next = new Map<string, { left: number; top: number }>();
    const width = root.current?.clientWidth || 0;
    const stable =
      shape.current.width === width && shape.current.layout === layout;
    shape.current = { width, layout };
    for (const element of root.current?.querySelectorAll<HTMLElement>(
      selector,
    ) || []) {
      const id = element.dataset.marketCode || element.dataset.brokerId;
      if (!id) continue;
      const box = { left: element.offsetLeft, top: element.offsetTop },
        before = previous.current.get(id);
      next.set(id, box);
      if (
        before &&
        stable &&
        !matchMedia("(prefers-reduced-motion: reduce)").matches &&
        document.documentElement.dataset.reducedMotion !== "true"
      ) {
        const x = before.left - box.left,
          y = before.top - box.top;
        if (x || y) {
          element.getAnimations().forEach((animation) => animation.cancel());
          element.animate(
            [
              { transform: `translate(${x}px,${y}px)` },
              { transform: "translate(0,0)" },
            ],
            { duration: 180, easing: "cubic-bezier(.2,.7,.2,1)" },
          );
        }
      }
    }
    previous.current = next;
  }, [root, selector, order, layout]);
}
