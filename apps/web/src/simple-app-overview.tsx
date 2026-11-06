import { ChevronRight, CloudSun, Eye, EyeOff } from "lucide-react";
import {
  budgetSummary,
  declaredInvestmentPnl,
  declaredInvestmentAnnual,
  displayDecimal,
  displayRatio,
} from "./simple-app-view-model";
import {
  day,
  add,
  annual,
  decimal,
  multiply,
  negate,
  object,
  ratio,
  rows,
  sum,
  text,
  totals,
  type Page,
  type Row,
} from "./simple-app-model";

export function LedgerAmount({
  value,
  currency,
  hidden = false,
}: {
  value: string | null;
  currency: string;
  hidden?: boolean;
}) {
  return (
    <span className={"simple-amount" + (value === null ? " unknown" : "")}>
      <span>{hidden ? "••••" : displayDecimal(value)}</span>
      <small>{currency || "币种未登记"}</small>
    </span>
  );
}
export function SimpleOverview({
  ledger,
  patch,
  go,
}: {
  ledger: Row;
  patch: (ledger: Row) => void;
  go: (page: Page, context?: Row) => void;
}) {
  const currency = text(ledger.displayCur),
    t = totals(ledger, currency),
    budget = budgetSummary(ledger),
    hidden = ledger.hide === true;
  const snapshots = rows(ledger.snaps)
    .filter(
      (row) =>
        !row.owner &&
        text(row.currency) === currency &&
        day(text(row.at)) &&
        text(row.at) <= new Date().toLocaleDateString("en-CA") &&
        decimal(row.assets) !== null &&
        !decimal(row.assets)!.startsWith("-"),
    )
    .sort((a, b) => text(a.at).localeCompare(text(b.at)))
    .slice(-3);
  const previous = snapshots.at(-1),
    assetChange = previous
      ? add(t.assets, negate(decimal(previous.assets)))
      : null,
    debtChange = previous ? add(t.debt, negate(decimal(previous.debt))) : null,
    investments = rows(ledger.invest).filter((row) => row.archived !== true),
    annualReturn = declaredInvestmentAnnual(ledger),
    savingsRate =
      budget.income && budget.income !== "0" && !budget.income.startsWith("-")
        ? multiply(ratio(budget.surplus, budget.income), "100")
        : null;
  const max = Math.max(...snapshots.map((row) => Number(decimal(row.assets))));
  const expenseItems = rows(object(ledger.cashflow).expenseItems),
    flowParts = ["stable", "flexible", "other", "unclassified"].map((kind) => ({
      kind,
      amount: sum(
        expenseItems
          .filter((row) =>
            kind === "unclassified"
              ? !["stable", "flexible", "other"].includes(text(row.type))
              : text(row.type) === kind,
          )
          .map(annual),
      ),
    })),
    flowKnown =
      budget.income !== null &&
      budget.income !== "0" &&
      !budget.income.startsWith("-") &&
      budget.surplus !== null &&
      !budget.surplus.startsWith("-") &&
      expenseItems.every(
        (row) => annual(row) !== null && !annual(row)!.startsWith("-"),
      );
  const change = (value: string | null, name: string) =>
    value === null
      ? `暂无可比${name}观察`
      : value === "0"
        ? `${name}没有变化`
        : `${name}${value.startsWith("-") ? "减少" : "增加"} ${hidden ? "••••" : displayDecimal(value.replace(/^-/, ""))} ${currency}`;
  return (
    <div className="simple-overview">
      <div className="simple-screen-heading">
        <div>
          <h2>家庭财务总览</h2>
          <button
            className="icon-button"
            aria-label={hidden ? "显示独立账本金额" : "隐藏独立账本金额"}
            onClick={() => patch({ ...ledger, hide: !hidden })}
          >
            {hidden ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <button className="simple-weather-link" onClick={() => go("weather")}>
          <CloudSun size={18} />
          财务晴雨表
        </button>
      </div>
      <button className="simple-home-hero" onClick={() => go("family")}>
        <span className="simple-home-label">
          家庭总资产
          {previous && (
            <small className="simple-home-last">
              {text(previous.at).slice(0, 10).replaceAll("-", "/")}
            </small>
          )}
        </span>
        <LedgerAmount value={t.assets} currency={currency} hidden={hidden} />
        <span className="simple-home-caption">
          {t.assets === null ? "点此开始记录" : "本人登记资产"}
        </span>
        <span className="simple-home-bottom">
          <span
            className="simple-snapshot-mini"
            aria-label="最近三次同币种资产快照"
          >
            {!snapshots.length || hidden ? (
              <span>{hidden ? "金额已隐藏" : "尚未登记资产快照"}</span>
            ) : (
              snapshots.map((row, i) => (
                <span key={i} className="simple-snapshot-column">
                  <i
                    style={{
                      height:
                        Number.isFinite(max) && max > 0
                          ? `${Math.max(2, (Number(decimal(row.assets)) / max) * 48)}px`
                          : "2px",
                    }}
                  />
                  <small>{text(row.at).slice(5).replace("-", "/")}</small>
                </span>
              ))
            )}
          </span>
          <span className="simple-home-changes">
            <span>{change(assetChange, "资产")}</span>
            <span>{change(debtChange, "负债")}</span>
          </span>
        </span>
      </button>
      <div className="simple-home-links">
        <button className="simple-home-invest" onClick={() => go("invest")}>
          <span className="simple-home-label">
            <span>投资记账</span>
            <span className="simple-chevron-round">
              <ChevronRight size={13} />
            </span>
          </span>
          <span className="simple-home-return">
            {hidden
              ? "••••"
              : annualReturn === null
                ? "暂无"
                : displayRatio(annualReturn).replace(/^约 /, "") + "%"}
            <small>年化</small>
          </span>
          <span className="simple-home-caption">
            {investments.length
              ? `${investments.length} 项投资资产`
              : "尚未记账"}
          </span>
          <span className="simple-invest-pair">
            <span>
              <small>累计收益</small>
              <LedgerAmount
                value={declaredInvestmentPnl(ledger, currency)}
                currency={currency}
                hidden={hidden}
              />
            </span>
            <span>
              <small>今年收益</small>
              <span className="simple-amount unknown">
                <span>{hidden ? "••••" : "暂无"}</span>
                <small>{currency || "币种未登记"}</small>
              </span>
            </span>
          </span>
        </button>
        <button className="simple-home-cashflow" onClick={() => go("cashflow")}>
          <span className="simple-home-label">
            <span>年度现金流</span>
          </span>
          <span className="simple-home-return">
            {hidden
              ? "••••"
              : savingsRate === null
                ? "待规划"
                : displayRatio(savingsRate).replace(/^约 /, "") + "%"}
            <small>{savingsRate === null ? "规划年度收支" : "储蓄率"}</small>
          </span>
          <span
            className="simple-cashflow-preview"
            role="img"
            aria-label={hidden ? "预算金额已隐藏" : "已登记年度支出与结余占比"}
          >
            {!hidden && flowKnown ? (
              <>
                {flowParts
                  .filter((part) => part.amount !== "0")
                  .map((part) => (
                    <i
                      key={part.kind}
                      className={"simple-cashflow-part " + part.kind}
                      style={{
                        width:
                          Number(ratio(part.amount, budget.income)) * 100 + "%",
                      }}
                    />
                  ))}
                <i
                  className="simple-cashflow-part surplus"
                  style={{
                    width:
                      Number(ratio(budget.surplus, budget.income)) * 100 + "%",
                  }}
                />
              </>
            ) : (
              <small>{hidden ? "金额已隐藏" : "尚未完善收支预算"}</small>
            )}
          </span>
        </button>
      </div>
    </div>
  );
}
