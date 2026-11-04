import { dayLabel } from "./reference-state";
import type { Calendar } from "./reference";

export function TradingMonth({
  calendar,
  month,
}: {
  calendar: Calendar;
  month: string;
}) {
  const year = calendar.year,
    m = Number(month);
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100 ||
    !Number.isInteger(m) ||
    m < 1 ||
    m > 12
  )
    return null;
  const first = new Date(Date.UTC(year, m - 1, 1)),
    offset = (first.getUTCDay() + 6) % 7,
    length = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const observed = new Map(calendar.days.map((day) => [day.date, day]));
  return (
    <div className="trading-month" aria-label={`${year}/${m} 交易安排`}>
      <div className="trading-month-weekdays" aria-hidden="true">
        {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="trading-month-days">
        {Array.from({ length: offset }, (_, i) => (
          <div
            className="trading-month-blank"
            key={"blank" + i}
            aria-hidden="true"
          />
        ))}
        {Array.from({ length }, (_, i) => {
          const day = i + 1,
            date = `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
            row = observed.get(date),
            status = row?.status || "unknown";
          return (
            <div
              key={date}
              className="trading-month-day"
              data-status={status}
              aria-label={`${year}/${m}/${day} · ${dayLabel(status)}${row?.name ? " · " + row.name : ""}`}
            >
              <time dateTime={date}>{day}</time>
              <small>{dayLabel(status)}</small>
              {row?.name && <span title={row.name}>{row.name}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
