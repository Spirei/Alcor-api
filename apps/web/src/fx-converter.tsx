import { useId, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  History,
  Pencil,
  PlugZap,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { convertObservedFx, type ObservedRates } from "./fx-converter-state";
import { currencyInfo, defaultFxOrder, formatFxAmount, formatFxCurrency, fxInput } from "./fx-display";
import { useAccountAppearance } from "./account-preference-context";
import { MaterialFlag, useMaterialFlags } from "./material-flag";
import { Dialog } from "./dialog";
import { PageHeader } from "./workspace-ui";
import "./fx-converter.css";

type Props = {
  rates:
    | (ObservedRates & {
        updatedAt?: number | null;
        observationDate?: string | null;
      })
    | null;
  onHistory?: () => void;
  onSettings?: () => void;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
  active?: boolean;
  input?: { from: string; amount: string };
  onInput?: (value: { from: string; amount: string }) => void;
};
export function FxConverter({
  rates,
  onHistory,
  onSettings,
  onRefresh,
  refreshDisabled,
  active = true,
  input,
  onInput,
}: Props) {
  const preferences = useAccountAppearance();
  const id = useId();
  const flags = useMaterialFlags(Object.values(currencyInfo).map(info => info.country), active);
  const [localOrder, setLocalOrder] = useState(defaultFxOrder),
    [localHidden, setLocalHidden] = useState<string[]>([]);
  const order = preferences?.settings.fxOrder ?? localOrder;
  const hidden = preferences?.settings.fxHidden ?? localHidden;
  const ready = !preferences || preferences.ready;
  const [localAmount, setLocalAmount] = useState("100"),
    [localFrom, setLocalFrom] = useState("USD");
  const amount = input?.amount ?? localAmount, from = input?.from ?? localFrom;
  function updateInput(from: string, amount: string) {
    if (onInput) onInput({from,amount});
    else { setLocalFrom(from); setLocalAmount(amount); }
  }
  const [focused, setFocused] = useState<string | null>(null),
    [panel, setPanel] = useState<"add" | "manage" | null>(null),
    [search, setSearch] = useState("");
  const dragged = useRef<string | null>(null);
  const visible = order.filter((c) => !hidden.includes(c));
  const invalidAmount = !!amount && amount !== "." && !convertObservedFx(amount, from, from, {base: from,rates:{},quoted:[]});
  const all = [
    ...new Set([
      ...Object.keys(currencyInfo),
      ...order,
      ...(rates?.quoted ?? []),
      ...(rates?.base ? [rates.base] : []),
    ]),
  ].filter((c) => /^[A-Z]{3}$/.test(c));
  function save(nextOrder: string[], nextHidden = hidden) {
    if (!ready) return;
    if (preferences)
      preferences.update({ fxOrder: nextOrder, fxHidden: nextHidden });
    else {
      setLocalOrder(nextOrder);
      setLocalHidden(nextHidden);
    }
  }
  function move(code: string, target: string) {
    if (code === target || !order.includes(code) || !order.includes(target))
      return;
    const next = order.filter((c) => c !== code);
    next.splice(order.indexOf(target), 0, code);
    save(next);
  }
  function hide(code: string) {
    if (visible.length < 2) return;
    if (code === from) {
      const next = visible.find(value => value !== code)!;
      const converted = rates ? convertObservedFx(amount, from, next, rates) : null;
      updateInput(next, converted?.value ?? "");
    }
    save(order, [...hidden, code]);
  }
  function add(code: string) {
    if (!order.includes(code) && order.length >= 64) return;
    save(
      order.includes(code) ? order : [...order, code],
      hidden.filter((c) => c !== code),
    );
    setPanel(null);
    setSearch("");
  }
  const tools = (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label="添加币种"
        title="添加币种"
        disabled={!ready || order.length >= 64 && !hidden.some(code => order.includes(code))}
        onClick={() => setPanel("add")}
      >
        <Plus size={17} />
      </button>
      {onHistory && (
        <button
          type="button"
          className="icon-button"
          aria-label="汇率刷新记录"
          title="汇率刷新记录"
          onClick={onHistory}
        >
          <History size={17} />
        </button>
      )}
      <button
        type="button"
        className="icon-button"
        aria-label="管理币种"
        title="管理币种"
        disabled={!ready}
        onClick={() => setPanel("manage")}
      >
        <Pencil size={16} />
      </button>
      {onSettings && (
        <button
          type="button"
          className="icon-button"
          aria-label="汇率接口设置"
          title="汇率接口设置"
          onClick={onSettings}
        >
          <PlugZap size={17} />
        </button>
      )}
    </>
  );
  return (
    <section className="fx-converter" aria-label="汇率换算">
      <PageHeader
        title="汇率换算"
        tools={tools}
        actions={
          onRefresh && (
            <button
              type="button"
              className="icon-button"
              aria-label="刷新报价"
              title="刷新报价"
              onClick={onRefresh}
              disabled={refreshDisabled}
            >
              <RefreshCw size={17} />
            </button>
          )
        }
      />
      <p className="fx-help">输入金额即可换算，拖动手柄排序。</p>
      {invalidAmount &&
        <p className="fx-input-error" id={`${id}-error`} role="alert">请输入有效的十进制金额</p>}
      <div className="fx-currency-grid">
        {visible.map((code) => {
          const info = currencyInfo[code];
          const converted = rates
            ? convertObservedFx(amount, from, code, rates)
            : code === from
              ? { value: amount, approximate: false }
              : null;
          const ratio = rates
            ? convertObservedFx("1", from, code, rates)
            : null;
          const value = code === from ? amount : (converted?.value ?? "");
          return (
            <div
              key={code}
              className={`fx-currency-row${code === from ? " is-base" : ""}`}
              onDragOver={(e) => {
                if (dragged.current) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragged.current) move(dragged.current, code);
                dragged.current = null;
              }}
            >
              <MaterialFlag country={info?.country} icons={flags} className="fx-flag" />
              <div className="fx-currency-content">
                <label htmlFor={`${id}-${code}`}>
                  <strong>{info?.name ?? code}</strong>
                  <span>{code}</span>
                </label>
                <div className="fx-amount">
                  <span aria-hidden="true">{code !== from && converted?.approximate ? "≈ " : ""}{info?.symbol ?? code}</span>
                  <input
                    id={`${id}-${code}`}
                    aria-label={`${code} 换算金额`}
                    inputMode="decimal"
                    autoComplete="off"
                    maxLength={44}
                    placeholder="暂无汇率"
                    aria-invalid={code === from && invalidAmount}
                    aria-describedby={code === from && invalidAmount ? `${id}-error` : undefined}
                    value={focused === code ? value : code === from ? formatFxAmount(value) : value ? formatFxCurrency(value, code) : ""}
                    onFocus={(e) => {
                      setFocused(code);
                      if (code !== from && converted) {
                        updateInput(code, converted.value);
                      }
                      const input = e.currentTarget;
                      requestAnimationFrame(() => { if (input.isConnected) input.select(); });
                    }}
                    onBlur={() => setFocused(null)}
                    onChange={(e) => {
                      updateInput(code, fxInput(e.target.value));
                    }}
                  />
                </div>
                <small>
                  {focused === code && code === from
                    ? "正在输入"
                    : code === from
                      ? "换算基准"
                      : ratio
                        ? `${ratio.approximate ? "≈ " : ""}1 ${from} = ${formatFxAmount(ratio.value)} ${code}`
                        : "暂无汇率"}
                </small>
              </div>
              <button
                className="fx-drag icon-button"
                type="button"
                draggable={ready}
                aria-label={`调整 ${code} 顺序`}
                title="拖动排序，或点击管理"
                disabled={!ready}
                onClick={() => setPanel("manage")}
                onDragStart={(e) => {
                  dragged.current = code;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", code);
                }}
                onDragEnd={() => {
                  dragged.current = null;
                }}
              >
                <GripVertical size={15} />
              </button>
            </div>
          );
        })}
      </div>
      <p className="fx-footer">
        以 1 {currencyInfo[from]?.name ?? from}（{from}）为基准换算
        <span>
          {rates?.updatedAt
            ? `最近同步：${new Date(rates.updatedAt).toLocaleString()}`
            : rates?.observationDate
              ? `报价日期：${rates.observationDate}`
              : "尚未取得报价"}
        </span>
        {rates?.quarantined && <span>恢复隔离中，暂不跨币换算</span>}
      </p>
      {panel && (
        <Dialog
          title={panel === "add" ? "添加币种" : "管理币种"}
          onClose={() => {
            setPanel(null);
            setSearch("");
          }}
          className="fx-manage-dialog"
        >
          <div className="dialog-content">
            {panel === "add" ? (
              <>
                <input
                  autoFocus
                  aria-label="搜索币种"
                  placeholder="搜索名称或代码"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="fx-currency-choices">
                  {all
                    .filter(
                      (c) =>
                        (!order.includes(c) || hidden.includes(c)) &&
                        `${c} ${currencyInfo[c]?.name ?? ""}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                    )
                    .map((c) => (
                      <button
                        type="button"
                        className="fx-currency-choice"
                        key={c}
                        onClick={() => add(c)}
                      >
                        <MaterialFlag country={currencyInfo[c]?.country} icons={flags} className="fx-flag" />
                        <span>
                          {currencyInfo[c]?.name ?? c}
                          <small>{c}</small>
                        </span>
                        <Plus size={16} />
                      </button>
                    ))}
                </div>
              </>
            ) : (
              <>
                <p className="fx-help">
                  调整显示顺序，隐藏的币种可随时重新添加。
                </p>
                <div className="fx-order-list">
                  {visible.map((c, index) => (
                    <div key={c}>
                      <MaterialFlag country={currencyInfo[c]?.country} icons={flags} className="fx-flag" />
                      <strong>
                        {currencyInfo[c]?.name ?? c} <small>{c}</small>
                      </strong>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`上移 ${c}`}
                        disabled={index === 0}
                        onClick={() => move(c, visible[index - 1])}
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`下移 ${c}`}
                        disabled={index === visible.length - 1}
                        onClick={() => move(c, visible[index + 1])}
                      >
                        <ArrowDown size={16} />
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`隐藏 ${c}`}
                        disabled={visible.length < 2}
                        onClick={() => hide(c)}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </Dialog>
      )}
    </section>
  );
}
