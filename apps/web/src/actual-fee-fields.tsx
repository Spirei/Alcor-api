import type { ActualFeeDraft, ActualFeeSnapshot } from "./actual-fee-state";
import type { NativeActualFeeSnapshot } from "./native-actual-fee-state";
export function ActualFeeFields({
  snapshot,
  selected,
  draft,
  disabled,
  onSelect,
  onEdit,
  onPreview,
}: {
  snapshot: ActualFeeSnapshot | NativeActualFeeSnapshot;
  selected: string;
  draft: ActualFeeDraft;
  disabled: boolean;
  onSelect: (value: string) => void;
  onEdit: (value: Partial<ActualFeeDraft>) => void;
  onPreview: () => void;
}) {
  const item = snapshot.items.find((value) => value.tradeId === selected);
  return (
    <section className="fees-actual">
      <h2>{snapshot.coverageScope === "completed_native_calculated_fee_registrations_only" ? "计算费用实付确认" : "实际费用确认"}</h2>
      {!snapshot.items.length ? (
        <p role="status">{snapshot.coverageScope === "completed_native_calculated_fee_registrations_only" ? "尚无可核实的计算费用成交" : "尚无已核对的原订单基线"}</p>
      ) : (
        <>
          <label>
            {snapshot.coverageScope === "completed_native_calculated_fee_registrations_only" ? "原完成登记" : "原订单基线"}
            <select
              value={selected}
              disabled={disabled}
              onChange={(event) => onSelect(event.target.value)}
            >
              <option value="">选择原订单</option>
              {snapshot.items.map((value) => (
                <option key={value.tradeId} value={value.tradeId}>
                  {"registrationRequestId" in value ? `${value.code} · ${value.side} · ${value.tradeId}` : value.originalOrderId}
                  {value.actualFeeKnown
                    ? ` · 已核实 ${value.actualFee ?? "未知"}`
                    : " · 实付费用未知"}
                </option>
              ))}
            </select>
          </label>
          {item && (
            <>
              <p>
                原登记费用 {item.registeredFees} · 已核实实付{" "}
                {item.actualFee ?? "未知"}
              </p>
              <details>
                <summary>原始依据</summary>
                <p>已有成交 {item.tradeId}</p>
                {"registrationRequestId" in item ? <>
                  <p>原登记回执 {item.registrationRequestId}</p>
                  <p>登记校验 {item.registrationSha256}</p>
                  <p>原结算币种 {item.currency}</p>
                </> : <>
                  <p>原订单 {item.originalOrderId}</p>
                  <p>来源清单 {item.manifestId}</p>
                  <p>清单校验 {item.manifestSha256}</p>
                  <a href={`/api/legacy-financial/manifests/${encodeURIComponent(item.manifestId)}/raw`}>查看原始快照</a>
                </>}
              </details>
              {!item.actualFeeKnown && (!("canConfirm" in item) || item.canConfirm) && (
                <div className="fees-plan-fields">
                  <label>
                    实付费用
                    <input
                      inputMode="decimal"
                      autoComplete="off"
                      value={draft.amount}
                      disabled={disabled}
                      onChange={(event) =>
                        onEdit({ amount: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    实际币种
                    <select
                      value={draft.currency}
                      disabled={disabled}
                      onChange={(event) =>
                        onEdit({ currency: event.target.value })
                      }
                    >
                      <option value="">选择币种</option>
                      <option value="USD">USD</option>
                      <option value="HKD">HKD</option>
                      <option value="CNY">CNY</option>
                    </select>
                  </label>
                  <label className="fees-actual-statement">
                    核对依据
                    <textarea
                      rows={3}
                      maxLength={4096}
                      autoComplete="off"
                      value={draft.statement}
                      disabled={disabled}
                      onChange={(event) =>
                        onEdit({ statement: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={draft.actualConfirmed}
                      disabled={disabled}
                      onChange={(event) =>
                        onEdit({ actualConfirmed: event.target.checked })
                      }
                    />
                    本人已核实实际支付的费用
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={draft.cashConfirmed}
                      disabled={disabled}
                      onChange={(event) =>
                        onEdit({ cashConfirmed: event.target.checked })
                      }
                    />
                    已核对原现金账户及币种
                  </label>
                  <button
                    className="button"
                    disabled={
                      disabled ||
                      !draft.amount.trim() ||
                      !draft.currency ||
                      !draft.statement.trim() ||
                      !draft.actualConfirmed ||
                      !draft.cashConfirmed
                    }
                    onClick={onPreview}
                  >
                    预览实际费用
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
