export type ActivityFilter = "all" | "login" | "tasks" | "profile";
export type Day = {
  date: string;
  login: number;
  tasks: number;
  profile: number;
};
const DAY = 86400000;
export const dayTime = (date: string) => Date.parse(date + "T00:00:00Z");
export const dateKey = (stamp: number) =>
  new Date(stamp).toISOString().slice(0, 10);
export function countDay(day: Day, filter: ActivityFilter) {
  return filter === "all" ? day.login + day.tasks + day.profile : day[filter];
}
export function activityStats(
  days: Day[],
  filter: ActivityFilter,
  end: string,
) {
  return dayStats(
    days.map((day) => ({ date: day.date, count: countDay(day, filter) })),
    end,
  );
}
function dayStats(days: { date: string; count: number }[], end: string) {
  const values = new Map(days.map((d) => [d.date, d.count]));
  let longest = 0,
    streak = 0,
    active = 0,
    total = 0,
    previous = 0;
  for (const day of days) {
    const count = day.count,
      stamp = dayTime(day.date);
    if (count) {
      active++;
      streak = stamp - previous === DAY ? streak + 1 : 1;
      longest = Math.max(longest, streak);
    } else streak = 0;
    previous = stamp;
    total += count;
  }
  // Yesterday may continue into today until today's first recorded activity.
  let cursor = dayTime(end),
    current = 0;
  if (!values.get(end)) cursor -= DAY;
  while (values.get(dateKey(cursor))) {
    current++;
    cursor -= DAY;
  }
  return { active, total, longest, current };
}
export function calendarDays(start: string, end: string) {
  const first = new Date(dayTime(start));
  const stamp = first.getTime() - ((first.getUTCDay() + 6) % 7) * DAY;
  const columns = Math.ceil((dayTime(end) - stamp + DAY) / DAY / 7);
  return {
    columns,
    dates: Array.from({ length: columns * 7 }, (_, i) =>
      dateKey(stamp + i * DAY),
    ),
  };
}

export function requestLevel(count: number | undefined) {
  return count === undefined
    ? "unknown"
    : count === 0
      ? 0
      : count <= 10
        ? 1
        : count <= 50
          ? 2
          : count <= 200
            ? 3
            : 4;
}
export function requestStats(
  days: { date: string; requests: number }[],
  end: string,
) {
  return dayStats(
    days.map((day) => ({ date: day.date, count: day.requests })),
    end,
  );
}
