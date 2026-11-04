import { useMemo, useState } from "react";
import { CreditCard, ImageOff } from "lucide-react";
import { assetImageUrl } from "./local-media";
import type { PreferenceCard } from "./card-preference-state";

function CardFace({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    <img
      src={src}
      alt={name}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="card-face-missing">
      <ImageOff size={26} />
      <small>图片待登记</small>
    </span>
  );
}
export function CardGallery({
  cards,
  images,
  selected,
  onSelect,
  disabled,
}: {
  cards: readonly PreferenceCard[];
  images: readonly { path: string }[];
  selected: string;
  onSelect: (key: string) => void;
  disabled: boolean;
}) {
  const [offset, setOffset] = useState(0),
    size = 24;
  const registered = useMemo(
    () =>
      new Map(
        images.map((image) => [
          encodeURI(decodeSafe(image.path)),
          assetImageUrl(image.path),
        ]),
      ),
    [images],
  );
  const page = Math.min(
    offset,
    Math.max(0, Math.ceil(cards.length / size) - 1),
  );
  return (
    <div className="card-gallery-shell">
      <div className="card-gallery" aria-label="卡面图库">
        {cards.slice(page * size, (page + 1) * size).map((card) => (
          <button
            className="card-gallery-item"
            type="button"
            aria-label={card.label}
            aria-pressed={selected === card.key}
            disabled={disabled}
            key={card.key}
            onClick={() => onSelect(card.key)}
          >
            <CardFace
              key={card.key}
              src={registered.get(encodeURI(decodeSafe(card.key))) || ""}
              name={card.label}
            />
            <span>
              <CreditCard size={15} aria-hidden="true" />
              {card.label}
            </span>
          </button>
        ))}
      </div>
      {cards.length > size && (
        <div className="workspace-pagination">
          <span>
            第 {page + 1} / {Math.ceil(cards.length / size)} 页 · {cards.length}{" "}
            张
          </span>
          <button
            type="button"
            disabled={!page}
            onClick={() => setOffset(page - 1)}
          >
            上一页
          </button>
          <button
            type="button"
            disabled={(page + 1) * size >= cards.length}
            onClick={() => setOffset(page + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
function decodeSafe(value: string) {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}
