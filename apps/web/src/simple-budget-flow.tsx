import { add, negate, ratio } from "./simple-app-model";

/** Only complete, non-deficit declared budgets have proportional flow geometry. */
export function SimpleBudgetFlow({
  income,
  expense,
  hidden = false,
}: {
  income: string | null;
  expense: string | null;
  currency?: string;
  hidden?: boolean;
}) {
  const surplus = add(income, negate(expense)),
    fraction =
      income &&
      income !== "0" &&
      !income.startsWith("-") &&
      expense !== null &&
      !expense.startsWith("-") &&
      surplus !== null &&
      !surplus.startsWith("-")
        ? ratio(expense, income)
        : null,
    weight =
      fraction === null ? null : Math.max(0, Math.min(1, Number(fraction))),
    branch = weight === null ? null : weight * 120;
  return (
    <figure
      className="simple-budget-flow"
      aria-label="本人年度预算收支流向，非实际资金划转"
    >
      {!hidden && branch !== null && Number.isFinite(branch) && (
        <svg
          viewBox="0 0 640 210"
          role="img"
          aria-label="已登记年度收入分为支出与结余"
        >
          <path d="M80 50 H230 V170 H80Z" fill="#bce4ef" />
          {branch > 0 && (
            <path
              d={`M239 50 C350 50 390 30 540 30 L540 ${30 + branch} C390 ${30 + branch} 350 ${50 + branch} 239 ${50 + branch}Z`}
              fill="#f1cbb8"
            />
          )}
          {branch < 120 && (
            <path
              d={`M239 ${50 + branch} C350 ${50 + branch} 390 ${42 + branch} 540 ${42 + branch} L540 162 C390 162 350 170 239 170Z`}
              fill="#c5e5e2"
            />
          )}
          <rect x="71" y="50" width="9" height="120" rx="2" fill="#3dabcc" />
          <rect x="230" y="50" width="9" height="120" rx="2" fill="#3dabcc" />
          <text x="63" y="113" textAnchor="end">
            收入
          </text>
          <text x="234" y="39" textAnchor="middle">
            预估收入
          </text>
          {branch > 0 && (
            <rect
              x="540"
              y="30"
              width="9"
              height={branch}
              rx="2"
              fill="#de7e4e"
            />
          )}
          {branch < 120 && (
            <rect
              x="540"
              y={42 + branch}
              width="9"
              height={120 - branch}
              rx="2"
              fill="#79b3ad"
            />
          )}
          {branch > 0 && (
            <text x="558" y={34 + branch / 2}>
              预估支出
            </text>
          )}
          {branch < 120 && (
            <text x="558" y={46 + branch + (120 - branch) / 2}>
              年度结余
            </text>
          )}
        </svg>
      )}
      {(hidden || branch === null) && (
        <div className="simple-budget-flow-empty">
          {hidden ? "金额已隐藏" : "尚未完善收支预算"}
        </div>
      )}
    </figure>
  );
}
