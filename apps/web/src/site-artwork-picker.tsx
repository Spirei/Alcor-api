import { useId, useRef } from "react";
import { Camera, Image, X } from "lucide-react";
import { SelectMenu } from "./select-menu";
import {
  siteArtworkUrl,
  type SiteArtwork,
  type SiteArtworkField,
} from "./site-artwork-state";

export function SiteArtworkPicker({
  field,
  label,
  description,
  kind,
  value,
  assets,
  disabled,
  onChange,
  onUpload,
}: {
  field: SiteArtworkField;
  label: string;
  description: string;
  kind: string;
  value: string | null;
  assets: SiteArtwork[];
  disabled: boolean;
  onChange: (value: string | null) => void;
  onUpload: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null),
    id = useId();
  const image = siteArtworkUrl(
    assets.find((item) => item.id === value && item.kind === kind),
  );
  return (
    <div className="site-artwork-row">
      <input
        ref={input}
        type="file"
        hidden
        aria-label={`上传${label}`}
        accept={
          kind === "ico"
            ? ".png,.jpg,.jpeg,.gif,.webp,.svg,.ico"
            : kind === "logo"
              ? ".png,.jpg,.jpeg,.gif,.webp,.svg"
              : ".png,.jpg,.jpeg,.gif,.webp"
        }
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onUpload(file);
        }}
      />
      <button
        type="button"
        className={`site-artwork-thumbnail ${kind === "background" || kind === "login" ? "wide" : ""}`}
        aria-label={`更换${label}`}
        aria-describedby={id}
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        {image ? (
          <img src={image} alt="" loading="lazy" decoding="async" />
        ) : (
          <Image size={22} aria-hidden="true" />
        )}
        <span className="site-artwork-camera">
          <Camera size={16} aria-hidden="true" />
        </span>
      </button>
      <div className="site-artwork-copy">
        <strong>{label}</strong>
        <small id={id}>{description}</small>
      </div>
      <div className="site-artwork-choices">
        <SelectMenu
          label={`选择${label}`}
          value={value || ""}
          variant="field"
          disabled={disabled}
          options={[
            {
              value: "",
              label: field === "pwaIcon" ? "自动跟随网站图标" : "使用默认",
            },
            ...assets
              .filter((item) => item.kind === kind)
              .map((item, index) => ({
                value: item.id,
                label: `已上传图片 ${index + 1}`,
                icon: siteArtworkUrl(item) ? (
                  <img
                    className="site-artwork-option"
                    src={siteArtworkUrl(item)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                ) : undefined,
              })),
            ...(value && !assets.some((item) => item.id === value)
              ? [{ value, label: "当前图片" }]
              : []),
          ]}
          onChange={(value) => onChange(value || null)}
        />
        {value && (
          <button
            type="button"
            className="icon-button"
            aria-label={`移除${label}`}
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            <X size={15} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
