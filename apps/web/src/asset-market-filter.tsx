import { useRef, useState } from "react";
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
    [message, setMessage] = useState("");
  const order = draft || stored,
    current = useRef(order);
  current.current = order;
  const more = order.slice(5).filter((code) => available?.includes(code));
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    code: string;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  function commit(next: string[], code: string) {
    preferences?.update({ assetMarketOrder: next });
    setDraft(null);
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
            data-dragging={drag.current?.code === code || undefined}
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
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                drag.current = {
                  code,
                  x: e.clientX,
                  y: e.clientY,
                  moved: false,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const moving = drag.current;
                if (!moving) return;
                if (
                  Math.hypot(e.clientX - moving.x, e.clientY - moving.y) < 5 &&
                  !moving.moved
                )
                  return;
                moving.moved = true;
                for (const chip of root.current?.querySelectorAll<HTMLElement>(
                  "[data-market-code]",
                ) || []) {
                  const box = chip.getBoundingClientRect(),
                    target = chip.dataset.marketCode!;
                  if (
                    target !== code &&
                    e.clientX >= box.left &&
                    e.clientX <= box.right &&
                    e.clientY >= box.top &&
                    e.clientY <= box.bottom
                  ) {
                    const from = current.current.indexOf(code),
                      to = current.current.indexOf(target);
                    if (
                      (from < to && e.clientX > box.left + box.width * 0.55) ||
                      (from > to && e.clientX < box.left + box.width * 0.45)
                    ) {
                      const next = moveLibraryMarket(
                        current.current,
                        code,
                        target,
                      );
                      current.current = next;
                      setDraft(next);
                    }
                    break;
                  }
                }
              }}
              onPointerUp={(e) => {
                const moving = drag.current;
                drag.current = null;
                e.currentTarget.releasePointerCapture(e.pointerId);
                if (moving?.moved) commit(current.current, code);
                else setDraft(null);
              }}
              onPointerCancel={() => {
                drag.current = null;
                setDraft(null);
              }}
              onKeyDown={(e) => {
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
