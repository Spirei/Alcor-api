const timestamp = (raw: string | null | undefined) => {
  if (!raw || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) return null;
  const value = Date.parse(raw);
  return Number.isFinite(value) ? value : null;
};
const absolute = (value: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);

export function feedDateTime(raw: string | null | undefined) {
  const value = timestamp(raw);
  return value === null ? "时间未知" : absolute(value);
}

/** Publication and collection are distinct; absent publication must not borrow collection time. */
export function feedTimestamp(
  published: string | null,
  created: string,
  now = Date.now(),
) {
  const value = timestamp(published);
  const collected = timestamp(created);
  if (value === null)
    return {
      text: "发布时间未知",
      title:
        collected === null ? "收录时间未知" : `收录于 ${absolute(collected)}`,
      dateTime: undefined,
    };
  const age = Math.floor((now - value) / 1000);
  const text =
    !Number.isFinite(age) || age < -60
      ? absolute(value)
      : age < 60
        ? "刚刚"
        : age < 3600
          ? `${Math.floor(age / 60)}分钟前`
          : age < 86400
            ? `${Math.floor(age / 3600)}小时前`
            : age < 7 * 86400
              ? `${Math.floor(age / 86400)}天前`
              : absolute(value);
  return { text, title: absolute(value), dateTime: published! };
}
