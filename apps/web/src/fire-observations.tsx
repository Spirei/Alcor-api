import { useMemo, useState } from "react";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { calendarDays } from "./activity";
import { Dialog } from "./dialog";
import { PrivateAmount } from "./financial-display";
import { SelectMenu } from "./select-menu";
import { FormActions } from "./workspace-forms";
import { WorkspaceTabs } from "./workspace-ui";
import { fireCurrencies } from "./fire-state";
import {
  fireObservations,
  observationRange,
  type ObservationPeriod,
} from "./fire-observation-state";

export function FireObservations({
  history,
  year,
  ready,
  disabled,
  open,
  onOpenChange,
  amount,
  usd,
  currency,
  onAmount,
  onUsd,
  onCurrency,
  onSave,
}: {
  history: unknown[];
  year: number;
  ready: boolean;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  amount: string;
  usd: string;
  currency: string;
  onAmount: (value: string) => void;
  onUsd: (value: string) => void;
  onCurrency: (value: string) => void;
  onSave: () => void;
}) {
  const model = useMemo(() => fireObservations(history), [history]);
  const [period, setPeriod] = useState<ObservationPeriod>("day");
  const [selected, setSelected] = useState("");
  const [displayYear, setDisplayYear] = useState(year);
  const [page, setPage] = useState(1);
  const years = [
    ...new Set([
      year,
      ...model.records.map((row) => Number(row.date.slice(0, 4))),
    ]),
  ].sort((a, b) => b - a);
  const calendar = useMemo(
    () => calendarDays(`${displayYear}-01-01`, `${displayYear}-12-31`),
    [displayYear],
  );
  const daily = useMemo(() => {
    const map = new Map<string, number>();
    model.records.forEach((row) =>
      map.set(row.date, (map.get(row.date) ?? 0) + 1),
    );
    return map;
  }, [model]);
  const date = selected.startsWith(String(displayYear) + "-")
    ? selected
    : model.records
        .filter((row) => row.date.startsWith(String(displayYear) + "-"))
        .at(-1)?.date;
  const records = date ? observationRange(model.records, date, period) : [];
  const pages = Math.max(1, Math.ceil(records.length / 10));
  const shownPage = Math.min(page, pages);
  const visibleRecords = [...records]
    .reverse()
    .slice((shownPage - 1) * 10, shownPage * 10);
  const columns = {
    gridTemplateColumns: `repeat(${calendar.columns}, minmax(0, 1fr))`,
  };
  return (
    <section className="fire-observations" aria-label="手填资产观察">
      <header className="fire-section-heading">
        <div>
          <h2>资产记录热力图</h2>
          <p>仅记录手动填报的资产，空白日期表示未填报。</p>
        </div>
        <div className="fire-heading-actions">
          <SelectMenu
            label="观察年份"
            value={String(displayYear)}
            options={years.map((value) => ({
              value: String(value),
              label: `${value} 年`,
            }))}
            onChange={(value) => {
              setDisplayYear(Number(value));
              setSelected("");
              setPage(1);
            }}
          />
          <button
            className="button secondary"
            type="button"
            disabled={disabled}
            onClick={() => onOpenChange(true)}
          >
            <Plus size={15} aria-hidden="true" />
            记录观察
          </button>
        </div>
      </header>
      <div className="fire-observation-card">
        <div className="fire-observation-period">
          <WorkspaceTabs
            label="资产记录统计周期"
            value={period}
            items={[
              { value: "day", label: "每日" },
              { value: "week", label: "每周" },
              { value: "month", label: "每月" },
              { value: "total", label: "累计" },
            ]}
            onChange={(value) => {
              setPeriod(value);
              setPage(1);
            }}
          />
          <span>
            {
              model.records.filter((row) =>
                row.date.startsWith(String(displayYear) + "-"),
              ).length
            }{" "}
            次填报
          </span>
        </div>
        <div
          className="fire-calendar-scroll"
          tabIndex={0}
          aria-label="全年资产记录，可横向滚动"
        >
          <div className="fire-calendar">
            <div
              className="fire-calendar-months"
              style={columns}
              aria-hidden="true"
            >
              {calendar.dates
                .filter((_, i) => i % 7 === 0)
                .map((key, i, weeks) => (
                  <span key={key}>
                    {i === 0
                      ? "1月"
                      : key.slice(0, 7) !==
                            (i === 1
                              ? `${displayYear}-01`
                              : weeks[i - 1].slice(0, 7)) &&
                          key.startsWith(String(displayYear))
                        ? `${Number(key.slice(5, 7))}月`
                        : ""}
                  </span>
                ))}
            </div>
            <div className="fire-calendar-grid" style={columns}>
              {calendar.dates.map((key) =>
                !key.startsWith(String(displayYear) + "-") ? (
                  <span key={key} />
                ) : daily.has(key) ? (
                  <button
                    type="button"
                    key={key}
                    aria-label={`${key}，${daily.get(key)} 次填报`}
                    title={`${key} · ${daily.get(key)} 次填报`}
                    aria-pressed={date === key}
                    data-count={Math.min(4, daily.get(key)!)}
                    onClick={() => {
                      setSelected(key);
                      setPage(1);
                    }}
                  />
                ) : (
                  <span
                    className="fire-calendar-empty"
                    key={key}
                    title={`${key} · 未填报`}
                  />
                ),
              )}
            </div>
          </div>
        </div>
        {visibleRecords.length ? (
          <div className="fire-observation-selection">
            <p>
              {period === "day"
                ? date
                : period === "week"
                  ? `${date} 所在周`
                  : period === "month"
                    ? `${date!.slice(0, 7)}`
                    : `截至 ${date}`}{" "}
              · {records.length} 次填报
            </p>
            <div className="fire-observation-list">
              {visibleRecords.map((row, index) => (
                <div
                  className="fire-observation-row"
                  key={row.recordedAt + ":" + index}
                >
                  <time dateTime={row.recordedAt}>
                    {row.date.replaceAll("-", "/")}{" "}
                    <small>
                      {new Intl.DateTimeFormat("zh-CN", {
                        timeZone: "Asia/Shanghai",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(row.recordedAt))}
                    </small>
                  </time>
                  <strong>
                    <PrivateAmount>{row.amountBase || "—"}</PrivateAmount>{" "}
                    <small>{row.currency || "币种未知"}</small>
                  </strong>
                  {!(
                    row.currency === "USD" && row.amountBase === row.amountUsd
                  ) && (
                    <span>
                      <PrivateAmount>{row.amountUsd || "—"}</PrivateAmount>{" "}
                      <small>USD · 手填</small>
                    </span>
                  )}
                </div>
              ))}
            </div>
            {pages > 1 && (
              <nav
                className="fire-observation-pagination"
                aria-label="观察记录翻页"
              >
                <button
                  type="button"
                  className="icon-button"
                  aria-label="上一页观察记录"
                  disabled={shownPage <= 1}
                  onClick={() => setPage(shownPage - 1)}
                >
                  <ChevronLeft size={17} />
                </button>
                <span>
                  {shownPage} / {pages}
                </span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="下一页观察记录"
                  disabled={shownPage >= pages}
                  onClick={() => setPage(shownPage + 1)}
                >
                  <ChevronRight size={17} />
                </button>
              </nav>
            )}
          </div>
        ) : (
          <p className="fire-observation-empty">
            {ready
              ? "暂无资产观察，记录后将显示在对应日期。"
              : "正在读取资产观察…"}
          </p>
        )}
        {model.invalid > 0 && (
          <p role="status">{model.invalid} 条观察的时间待核对，未绘入日期。</p>
        )}
      </div>
      {open && (
        <Dialog title="记录资产观察" onClose={() => onOpenChange(false)}>
          <div className="dialog-content">
            <p className="fire-source">
              填写原币资产及独立的美元观察值，不自动套用汇率。
            </p>
            <form
              className="fire-observation-form"
              onSubmit={(event) => {
                event.preventDefault();
                onSave();
              }}
            >
              <label>
                观察币种
                <SelectMenu
                  label="观察币种"
                  value={currency}
                  options={[
                    { value: "", label: "选择币种" },
                    ...fireCurrencies.map((value) => ({ value, label: value })),
                  ]}
                  variant="field"
                  disabled={disabled}
                  onChange={onCurrency}
                />
              </label>
              <label>
                原币金额
                <input
                  inputMode="decimal"
                  value={amount}
                  disabled={disabled}
                  required
                  onChange={(event) => onAmount(event.target.value)}
                />
              </label>
              {currency !== "USD" && (
                <label>
                  美元金额（手填）
                  <input
                    inputMode="decimal"
                    value={usd}
                    disabled={disabled}
                    required
                    onChange={(event) => onUsd(event.target.value)}
                  />
                </label>
              )}
              <FormActions>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => onOpenChange(false)}
                >
                  取消
                </button>
                <button
                  className="button"
                  disabled={
                    disabled ||
                    !amount ||
                    !currency ||
                    (currency !== "USD" && !usd)
                  }
                >
                  保存观察
                </button>
              </FormActions>
            </form>
          </div>
        </Dialog>
      )}
    </section>
  );
}
