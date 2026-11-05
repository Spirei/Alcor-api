import { useSortPointer } from "./sort-pointer";
import { useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { useAccountAppearance } from "./account-preference-context";
import type { LibraryAsset } from "./asset-library-market";
import { brokerOrder } from "./asset-library-market";
export function useBrokerOrder(rows: LibraryAsset[]) {
  const preferences = useAccountAppearance(),
    [draft, setDraft] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null),
    [message, setMessage] = useState("");
  const ids = [
    ...new Set([
      ...(draft || brokerOrder(preferences?.settings.assetBrokerOrder)),
      ...rows.map((r) => r.id),
    ]),
  ];
  const storedOrder = brokerOrder(preferences?.settings.assetBrokerOrder).join(
    ",",
  );
  useEffect(() => {
    if (draft && draft.join(",") === storedOrder) setDraft(null);
  }, [storedOrder]);
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
      setMessage("券商顺序已调整");
      preferences?.update({ assetBrokerOrder: next.slice(0, 500) });
    }
  }
  return {
    rows: [...rows].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)),
    ready: !!preferences?.ready,
    move,
    begin: (id: string) => {
      setDragging(id);
      setMessage("拖动调整顺序，松开完成，按 Escape 取消");
    },
    dragging,
    message,
    commit: () => {
      setDragging(null);
      setMessage("券商顺序已调整");
      preferences?.update({ assetBrokerOrder: current.current.slice(0, 500) });
    },
    cancel: () => {
      setDraft(null);
      setDragging(null);
      setMessage("已取消排序");
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
  const begin = useSortPointer();
  const current = useRef(order);
  current.current = order;
  return (
    <button
      type="button"
      className="asset-broker-grip"
      title="按住拖动，或用上下方向键排序"
      aria-label="调整券商排序"
      disabled={disabled || !order.ready}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          order.cancel();
          return;
        }
        const step = ["ArrowUp", "ArrowLeft"].includes(e.key)
          ? -1
          : ["ArrowDown", "ArrowRight"].includes(e.key)
            ? 1
            : 0;
        if (!step) return;
        e.preventDefault();
        const target = order.ids[order.ids.indexOf(id) + step];
        if (target) order.move(id, target);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const root = event.currentTarget.closest(".asset-library");
        const slots = [
          ...(root?.querySelectorAll<HTMLElement>("[data-broker-id]") || []),
        ].map((row) => ({
          id: row.dataset.brokerId!,
          box: row.getBoundingClientRect(),
        }));
        order.begin(id);
        begin(event, {
          move(next) {
            const index = slots.findIndex(
              ({ box }) =>
                next.clientX >= box.left &&
                next.clientX < box.right &&
                next.clientY >= box.top &&
                next.clientY < box.bottom,
            );
            if (index < 0) return;
            const visible = new Set(slots.map((slot) => slot.id)),
              target = current.current.ids.filter((key) => visible.has(key))[
                index
              ];
            if (target && target !== id)
              current.current.move(id, target, false);
          },
          end(moved) {
            if (moved) current.current.commit();
            else current.current.cancel();
          },
          cancel() {
            current.current.cancel();
          },
        });
      }}
    >
      <GripVertical size={15} />
    </button>
  );
}
