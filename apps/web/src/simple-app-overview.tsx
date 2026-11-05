import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  CloudSun,
  Eye,
  EyeOff,
  Landmark,
  Wallet,
} from "lucide-react";
import {
  budgetSummary,
  declaredInvestmentPnl,
  displayDecimal,
} from "./simple-app-view-model";
import {
  day,
  decimal,
  rows,
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
  const max = Math.max(...snapshots.map((row) => Number(decimal(row.assets))));
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
          <ChevronRight size={15} />
        </button>
      </div>
      <button className="simple-home-hero" onClick={() => go("family")}>
        <span className="simple-home-label">
          家庭总资产
          <ChevronRight size={18} />
        </span>
        <LedgerAmount value={t.assets} currency={currency} hidden={hidden} />
        <span className="simple-home-caption">
          {t.assets === null
            ? "完善金额、币种与登记汇率后查看"
            : "本人登记与估算 · 非券商已核余额"}
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
          <span className="simple-home-net">
            <span>
              净资产
              <LedgerAmount value={t.net} currency={currency} hidden={hidden} />
            </span>
            <span>
              已登记负债
              <LedgerAmount
                value={t.debt}
                currency={currency}
                hidden={hidden}
              />
            </span>
          </span>
        </span>
      </button>
      <div className="simple-home-links">
        <button className="simple-home-invest" onClick={() => go("invest")}>
          <span className="simple-home-label">
            <span>
              <Landmark size={19} />
              投资记账
            </span>
            <ChevronRight size={18} />
          </span>
          <LedgerAmount value={t.invest} currency={currency} hidden={hidden} />
          <span className="simple-home-caption">独立投资账户估值</span>
          <span className="simple-home-secondary">
            <span>登记累计收益</span>
            <LedgerAmount
              value={declaredInvestmentPnl(ledger, currency)}
              currency={currency}
              hidden={hidden}
            />
          </span>
        </button>
        <button className="simple-home-cashflow" onClick={() => go("cashflow")}>
          <span className="simple-home-label">
            <span>
              <Wallet size={19} />
              年度现金流
            </span>
            <ChevronRight size={18} />
          </span>
          <LedgerAmount
            value={budget.surplus}
            currency={budget.currency}
            hidden={hidden}
          />
          <span className="simple-home-caption">预估年度结余 · 预算规划</span>
          <span className="simple-budget-pair">
            <span>
              <ArrowDownLeft size={16} />
              收入
              <LedgerAmount
                value={budget.income}
                currency={budget.currency}
                hidden={hidden}
              />
            </span>
            <span>
              <ArrowUpRight size={16} />
              支出
              <LedgerAmount
                value={budget.expense}
                currency={budget.currency}
                hidden={hidden}
              />
            </span>
          </span>
        </button>
      </div>
      <details className="simple-basis">
        <summary>估算范围与精度</summary>
        <p>
          按本人登记汇率折算；缺金额、币种或正汇率保持未知。非终止除法按 18
          位有效数字四舍五入，原金额与汇率不改。不自动补历史、不从当前估值合成收益率。
        </p>
      </details>
    </div>
  );
}
