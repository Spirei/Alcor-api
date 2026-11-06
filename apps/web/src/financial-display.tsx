import { Eye, EyeOff } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { usePublicSite } from "./public-site";
import { libraryMarkets } from "./asset-library-market";
import "./financial-display.css";
const Context = createContext({
  visible: true,
  setVisible: (_value: boolean) => {},
});
// Old assetsVisible was session state, not a synchronized preference or source key.
export function FinancialDisplayProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(true);
  return (
    <Context.Provider value={{ visible, setVisible }}>
      {children}
    </Context.Provider>
  );
}
export const useFinancialDisplay = () => useContext(Context);
export function AmountVisibilityControl() {
  const { visible, setVisible } = useFinancialDisplay();
  return (
    <button
      type="button"
      className="icon-button amount-visibility-control"
      aria-label={visible ? "隐藏金额" : "显示金额"}
      title={visible ? "隐藏金额" : "显示金额"}
      aria-pressed={!visible}
      onClick={() => setVisible(!visible)}
    >
      {visible ? (
        <Eye size={18} aria-hidden="true" />
      ) : (
        <EyeOff size={18} aria-hidden="true" />
      )}
    </button>
  );
}
export function PrivateAmount({ children }: { children: ReactNode }) {
  const { visible } = useFinancialDisplay();
  return <span>{visible ? children : "******"}</span>;
}
export function MarketBadge({ market }: { market: string }) {
  const site = usePublicSite(),
    badge = Object.hasOwn(site.marketBadges, market)
      ? site.marketBadges[market]
      : undefined;
  const flags: Record<string, string> = {
    US: "🇺🇸",
    HK: "🇭🇰",
    CN: "🇨🇳",
    JP: "🇯🇵",
    KR: "🇰🇷",
    SG: "🇸🇬",
    UK: "🇬🇧",
    DE: "🇩🇪",
    FR: "🇫🇷",
    AU: "🇦🇺",
    CA: "🇨🇦",
    IN: "🇮🇳",
    TW: "🇹🇼",
    BR: "🇧🇷",
  };
  const label = libraryMarkets[market] || market;
  const color =
    badge && site.marketBadgesVisible
      ? {
          backgroundColor: badge.bg,
          color: badge.fg,
          borderRadius: 4,
          paddingInline: 5,
          whiteSpace: "nowrap" as const,
        }
      : undefined;
  if (!Object.hasOwn(libraryMarkets, market))
    return <span style={color}>{color ? badge!.label : market}</span>;
  return (
    <span className="financial-market-label">
      <span className="financial-market-icon" aria-hidden="true">
        {flags[market]}
      </span>
      <span>{label}</span>
      {site.marketBadgesVisible && badge && badge.label !== label && (
        <span
          style={{
            backgroundColor: badge.bg,
            color: badge.fg,
            borderRadius: 4,
            paddingInline: 5,
            whiteSpace: "nowrap",
          }}
        >
          {badge.label}
        </span>
      )}
    </span>
  );
}
