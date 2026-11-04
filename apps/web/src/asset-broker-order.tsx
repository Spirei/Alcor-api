import { useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { useAccountAppearance } from "./account-preference-context";
import type { LibraryAsset } from "./asset-library-market";
import { brokerOrder } from "./asset-library-market";
export function useBrokerOrder(rows: LibraryAsset[]) {
  const preferences = useAccountAppearance(),
    [draft, setDraft] = useState<string[] | null>(null);
  const ids = [
    ...new Set([
      ...(draft || brokerOrder(preferences?.settings.assetBrokerOrder)),
      ...rows.map((r) => r.id),
    ]),
  ];
  const current = useRef(ids);
  current.current = ids;
  function move(id: string, target: string, commit = true) {
    const next = [...current.current],
      from = next.indexOf(id),
      to = next.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    next.splice(to, 0, ...next.splice(from, 1));
    current.current = next;
    setDraft(next);
    if (commit) {
      preferences?.update({ assetBrokerOrder: next.slice(0, 500) });
      setDraft(null);
    }
  }
  return {
    rows: [...rows].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)),
    ready: !!preferences?.ready,
    move,
    commit: () => {
      preferences?.update({ assetBrokerOrder: current.current.slice(0, 500) });
      setDraft(null);
    },
    ids,
  };
}
export function BrokerGrip({
  id,
  order,
  disabled,
}: {
  id: string;
  order: ReturnType<typeof useBrokerOrder>;
  disabled: boolean;
}) {
  const drag = useRef(false);
  return (
    <button
      type="button"
      className="asset-broker-grip"
      title="按住拖动，或用上下方向键排序"
      aria-label="调整券商排序"
      disabled={disabled || !order.ready}
      onKeyDown={(e) => {
        const step = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
        if (!step) return;
        e.preventDefault();
        const target = order.ids[order.ids.indexOf(id) + step];
        if (target) order.move(id, target);
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        drag.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const root = e.currentTarget.closest(".asset-library");
        for (const row of root?.querySelectorAll<HTMLElement>(
          "[data-broker-id]",
        ) || []) {
          const rect = row.getBoundingClientRect();
          if (
            e.clientY >= rect.top &&
            e.clientY < rect.bottom &&
            row.dataset.brokerId !== id
          ) {
            order.move(id, row.dataset.brokerId!, false);
            break;
          }
        }
      }}
      onPointerUp={(e) => {
        if (drag.current) {
          drag.current = false;
          order.commit();
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      }}
      onPointerCancel={() => {
        drag.current = false;
        order.commit();
      }}
    >
      <GripVertical size={15} />
    </button>
  );
}
