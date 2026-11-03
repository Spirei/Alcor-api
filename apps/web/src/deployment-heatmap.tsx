import { useMemo, useState } from "react";
import {
  heatCells,
  selectedHeat,
  type HeatCell,
  type HeatView,
} from "./deployment-view";
// Continuous natural-week columns and group selection are ported from the original UpdateHeatmap.
export type DeploymentActivity = {
  repository: string;
  counts: Record<string, number> | null;
  complete: boolean;
  year: number;
  loaded: number | null;
};
export function DeploymentHeatmap({
  data,
  error,
}: {
  data: DeploymentActivity | null;
  error: string;
}) {
  const [view, setView] = useState<HeatView>("day"),
    [selected, setSelected] = useState<HeatCell | null>(null);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const year = data?.year || Number(today.slice(0, 4));
  const cells = useMemo(
    () => heatCells(year, data?.counts || null, !!data?.complete, today),
    [year, data, today],
  );
  const weeks = cells.length / 7,
    max = Math.max(1, ...cells.map((c) => c.count || 0));
  const months = cells.flatMap((c, index) =>
    c.date.endsWith("-01")
      ? [{ month: c.month, column: Math.floor(index / 7) + 1 }]
      : [],
  );
  const tone = (count: number | null) =>
    count === null
      ? "var(--deploy-unknown)"
      : count === 0
        ? "var(--deploy-zero)"
        : `rgba(16,185,129,${0.22 + 0.7 * Math.min(1, count / max)})`;
  const current = selected && cells.find((c) => c.key === selected.key);
  const total = current ? selectedHeat(cells, current, view) : null;
  return (
    <section
      className="deploy-card deploy-heatmap"
      aria-labelledby="heatmap-title"
    >
      <div className="deploy-section-head">
        <div>
          <h2 id="heatmap-title">更新热力图</h2>

        </div>
        <div className="deploy-tabs" role="tablist" aria-label="热力图统计周期">
          {(
            [
              ["day", "每日"],
              ["week", "每周"],
              ["month", "每月"],
              ["total", "累计"],
            ] as const
          ).map(([key, label]) => (
            <button
              role="tab"
              aria-selected={view === key}
              key={key}
              onClick={() => {
                setView(key);
                setSelected(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="deploy-heat-scroll">
        <div className="deploy-heat-continuous">
          <div
            className="deploy-months"
            style={{ gridTemplateColumns: `repeat(${weeks},minmax(0,1fr))` }}
          >
            {months.map((m) => (
              <span key={m.month} style={{ gridColumnStart: m.column }}>
                {m.month}月
              </span>
            ))}
          </div>
          <div
            className="deploy-heat-grid"
            style={{ gridTemplateColumns: `repeat(${weeks},minmax(0,1fr))` }}
          >
            {cells.map((cell) =>
              !cell.date ? (
                <span key={cell.key} />
              ) : (
                <button
                  key={cell.key}
                  disabled={cell.future || !data?.counts}
                  aria-label={`${cell.date}，${cell.future ? "尚未发生" : cell.count === null ? "未核实" : `${data?.complete ? "" : "至少"}${cell.count} 次提交`}`}
                  title={`${cell.date} · ${cell.count === null ? "未核实" : cell.count + " 次提交"}`}
                  onClick={() => setSelected(cell)}
                  style={{ backgroundColor: tone(cell.count) }}
                  className={
                    current &&
                    (view === "week"
                      ? current.week === cell.week
                      : view === "month"
                        ? current.month === cell.month
                        : current.key === cell.key)
                      ? "is-selected"
                      : ""
                  }
                />
              ),
            )}
          </div>
        </div>
      </div>
      {current && total && (
        <p role="status" className="deploy-selection">
          {view === "week"
            ? `${current.date} 所在周`
            : view === "month"
              ? `${current.month}月`
              : view === "total"
                ? `截至 ${current.date}`
                : current.date}{" "}
          ·{" "}
          {total.count === null
            ? "未核实"
            : `${total.partial || !data?.complete ? "至少 " : ""}${total.count} 次提交`}
        </p>
      )}
      <div className="deploy-heat-foot">
        <span>
          {error ||
            (!data?.counts
              ? "尚未取得提交记录"
              : !data.complete
                ? `已读取 ${data.loaded} 条，部分历史未覆盖`
                : "")}
        </span>
        <div>
          <span>少</span>
          {[0, 0.25, 0.5, 0.75, 1].map((n) => (
            <i key={n} style={{ backgroundColor: tone(n * max) }} />
          ))}
          <span>多</span>
        </div>
      </div>
    </section>
  );
}
