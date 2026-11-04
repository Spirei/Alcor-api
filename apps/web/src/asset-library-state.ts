export function assetPageKey(
  type: string,
  market: string,
  query: string,
  page: number,
) {
  const params = new URLSearchParams({
    type,
    paged: "1",
    page: String(page),
    pageSize: "10",
    q: query,
  });
  if (type === "stock" && market) params.set("market", market);
  return params.toString();
}

/** The number of controls stays bounded even for very large catalogs. */
export function assetPageNumbers(
  page: number,
  total: number,
): (number | "…")[] {
  if (
    !Number.isSafeInteger(page) ||
    !Number.isSafeInteger(total) ||
    page < 1 ||
    page > total
  )
    return [];
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const points = [...new Set([1, page - 1, page, page + 1, total])]
    .filter((n) => n >= 1 && n <= total)
    .sort((a, b) => a - b);
  const result: (number | "…")[] = [];
  for (const n of points) {
    const prior = result[result.length - 1];
    if (typeof prior === "number" && n - prior > 1)
      result.push(n - prior === 2 ? prior + 1 : "…");
    result.push(n);
  }
  return result;
}
