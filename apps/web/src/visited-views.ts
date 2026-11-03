import { useEffect, useState } from "react";

/** Mount on first visit, then retain drafts, filters, and scroll on navigation. */
export function useVisitedViews(active: string) {
  const [visited, setVisited] = useState(() => new Set([active]));
  useEffect(() => {
    setVisited((previous) =>
      previous.has(active) ? previous : new Set([...previous, active]),
    );
  }, [active]);
  return (path: string) => path === active || visited.has(path);
}
