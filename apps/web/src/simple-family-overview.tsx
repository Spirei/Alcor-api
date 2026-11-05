import { displayRatio } from "./simple-app-view-model";
import { ToggleSwitch } from "./workspace-forms";
import { LedgerAmount } from "./simple-app-overview";
import {
  categories,
  labels,
  multiply,
  negate,
  ratio,
  text,
  totals,
  type Row,
} from "./simple-app-model";

export function SimpleFamilyOverview({
  ledger,
  member,
  patch,
}: {
  ledger: Row;
  member: string;
  patch: (ledger: Row) => void;
}) {
  const currency = text(ledger.displayCur),
    value = totals(ledger, currency, member),
    hidden = ledger.hide === true;
  const debtRatio =
    value.assets && !value.assets.startsWith("-")
      ? multiply(ratio(negate(value.debt), value.assets), "100")
      : null;
  return (
    <div className="simple-family-overview">
      <section className="simple-family-hero">
        <div className="simple-home-label">
          <span>{member ? `${member}的总资产` : "家庭总资产"}</span>
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
        <p>本人登记与估算 · 非券商已核余额</p>
        <div className="simple-family-secondary">
          <span>
            净资产
            <LedgerAmount
              value={value.net}
              currency={currency}
              hidden={hidden}
            />
          </span>
          <span>
            负债率
            <strong>
              {hidden
                ? "••••"
                : debtRatio === null
                  ? "未知"
                  : displayRatio(debtRatio) + " %"}
            </strong>
          </span>
        </div>
      </section>
      <section className="simple-composition">
        <h4>资产组成</h4>
        <div>
          {categories.map((cat, i) => {
            const amount = value[cat],
              fraction =
                cat !== "debt" &&
                !(cat === "fixed" && ledger.excludeFixed === true) &&
                amount !== null &&
                !amount.startsWith("-") &&
                value.assets !== null &&
                !value.assets.startsWith("-")
                  ? ratio(amount, value.assets)
                  : null;
            return (
              <div key={cat}>
                <span className="simple-composition-label">
                  <i className={`category-${i}`} />
                  {labels[cat]}
                  {cat === "fixed" && ledger.excludeFixed === true
                    ? " · 已排除"
                    : ""}
                </span>
                <LedgerAmount
                  value={amount}
                  currency={currency}
                  hidden={hidden}
                />
                {fraction !== null && !hidden && (
                  <span className="simple-composition-meter" aria-hidden="true">
                    <i
                      className={`category-${i}`}
                      style={{
                        width: `${Math.max(0, Math.min(100, Number(fraction) * 100))}%`,
                      }}
                    />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
