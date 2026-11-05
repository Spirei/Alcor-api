import { useSortPointer } from "./sort-pointer";
import { useSortMotion } from "./sort-motion";
import { useEffect, useRef, useState } from "react";
import { Globe2, Grid2X2, GripVertical } from "lucide-react";
import { SelectMenu } from "./select-menu";
import { useAccountAppearance } from "./account-preference-context";
import {
  libraryMarkets,
  libraryMarketOrder,
  moveLibraryMarket,
} from "./asset-library-market";
import { assetImageUrl } from "./local-media";

function MarketPicture({
  code,
  icons,
}: {
  code: string;
  icons: Record<string, string>;
}) {
  const [failed, setFailed] = useState("");
  const src = assetImageUrl(icons[code === "UK" ? "GB" : code]);
  return (
    <span className="asset-market-picture" aria-hidden="true">
      {src && failed !== src ? (
        <img src={src} alt="" decoding="async" onError={() => setFailed(src)} />
      ) : (
        <Globe2 size={17} />
      )}
    </span>
  );
}

export function AssetMarketFilter({
  value,
  onChange,
  icons,
  available,
}: {
  value: string;
  onChange: (value: string) => void;
  icons: Record<string, string>;
  available: string[] | null;
}) {
  const preferences = useAccountAppearance();
  const stored = libraryMarketOrder(preferences?.settings.assetMarketOrder);
  const [draft, setDraft] = useState<string[] | null>(null),
    [message, setMessage] = useState(""),
    [dragging, setDragging] = useState<string | null>(null);
  const order = draft || stored,
    current = useRef(order);
  current.current = order;
  const more = order.slice(5).filter((code) => available?.includes(code));
  const root = useRef<HTMLDivElement>(null);
  useSortMotion(root, "[data-market-code]", order.join(","));
  useEffect(() => {
    if (draft && JSON.stringify(draft) === JSON.stringify(stored)) {
      setDraft(null);
      setMessage("市场顺序已调整");
    }
  }, [stored.join(",")]);
  const begin = useSortPointer();
  function commit(next: string[], code: string) {
    preferences?.update({ assetMarketOrder: next });
    setDraft(next);
    setMessage(`${libraryMarkets[code]}已移至第 ${next.indexOf(code) + 1} 位`);
  }
  return (
    <div className="asset-market-filter">
      <span className="asset-market-hint">
        市场<span>按住拖动排序</span>
      </span>
      <div
        className="asset-market-chips"
        ref={root}
        role="group"
        aria-label="市场快捷筛选"
      >
        <button
          type="button"
          className="asset-market-chip"
          aria-pressed={!value}
          onClick={() => onChange("")}
        >
          <Grid2X2 size={16} />
          全部
        </button>
        {order.slice(0, 5).map((code) => (
          <div
            className="asset-market-chip-wrap"
            key={code}
            data-market-code={code}
            data-dragging={dragging === code || undefined}
          >
            <button
              type="button"
              className="asset-market-chip"
              aria-pressed={value === code}
              onClick={() => onChange(code)}
            >
              <MarketPicture code={code} icons={icons} />
              {libraryMarkets[code]}
            </button>
            <button
              type="button"
              className="asset-market-grip"
              aria-label={`调整${libraryMarkets[code]}排序`}
              title="按住拖动，或用左右方向键调整顺序"
              disabled={!preferences?.ready}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                const slots = [
                  ...(root.current?.querySelectorAll<HTMLElement>(
                    "[data-market-code]",
                  ) || []),
                ].map((chip) => chip.getBoundingClientRect());
                setDragging(code);
                setMessage(
                  `正在移动${libraryMarkets[code]}，松开完成，按 Escape 取消`,
                );
                begin(event, {
                  move(next) {
                    const index = slots.findIndex(
                      (box) =>
                        next.clientX >= box.left &&
                        next.clientX < box.right &&
                        next.clientY >= box.top &&
                        next.clientY < box.bottom,
                    );
                    if (index < 0) return;
                    const target = current.current[index];
                    if (target !== code) {
                      const order = moveLibraryMarket(
                        current.current,
                        code,
                        target,
                      );
                      current.current = order;
                      setDraft(order);
                    }
                  },
                  end(moved) {
                    setDragging(null);
                    if (moved) commit(current.current, code);
                    else {
                      setDraft(null);
                      setMessage("");
                    }
                  },
                  cancel() {
                    setDragging(null);
                    setDraft(null);
                    setMessage("已取消排序");
                  },
                });
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setDragging(null);
                  setDraft(null);
                  setMessage("已取消排序");
                  return;
                }
                if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
                e.preventDefault();
                const index = order.indexOf(code),
                  target = index + (e.key === "ArrowLeft" ? -1 : 1);
                if (target >= 0 && target < 5)
                  commit(moveLibraryMarket(order, code, order[target]), code);
              }}
            >
              <GripVertical size={12} />
            </button>
          </div>
        ))}
        {more.length > 0 && (
          <SelectMenu
            label="更多市场"
            value={more.includes(value) ? value : ""}
            variant="compact"
            heading
            triggerIcon={<Grid2X2 size={18} />}
            onChange={onChange}
            options={more.map((code) => ({
              value: code,
              label: libraryMarkets[code],
              icon: <MarketPicture code={code} icons={icons} />,
            }))}
          />
        )}
      </div>
      <span className="asset-market-announcement" role="status">
        {message}
      </span>
    </div>
  );
}
