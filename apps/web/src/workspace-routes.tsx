import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Routes, useLocation, type Location } from "react-router-dom";

/** Keep each visited panel's complete URL while React Activity pauses hidden effects. */
export function WorkspaceRoutes({ path, children }: { path: string; children: ReactNode }) {
  const current = useLocation();
  const retained = useRef<Location | string>(path);
  const active = current.pathname === path;
  const location = active ? current : retained.current;
  useLayoutEffect(() => {
    if (active) retained.current = current;
  }, [current, active]);
  return <Routes location={location}>{children}</Routes>;
}
