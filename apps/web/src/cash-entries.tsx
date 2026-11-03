import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { Dialog } from "./dialog";
import { SelectMenu } from "./select-menu";
import { CashEntryTable } from "./cash-entry-table";
import {
  entriesPath,
  cashReceiptPath,
  type CashReceiptLocator,
  type CashEntries,
} from "./cash-flow-state";
export function CashHistory({
  accountId,
  currencies,
  revision,
  generation,
  onRefresh,
  onDenied,
}: {
  accountId: string;
  currencies: string[];
  revision: number;
  generation: string;
  onRefresh: () => void;
  onDenied: (reason: unknown) => void;
}) {
  const [currency, setCurrency] = useState(""),
    [page, setPage] = useState({ key: "", offset: 0 }),
    [value, setValue] = useState<CashEntries | null>(null),
    [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Record<string, unknown> | null>(null);
  const key = JSON.stringify([accountId, currency, revision, generation]),
    offset = page.key === key ? page.offset : 0;
  const receiptReads = useRef(0);
  const epoch = useRef(0),
    denied = useRef(onDenied);
  denied.current = onDenied;
  useEffect(() => {
    const current = ++epoch.current,
      controller = new AbortController();
    let live = true;
    const hide = () => {
      if (document.hidden) {
        ++epoch.current;
        controller.abort();
        setValue(null);
        setReceipt(null);
      }
    };
    document.addEventListener("visibilitychange", hide);
    setValue(null);
    setReceipt(null);
    setError("");
    if (!document.hidden)
      void api<CashEntries>(
        entriesPath(accountId, currency, offset, revision),
        { signal: controller.signal },
      )
        .then((result) => {
          if (live && epoch.current === current && !document.hidden) {
            if (
              result.accountId !== accountId ||
              result.revision !== revision ||
              result.coverageScope !== "platform_registered_entries_only"
            )
              throw Error("现金流水范围已变化");
            setValue(result);
          }
        })
        .catch((reason) => {
          if (live && epoch.current === current && !controller.signal.aborted) {
            setValue(null);
            if (
              reason instanceof ApiError &&
              [401, 403].includes(reason.status)
            )
              denied.current(reason);
            setError(
              reason instanceof ApiError && reason.status === 409
                ? "现金流水已变化，请刷新账户"
                : reason instanceof Error
                  ? reason.message
                  : "现金流水读取失败",
            );
          }
        });
    return () => {
      live = false;
      ++epoch.current;
      controller.abort();
      document.removeEventListener("visibilitychange", hide);
      setValue(null);
      setReceipt(null);
    };
  }, [accountId, currency, offset, revision, generation]);
  async function readReceipt(locator: CashReceiptLocator) {
    const current = epoch.current,
      read = ++receiptReads.current;
    setError("");
    setReceipt(null);
    try {
      const result = await api<Record<string, unknown>>(
        cashReceiptPath(locator),
      );
      if (result.requestId !== locator.requestId)
        throw Error("回执与原请求不匹配");
      if (
        current === epoch.current &&
        read === receiptReads.current &&
        !document.hidden
      )
        setReceipt(result);
    } catch (reason) {
      if (current === epoch.current && read === receiptReads.current) {
        setError(reason instanceof Error ? reason.message : "原回执读取失败");
        if (reason instanceof ApiError && [401, 403].includes(reason.status))
          denied.current(reason);
      }
    }
  }
  return (
    <section className="cash-history">
      {receipt && (
        <Dialog
          title="原请求回执"
          onClose={() => {
            ++receiptReads.current;
            setReceipt(null);
          }}
        >
          <dl className="portfolio-proof">
            {Object.entries({
              requestId: "原请求",
              state: "状态",
              currency: "币种",
              delta: "登记变动",
              balanceAfter: "当时账户余额",
              ownerCashAfter: "当时同类现金合计",
              financialApplied: "金融入账",
            })
              .filter(([key]) => key in receipt)
              .map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>
                    {receipt[key] === null
                      ? "未知"
                      : receipt[key] === true
                        ? "已记账"
                        : receipt[key] === false
                          ? "未记账"
                          : receipt[key] === "completed"
                            ? "已完成"
                            : receipt[key] === "failed"
                              ? "失败"
                              : String(receipt[key])}
                  </dd>
                </div>
              ))}
          </dl>
        </Dialog>
      )}

      <div className="portfolio-actions">
        <h2>登记流水</h2>
        <SelectMenu
          label="流水币种"
          value={currency}
          options={[
            { value: "", label: "全部原币" },
            ...currencies.map((value) => ({ value, label: value })),
          ]}
          onChange={setCurrency}
        />
        <button className="button" onClick={onRefresh}>
          刷新账户
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {value ? (
        <>
          <CashEntryTable
            value={value}
            onReceipt={(locator) => void readReceipt(locator)}
          />
          <div className="portfolio-actions">
            <span>{value.total} 条</span>
            <button
              className="button"
              disabled={!offset}
              onClick={() => setPage({ key, offset: Math.max(0, offset - 25) })}
            >
              上一页
            </button>
            <button
              className="button"
              disabled={value.nextOffset === null}
              onClick={() => {
                if (value.nextOffset !== null)
                  setPage({ key, offset: value.nextOffset });
              }}
            >
              下一页
            </button>
          </div>
        </>
      ) : !error ? (
        <p role="status">正在读取流水…</p>
      ) : null}
    </section>
  );
}
