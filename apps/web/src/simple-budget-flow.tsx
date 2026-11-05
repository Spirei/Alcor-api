import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  PiggyBank,
} from "lucide-react";
import { add, negate } from "./simple-app-model";
import { displayDecimal } from "./simple-app-view-model";

/** Budget connections describe declared plans; never imply an actual transfer. */
export function SimpleBudgetFlow({
  income,
  expense,
  currency = "",
  hidden = false,
}: {
  income: string | null;
  expense: string | null;
  currency?: string;
  hidden?: boolean;
}) {
  const surplus = add(income, negate(expense));
  const value = (amount: string | null) => (
    <strong>
      {hidden ? "••••" : amount === null ? "未知" : displayDecimal(amount)}
      <small>{currency}</small>
    </strong>
  );
  return (
    <figure className="simple-budget-flow" aria-label="本人预算收支流向">
      <div className="simple-flow-income">
        <span>
          <ArrowDownLeft size={18} />
          预估收入
        </span>
        {value(income)}
      </div>
      <ArrowRight
        className="simple-flow-connector"
        size={24}
        aria-hidden="true"
      />
      <div className="simple-flow-destinations">
        <div>
          <span>
            <ArrowUpRight size={18} />
            预估支出
          </span>
          {value(expense)}
        </div>
        <div>
          <span>
            <PiggyBank size={18} />
            预估结余
          </span>
          {value(surplus)}
        </div>
      </div>
      <figcaption>仅展示已登记的年度预算，不代表实际资金划转。</figcaption>
    </figure>
  );
}
