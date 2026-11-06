import { useState } from "react";
import { Maximize2 } from "lucide-react";
import { Dialog } from "./dialog";
import { displayDecimal, displayRatio } from "./simple-app-view-model";
import { ToggleSwitch } from "./workspace-forms";
import { LedgerAmount } from "./simple-app-overview";
import {
  add,
  categories,
  day,
  decimal,
  labels,
  multiply,
  negate,
  ratio,
  rows,
  text,
  totals,
  type Page,
  type Row,
} from "./simple-app-model";

export function SimpleFamilyOverview({
  ledger,
  member,
  patch,
  go,
}: {
  ledger: Row;
  member: string;
  patch: (ledger: Row) => void;
  go?: (page: Page, context?: Row) => void;
}) {
  const currency = text(ledger.displayCur),
    value = totals(ledger, currency, member),
    hidden = ledger.hide === true;
  const [expanded, setExpanded] = useState(false);
  const debtRatio =
    value.assets && !value.assets.startsWith("-")
      ? multiply(ratio(negate(value.debt), value.assets), "100")
      : null;
  const snapshots = rows(ledger.snaps)
      .filter(
        (row) =>
          (member ? text(row.owner) === member : !row.owner) &&
          text(row.currency) === currency &&
          day(text(row.at)) &&
          text(row.at) <= new Date().toLocaleDateString("en-CA"),
      )
      .sort((a, b) => text(a.at).localeCompare(text(b.at)))
      .slice(-3),
    last = snapshots.at(-1);
  const changes = [
    {
      name: "资产",
      value: last ? add(value.assets, negate(decimal(last.assets))) : null,
    },
    {
      name: "负债",
      value: last ? add(value.debt, negate(decimal(last.debt))) : null,
    },
  ];
  const bars = snapshots.filter(
      (row) =>
        decimal(row.assets) !== null && !decimal(row.assets)!.startsWith("-"),
    ),
    maximum = Math.max(...bars.map((row) => Number(decimal(row.assets))));
  const eligible =
    !hidden &&
    value.assets !== null &&
    value.assets !== "0" &&
    !value.assets.startsWith("-") &&
    value.net !== null &&
    !value.net.startsWith("-") &&
    value.debt !== null &&
    (value.debt === "0" || value.debt.startsWith("-"));
  const debtHeight = eligible
    ? Number(ratio(negate(value.debt), value.assets)) * 180
    : 0;
  let offset = 0;
  const segments = categories
    .filter(
      (cat) =>
        cat !== "debt" && !(cat === "fixed" && ledger.excludeFixed === true),
    )
    .map((cat, i) => {
      const amount = value[cat],
        fraction =
          eligible && amount !== null && !amount.startsWith("-")
            ? Number(ratio(amount, value.assets))
            : null,
        start = offset;
      if (fraction !== null) offset += fraction * 180;
      return {
        cat,
        amount,
        fraction,
        start,
        color: ["#dba47f", "#b8a171", "#87aa8d", "#9b93c9"][i],
      };
    });
  const composition = (
    <>
      {eligible &&
      Number.isFinite(debtHeight) &&
      debtHeight >= 0 &&
      debtHeight <= 180 &&
      segments.every((part) => part.fraction !== null) ? (
        <svg
          className="simple-family-sankey"
          viewBox="0 0 620 270"
          role="img"
          aria-label="已登记净资产、负债与各类资产组成"
        >
          <text x="68" y="24">
            负债
          </text>
          <text x="270" y="24">
            总资产
          </text>
          {debtHeight > 0 && (
            <path
              d={`M70 44H150C210 44 210 44 270 44V${44 + debtHeight}C210 ${44 + debtHeight} 210 ${44 + debtHeight} 150 ${44 + debtHeight}H70Z`}
              fill="#c8c8c8"
            />
          )}
          <path
            d={`M70 ${44 + debtHeight}H150C210 ${44 + debtHeight} 210 ${44 + debtHeight} 270 ${44 + debtHeight}V224C210 224 210 224 150 224H70Z`}
            fill="#c8e9de"
          />
          <rect
            x="65"
            y={44 + debtHeight}
            width="6"
            height={180 - debtHeight}
            rx="2"
            fill="#2eb789"
          />
          <text
            x="84"
            y={Math.min(214, 60 + debtHeight + (180 - debtHeight) / 2)}
          >
            净资产
          </text>
          {segments
            .filter((part) => part.fraction! > 0)
            .map((part) => (
              <g key={part.cat}>
                <path
                  d={`M276 ${44 + part.start}C335 ${44 + part.start} 335 ${44 + part.start} 425 ${44 + part.start}V${44 + part.start + part.fraction! * 180}C335 ${44 + part.start + part.fraction! * 180} 335 ${44 + part.start + part.fraction! * 180} 276 ${44 + part.start + part.fraction! * 180}Z`}
                  fill={part.color}
                  opacity=".42"
                />
                <rect
                  x="425"
                  y={44 + part.start}
                  width="5"
                  height={part.fraction! * 180}
                  fill={part.color}
                />
                <text x="440" y={49 + part.start + part.fraction! * 90}>
                  {labels[part.cat]}
                </text>
              </g>
            ))}
          <rect x="270" y="44" width="6" height="180" fill="#aaa4ce" />
        </svg>
      ) : (
        <p className="simple-composition-empty">
          {hidden ? "金额已隐藏" : "资产信息完整后显示组成"}
        </p>
      )}
      <div className="simple-composition-values">
        {categories.map((cat, i) => (
          <div key={cat}>
            <span className="simple-composition-label">
              <i className={`category-${i}`} />
              {labels[cat]}
              {cat === "fixed" && ledger.excludeFixed === true
                ? " · 已排除"
                : ""}
            </span>
            <LedgerAmount
              value={value[cat]}
              currency={currency}
              hidden={hidden}
            />
          </div>
        ))}
      </div>
    </>
  );
  return (
    <div className="simple-family-overview">
      <section className="simple-family-hero">
        <div className="simple-home-label">
          <span>
            {member ? `${member}总资产` : "总资产"} ({currency || "币种未登记"})
          </span>
          <label>
            排除固定资产
            <ToggleSwitch
              label="统计时排除固定资产"
              checked={ledger.excludeFixed === true}
              onChange={(excludeFixed) => patch({ ...ledger, excludeFixed })}
            />
          </label>
        </div>
        <LedgerAmount
          value={value.assets}
          currency={currency}
          hidden={hidden}
        />
        {last && <p>{text(last.at).replaceAll("-", "/")} 更新</p>}
        <div className="simple-family-secondary">
          <span>
            净资产 <b>{hidden ? "••••" : displayDecimal(value.net)}</b>
          </span>
          <span>
            负债率{" "}
            <b>
              {hidden
                ? "••••"
                : debtRatio === null
                  ? "未知"
                  : displayRatio(debtRatio).replace(/^约 /, "") + "%"}
            </b>
          </span>
        </div>
        <div className="simple-family-comparison">
          <div className="simple-section-title">
            <span>
              {last
                ? `相比${text(last.at).slice(5).replace("-", "月")}日`
                : "最近资产观察"}
            </span>
            <button className="simple-ghost" onClick={() => go?.("calendar")}>
              资产月历 ›
            </button>
          </div>
          <div className="simple-family-change-body">
            <div className="simple-snapshot-mini">
              {bars.length &&
              !hidden &&
              maximum > 0 &&
              Number.isFinite(maximum) ? (
                bars.map((row, i) => (
                  <span className="simple-snapshot-column" key={i}>
                    <i
                      style={{
                        height:
                          Math.max(
                            2,
                            (Number(decimal(row.assets)) / maximum) * 60,
                          ) + "px",
                      }}
                    />
                    <small>{text(row.at).slice(5).replace("-", "/")}</small>
                  </span>
                ))
              ) : (
                <small>{hidden ? "金额已隐藏" : "尚无可绘制的资产快照"}</small>
              )}
            </div>
            <div className="simple-home-changes">
              {changes.map((change) => (
                <span key={change.name}>
                  {change.value === null
                    ? `暂无可比${change.name}观察`
                    : change.value === "0"
                      ? `${change.name}没有变化`
                      : `${change.name}${change.value.startsWith("-") ? "减少" : "增加"} ${hidden ? "••••" : displayDecimal(change.value.replace(/^-/, ""))} ${currency}`}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
      <section className="simple-composition">
        <div className="simple-section-title">
          <h4>资产组成</h4>
          <button
            className="icon-button"
            aria-label="展开资产组成"
            onClick={() => setExpanded(true)}
          >
            <Maximize2 size={16} />
          </button>
        </div>
        {composition}
      </section>
      {expanded && (
        <Dialog
          title="资产组成"
          className="simple-composition-dialog"
          onClose={() => setExpanded(false)}
        >
          <div className="simple-dialog-body">{composition}</div>
        </Dialog>
      )}
    </div>
  );
}
