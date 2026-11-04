import { useEffect, useState } from "react";
import { SelectMenu } from "./select-menu";
import { libraryMarkets } from "./asset-library-market";
import { FormActions, SettingsSurface } from "./workspace-forms";
const markets = [
  "US",
  "HK",
  "SH",
  "SZ",
  "CN",
  "CRYPTO",
  "ASSET",
  "JP",
  "KR",
  "SG",
  "TW",
  "UK",
  "DE",
  "FR",
  "AU",
  "CA",
  "IN",
  "BR",
  "OTHER",
];
const names: Record<string, string> = {
  ...libraryMarkets,
  SH: "沪市",
  SZ: "深市",
  CRYPTO: "加密货币",
  ASSET: "资产",
  OTHER: "其他",
};
type Badge = { label: string; bg: string; fg: string };
export function MarketBadgeSettings({
  value,
  disabled,
  onChange,
  expanded = false,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  expanded?: boolean;
}) {
  const [market, setMarket] = useState("CN"),
    [label, setLabel] = useState("CN"),
    [bg, setBg] = useState("#f0f2f5"),
    [fg, setFg] = useState("#1a1c1f");
  let badges: Record<string, Badge> = {},
    valid = true;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    badges = parsed;
  } catch {
    valid = false;
  }
  useEffect(() => {
    let current: Badge | undefined;
    try {
      current = JSON.parse(value)?.[market];
    } catch {
      /* Raw invalid configuration remains editable. */
    }
    setLabel(typeof current?.label === "string" ? current.label : market);
    setBg(
      typeof current?.bg === "string" && /^#[0-9a-f]{6}$/i.test(current.bg)
        ? current.bg
        : "#f0f2f5",
    );
    setFg(
      typeof current?.fg === "string" && /^#[0-9a-f]{6}$/i.test(current.fg)
        ? current.fg
        : "#1a1c1f",
    );
  }, [market, value]);
  return (
    <SettingsSurface title="逐市场色块" expanded={expanded}>
      <div className="workspace-form-grid">
        <label className="workspace-form-field">
          <span>市场</span>
          <SelectMenu
            label="色块市场"
            variant="field"
            value={market}
            disabled={disabled}
            options={markets.map((key) => ({
              value: key,
              label: `${names[key] || key} · ${key}`,
            }))}
            onChange={setMarket}
          />
        </label>
        <label className="workspace-form-field">
          <span>色块文字</span>
          <input
            disabled={disabled}
            value={label}
            maxLength={4}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label className="workspace-form-field">
          <span>背景色</span>
          <input
            disabled={disabled}
            type="color"
            value={bg}
            onChange={(event) => setBg(event.target.value)}
          />
        </label>
        <label className="workspace-form-field">
          <span>文字色</span>
          <input
            disabled={disabled}
            type="color"
            value={fg}
            onChange={(event) => setFg(event.target.value)}
          />
        </label>
      </div>
      <div className="site-badge-preview">
        <span style={{ background: bg, color: fg }}>{label || market}</span>
        <small>
          {!valid
            ? "原配置格式待核对"
            : Object.hasOwn(badges, market)
              ? "已配置此市场"
              : "此市场使用默认色块"}
        </small>
      </div>
      <FormActions>
        <button
          type="button"
          className="button"
          disabled={disabled || !valid || !Object.hasOwn(badges, market)}
          onClick={() => {
            const next = { ...badges };
            delete next[market];
            onChange(JSON.stringify(next, null, 2));
          }}
        >
          恢复默认色块
        </button>
        <button
          type="button"
          className="button"
          disabled={disabled || !valid || !label.trim()}
          onClick={() =>
            onChange(
              JSON.stringify(
                { ...badges, [market]: { label, bg, fg } },
                null,
                2,
              ),
            )
          }
        >
          采用此市场色块
        </button>
      </FormActions>
    </SettingsSurface>
  );
}
