/** A transport timeout is not a server rejection; retain its original UUID. */
export function submissionDisposition(
  status: number | undefined,
): "rejected" | "lookup" {
  return status !== undefined &&
    [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(status)
    ? "rejected"
    : "lookup";
}

/** A missing receipt alone does not prove an in-flight request will never commit. */
export function mayReleaseMissingReceipt(
  submissionStatus: number | undefined,
): boolean {
  return submissionStatus === 409;
}

export function recordsPagePath(
  page: number,
  revision: number | null,
  brokerAccountId = "",
): string {
  if (page > 1 && revision === null) throw new Error("请先读取第一页");
  return `/portfolio/records?page=${page}&pageSize=25${page > 1 ? `&collectionRevision=${revision}` : ""}${brokerAccountId ? `&brokerAccountId=${encodeURIComponent(brokerAccountId)}` : ""}`;
}

export function accountLabel(
  id: string,
  brokers: readonly { id: string; name: string }[] | null,
): string {
  if (!id) return "未归属";
  return (
    brokers?.find((broker) => broker.id === id)?.name || `账户待核对 · ${id}`
  );
}

/** Financial confirmation uses the returned proof, never a stale account-directory label. */
export function previewAccountLabel(
  value: unknown,
  source: Record<string, unknown>,
): string {
  if (typeof value !== "string" || !value) return "未归属";
  const name =
    typeof source.group === "string" && source.group
      ? source.group
      : "账户待核对";
  return `${name} · ${value}`;
}
