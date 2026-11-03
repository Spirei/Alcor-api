/** Use the server-captured order when confirming a cancellation, including its identity. */
export function financialSummary(
  value: Record<string, unknown>,
): Record<string, unknown> {
  if (value.action !== "cancel") return value;
  if (
    !value.order ||
    typeof value.order !== "object" ||
    Array.isArray(value.order)
  )
    throw new Error("取消委托摘要缺失，请重新核对。");
  const order = value.order as Record<string, unknown>;
  if (
    typeof order.id !== "string" ||
    typeof order.accountId !== "string" ||
    typeof order.recordId !== "string"
  )
    throw new Error("取消委托来源缺失，请重新核对。");
  return { ...order, orderId: order.id };
}
