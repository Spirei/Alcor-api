import { Eye, EyeOff } from "lucide-react";
import { createContext, useContext, useState, type ReactNode } from "react";
import { usePublicSite } from "./public-site";
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
  if (!site.marketBadgesVisible || !badge) return <span>{market}</span>;
  return (
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
  );
}
