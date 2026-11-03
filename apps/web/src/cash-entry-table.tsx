import {
  cashKinds,
  type CashEntries,
  type CashReceiptLocator,
} from "./cash-flow-state";
export function CashEntryTable({
  value,
  onReceipt,
}: {
  value: CashEntries;
  onReceipt?: (locator: CashReceiptLocator) => void;
}) {
  return !value.items.length ? (
    <p>暂无登记流水</p>
  ) : (
    <div className="portfolio-table">
      <table>
        <thead>
          <tr>
            <th>发生时间</th>
            <th>变动</th>
            <th>原币登记金额</th>
            <th>依据</th>
          </tr>
        </thead>
        <tbody>
          {value.items.map((row) => (
            <tr key={row.id}>
              <td>
                <time dateTime={row.occurredAt}>{row.occurredAt}</time>
              </td>
              <td>{cashKinds[row.kind] ?? row.kind}</td>
              <td>
                {row.registeredAmount} {row.currency}
              </td>
              <td>
                {row.actualFeeKnown === false && <span>实付费用未知</span>}
                <details>
                  <summary>登记依据</summary>
                  {row.note && <p>{row.note}</p>}
                  <p>原请求 {row.requestId}</p>
                  <p>记录 {row.id}</p>
                  {row.sourceTradeId && <p>成交 {row.sourceTradeId}</p>}
                  <p>
                    {row.affectsOwnerCash ? "计入现金余额" : "仅调整资金归属"}
                  </p>
                </details>
                {row.receipt && onReceipt && (
                  <button
                    className="button"
                    onClick={() => onReceipt(row.receipt!)}
                  >
                    查看原回执
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
