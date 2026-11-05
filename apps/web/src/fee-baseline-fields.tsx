import { useEffect, useState } from "react";
import {
  originalBlocker,
  type BaselineSource,
  type BaselineTarget,
  type BaselineDraft,
} from "./fee-baseline-state";
export function BaselineFeeFields({
  source,
  targets,
  draft,
  disabled,
  loading,
  onRead,
  onEdit,
  onPreview,
  onEstimate,
  expanded = false,
}: {
  source: BaselineSource | null;
  targets: BaselineTarget[];
  draft: BaselineDraft;
  disabled: boolean;
  loading: boolean;
  onRead: () => void;
  onEdit: (value: Partial<BaselineDraft>) => void;
  onPreview: (trigger?: HTMLButtonElement) => void;
  onEstimate?: (trigger?: HTMLButtonElement) => void;
  expanded?: boolean;
}) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [source?.manifestId]);
  const pages = Math.ceil((source?.orders.length ?? 0) / 200);
  const move = (next: number) => {
    setPage(next);
    onEdit({ originalId: "", targetId: "", registeredConfirmed: false });
  };
  const Surface = expanded ? "section" : "details";
  return (
    <Surface className="fees-baseline">
      {expanded ? <h2>核对原订单基线</h2> : <summary>核对原订单基线</summary>}
      <button
        className="button"
        onClick={onRead}
        disabled={disabled || loading}
      >
        {loading ? "正在读取" : "读取冻结来源"}
      </button>
      {source && (
        <>
          <details>
            <summary>原始范围</summary>
            <p>旧来源身份 {source.sourceOwner}</p>
            <p>来源时区 {source.timezone ?? "未知"}</p>
            <p>来源清单 {source.manifestId}</p>
            <p>清单校验 {source.manifestSha256}</p>
          </details>
          {!source.ordersKnown ? (
            <p role="status">原始成交表范围未知</p>
          ) : !source.orders.length ? (
            <p role="status">此冻结成交表没有记录</p>
          ) : (
            <div className="fees-plan-fields">
              <label>
                原始订单
                <select
                  value={draft.originalId}
                  disabled={disabled}
                  onChange={(event) =>
                    onEdit({
                      originalId: event.target.value,
                      targetId: "",
                      registeredConfirmed: false,
                    })
                  }
                >
                  <option value="">选择原订单</option>
                  {source.orders
                    .slice(page * 200, (page + 1) * 200)
                    .map((order, index) => (
                      <option
                        key={order.id ?? index}
                        value={order.id ?? ""}
                        disabled={!!originalBlocker(order)}
                      >
                        {order.code ?? "证券未知"} · {order.id ?? "标识未知"} ·{" "}
                        {order.occurredAt ?? "时间未知"} · 登记费用{" "}
                        {order.registeredFee ?? "未知"}
                        {originalBlocker(order)
                          ? ` · ${originalBlocker(order)}`
                          : ""}
                      </option>
                    ))}
                </select>
              </label>
              {pages > 1 && (
                <div>
                  <span>
                    {page + 1} / {pages} · 原订单 {source.orders.length} 条
                  </span>
                  <button
                    className="button"
                    disabled={disabled || page === 0}
                    onClick={() => move(page - 1)}
                  >
                    上一页
                  </button>
                  <button
                    className="button"
                    disabled={disabled || page + 1 >= pages}
                    onClick={() => move(page + 1)}
                  >
                    下一页
                  </button>
                </div>
              )}
              <label>
                已有本人成交
                <select
                  value={draft.targetId}
                  disabled={disabled}
                  onChange={(event) =>
                    onEdit({
                      targetId: event.target.value,
                      registeredConfirmed: false,
                    })
                  }
                >
                  <option value="">选择已有成交</option>
                  {targets.map((target) => (
                    <option
                      key={target.orderId}
                      value={target.orderId}
                      disabled={
                        target.actualFeeKnown !== false ||
                        target.status !== "filled" ||
                        target.recordRevision === null
                      }
                    >
                      {target.code ?? "证券未知"} · {target.orderId} · 数量{" "}
                      {target.qty ?? "未知"}
                      {target.actualFeeKnown === true ? " · 实付已核实" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.registeredConfirmed}
                  disabled={disabled}
                  onChange={(event) =>
                    onEdit({ registeredConfirmed: event.target.checked })
                  }
                />
                已核对原登记、现金期初与完整独立计费订单
              </label>
              <button
                className="button"
                disabled={
                  disabled ||
                  !draft.originalId ||
                  !draft.targetId ||
                  !draft.registeredConfirmed
                }
                onClick={(event) => onPreview(event.currentTarget)}
              >
                预览原登记基线
              </button>
              {onEstimate && (
                <details>
                  <summary>费率估算</summary>
                  <label>
                    证券类型
                    <select
                      value={draft.instrumentKind}
                      disabled={disabled}
                      onChange={(event) =>
                        onEdit({ instrumentKind: event.target.value })
                      }
                    >
                      <option value="unknown">选择证券类型</option>
                      <option value="us_domestic_equity">美股普通股票</option>
                      <option value="us_etf">美股 ETF</option>
                      <option value="cn_a_equity">A 股普通股票</option>
                    </select>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={draft.estimatedOnly}
                      disabled={disabled}
                      onChange={(event) =>
                        onEdit({ estimatedOnly: event.target.checked })
                      }
                    />
                    本次仅保存估算与原订单基线
                  </label>
                  <button
                    className="button"
                    disabled={
                      disabled ||
                      !draft.originalId ||
                      !draft.targetId ||
                      !draft.registeredConfirmed ||
                      !draft.estimatedOnly ||
                      draft.instrumentKind === "unknown"
                    }
                    onClick={(event) => onEstimate?.(event.currentTarget)}
                  >
                    预览费率估算
                  </button>
                </details>
              )}
            </div>
          )}
        </>
      )}
      {!source && !loading && (
        <p>
          冻结来源尚未读取 · <a href="/legacy-import">旧数据导入</a>
        </p>
      )}
    </Surface>
  );
}
