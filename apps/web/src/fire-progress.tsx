import { useId } from "react";
import { PrivateAmount, useFinancialDisplay } from "./financial-display";

export function FireProgress({
  progress,
  current,
  currency,
}: {
  progress: unknown;
  current: string;
  currency: string;
}) {
  const { visible } = useFinancialDisplay();
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const raw =
    typeof progress === "number"
      ? String(progress)
      : typeof progress === "string"
        ? progress.trim()
        : "";
  const value =
    raw &&
    raw.length <= 64 &&
    /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) &&
    Number.isFinite(Number(raw))
      ? Number(raw)
      : null;
  const height =
    visible && value !== null
      ? 184 - Math.min(100, Math.max(0, value)) * 1.68
      : 200;
  return (
    <section className="fire-progress-hero" aria-label="年度手填规划进度">
      <div className="fire-progress-orb" data-known={value !== null}>
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <defs>
            <clipPath id={`fire-clip-${id}`}>
              <circle cx="100" cy="100" r="84" />
            </clipPath>
            <linearGradient id={`fire-water-${id}`} x2="0" y2="1">
              <stop stopColor="#32d8db" />
              <stop offset="1" stopColor="#3975e8" />
            </linearGradient>
            <radialGradient id={`fire-glass-${id}`} cx=".35" cy=".2" r=".9">
              <stop stopColor="#ffffff44" />
              <stop offset="1" stopColor="#8eb6cd08" />
            </radialGradient>
          </defs>
          <circle
            cx="100"
            cy="100"
            r="84"
            fill={`url(#fire-glass-${id})`}
            stroke="currentColor"
            strokeOpacity=".12"
          />
          {visible && value !== null && (
            <g clipPath={`url(#fire-clip-${id})`}>
              <path
                className="fire-orb-wave"
                d={`M-200 ${height} Q-150 ${height - 7} -100 ${height} T0 ${height} T100 ${height} T200 ${height} T300 ${height} T400 ${height} V220 H-200Z`}
                fill={`url(#fire-water-${id})`}
                opacity=".82"
              />
              <path
                className="fire-orb-wave-back"
                d={`M-200 ${height + 3} Q-150 ${height + 10} -100 ${height + 3} T0 ${height + 3} T100 ${height + 3} T200 ${height + 3} T300 ${height + 3} T400 ${height + 3}`}
                fill="none"
                stroke="#ffffff77"
              />
            </g>
          )}
          <path
            d="M45 64 A65 65 0 0 1 103 35"
            fill="none"
            stroke="#ffffff88"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
        <div className="fire-progress-label">
          <small>{currency || "币种未知"} · 当前手填资产</small>
          <strong className="fire-orb-amount">
            <PrivateAmount>
              <span
                title={current || undefined}
                aria-label={current || undefined}
              >
                {current.length <= 14
                  ? current || "—"
                  : /^[+-]?\d{1,10}\.\d+$/.test(current)
                    ? current.split(".")[0] +
                      "." +
                      current.split(".")[1].slice(0, 2) +
                      "…"
                    : current.slice(0, 10) + "…"}
              </span>
            </PrivateAmount>
          </strong>
          <span className="fire-orb-percent">
            <PrivateAmount>{value === null ? "—" : `${raw}%`}</PrivateAmount>
          </span>
          <span>{value === null ? "进度待填写" : "手填年度记录"}</span>
        </div>
      </div>
    </section>
  );
}
