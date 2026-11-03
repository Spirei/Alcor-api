import { useId, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { RefreshCw } from "lucide-react";
import { useResource } from "./hooks";
import { calendarDays, requestLevel, requestStats } from "./activity";

export type RequestActivity = {
  start: string;
  end: string;
  observed_since: string;
  observed_at: string;
  timezone: string;
  observed_only: boolean;
  incomplete: boolean;
  days: { date: string; requests: number }[];
};

export function RequestHeatmap() {
  const result = useResource<RequestActivity>("/profile/requests");
  const calendarRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const [focused, setFocused] = useState<string | null>(null);
  const [tip, setTip] = useState<{
    date: string;
    left: number;
    top: number;
  } | null>(null);
  const data = result.data;
  const refresh = (
    <button
      className="icon-button"
      aria-label="刷新 API 请求统计"
      disabled={result.refreshing}
      onClick={result.reload}
    >
      <RefreshCw size={17} className={result.refreshing ? "spin" : ""} />
    </button>
  );
  if (!data)
    return (
      <section className="profile-activity">
        <div className="activity-heading">
          <h2>API 请求次数</h2>
          {refresh}
        </div>
        <div
          role={result.error ? "alert" : "status"}
          className={result.error ? "notice error" : "loading"}
        >
          {result.error || "正在读取请求统计…"}
        </div>
      </section>
    );
  const calendar = calendarDays(data.start, data.end);
  const { start, end } = data;
  const focusDate =
    focused && focused >= start && focused <= end ? focused : end;
  const stats = requestStats(data.days, data.end);
  const byDate = new Map(data.days.map((day) => [day.date, day.requests]));
  const columns = {
    gridTemplateColumns: `repeat(${calendar.columns}, minmax(0, 1fr))`,
  };
  const label = (date: string) =>
    `${date}，${byDate.has(date) ? `${byDate.get(date)!.toLocaleString("zh-CN")} 次 API 请求` : "未采集"}`;
  function show(date: string, button: HTMLButtonElement) {
    const area = calendarRef.current?.getBoundingClientRect();
    if (!area) return;
    const cell = button.getBoundingClientRect(),
      half = Math.min(112, area.width / 2);
    setTip({
      date,
      left: Math.max(
        half,
        Math.min(area.width - half, cell.left + cell.width / 2 - area.left),
      ),
      top: cell.top - area.top,
    });
  }
  function move(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    if (event.key === "Escape") {
      setTip(null);
      return;
    }
    const offset = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[
      event.key
    ];
    const next =
      event.key === "Home"
        ? start
        : event.key === "End"
          ? end
          : offset !== undefined
            ? calendar.dates[calendar.dates.indexOf(date) + offset]
            : undefined;
    if (!next) return;
    event.preventDefault();
    if (next >= start && next <= end) {
      setFocused(next);
      calendarRef.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${next}"]`)
        ?.focus();
    }
  }
  return (
    <>
      <div className="profile-stats" aria-label="API 请求统计">
        {[
          [stats.total, "累计请求", "次"],
          [stats.active, "活跃天数", "天"],
          [stats.longest, "最长连续", "天"],
          [stats.current, "当前连续", "天"],
        ].map(([value, title, unit]) => (
          <div key={title}>
            <strong>
              {Number(value).toLocaleString("zh-CN")}
              <small>{unit}</small>
            </strong>
            <span>{title}</span>
          </div>
        ))}
      </div>
      <section
        className="profile-activity request-activity"
        aria-label="API 请求热力图"
      >
        <div className="activity-heading">
          <div>
            <h2>API 请求次数</h2>
          </div>
          {refresh}
        </div>
        {result.error && (
          <div className="notice error" role="alert">
            {result.error}
          </div>
        )}
        <div className="heatmap-card">
          <div className="heatmap-calendar" ref={calendarRef}>
            <div className="heatmap-weekdays" aria-hidden="true">
              <span>一</span>
              <span>三</span>
              <span>五</span>
            </div>
            <div className="heatmap-inner">
              <div
                className="heatmap-months"
                style={columns}
                aria-hidden="true"
              >
                {calendar.dates
                  .filter((_, i) => i % 7 === 0)
                  .map((date, i, weeks) => (
                    <span key={date} data-month={Number(date.slice(5, 7))}>
                      {i === 0 ||
                      date.slice(0, 7) !==
                        (i === 1 ? data.start : weeks[i - 1]).slice(0, 7)
                        ? `${Number((i === 0 ? data.start : date).slice(5, 7))}月`
                        : ""}
                    </span>
                  ))}
              </div>
              <div
                className="heatmap-grid"
                style={columns}
                role="group"
                aria-label="每日 API 请求，使用方向键切换日期"
              >
                {calendar.dates.map((date) =>
                  date < data.start || date > data.end ? (
                    <span key={date} className="heatmap-cell outside" />
                  ) : (
                    <button
                      key={date}
                      type="button"
                      data-date={date}
                      tabIndex={date === focusDate ? 0 : -1}
                      aria-label={label(date)}
                      aria-describedby={
                        tip?.date === date ? tooltipId : undefined
                      }
                      className={`heatmap-cell level-${requestLevel(byDate.get(date))}`}
                      onPointerEnter={(event) =>
                        show(date, event.currentTarget)
                      }
                      onPointerLeave={(event) => {
                        if (document.activeElement !== event.currentTarget)
                          setTip(null);
                      }}
                      onFocus={(event) => {
                        setFocused(date);
                        show(date, event.currentTarget);
                      }}
                      onBlur={() => setTip(null)}
                      onKeyDown={(event) => move(event, date)}
                      onClick={(event) => show(date, event.currentTarget)}
                    />
                  ),
                )}
              </div>
            </div>
            {tip && (
              <div
                id={tooltipId}
                role="tooltip"
                className="heatmap-tooltip"
                style={{ left: tip.left, top: tip.top } as CSSProperties}
              >
                <span>{`${Number(tip.date.slice(5, 7))}月${Number(tip.date.slice(8))}日`}</span>
                <strong>
                  {byDate.has(tip.date)
                    ? `${byDate.get(tip.date)!.toLocaleString("zh-CN")} 次 API 请求`
                    : "未采集"}
                </strong>
              </div>
            )}
          </div>
          <div className="heatmap-footer">
            <span>
              {`${data.start.slice(0, 4)}年${Number(data.start.slice(5, 7))}月 — ${data.end.slice(0, 4)}年${Number(data.end.slice(5, 7))}月`}
            </span>
            <div className="heatmap-legend">
              <span>少</span>
              {[0, 1, 2, 3, 4].map((n) => (
                <i key={n} className={`heatmap-cell level-${n}`} />
              ))}
              <span>多</span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
