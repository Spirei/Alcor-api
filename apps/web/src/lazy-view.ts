import { lazy, type ComponentType } from "react";
import { modulePreload } from "./module-preload";
export function lazyView<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
) {
  const read = modulePreload(load);
  return Object.assign(lazy(read), {
    preload: () => {
      void read().catch(() => {});
    },
  });
}
