type Store = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>;
export type WalletOperation = {
  requestId: string;
  kind: "financial" | "details";
};
const prefix = "alcor.card-wallet-request:";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function readWalletOperation(
  storage: Store,
  scope: string,
): WalletOperation | null {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix) && key !== prefix + scope)
      storage.removeItem(key);
  }
  const raw = storage.getItem(prefix + scope);
  if (raw === null) return null;
  const value = JSON.parse(raw) as WalletOperation;
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).length !== 2 ||
    typeof value.requestId !== "string" ||
    !uuid.test(value.requestId) ||
    !["financial", "details"].includes(value.kind)
  )
    throw new Error("原卡包金额请求编号无法读取");
  return { requestId: value.requestId, kind: value.kind };
}
export function retainWalletOperation(
  storage: Store,
  scope: string,
  value: WalletOperation,
) {
  const current = readWalletOperation(storage, scope);
  if (
    current &&
    (current.requestId !== value.requestId || current.kind !== value.kind)
  )
    throw new Error("请先核对原卡包金额请求");
  storage.setItem(
    prefix + scope,
    JSON.stringify({ requestId: value.requestId, kind: value.kind }),
  );
}
export function releaseWalletOperation(
  storage: Store,
  scope: string,
  id: string,
) {
  if (readWalletOperation(storage, scope)?.requestId !== id)
    throw new Error("原卡包金额请求已变化");
  storage.removeItem(prefix + scope);
}
export function cardDecimal(value: string | null | undefined) {
  if (value === null || value === undefined) return "未核对";
  const parsed = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!parsed) return "无法读取";
  const exponent = Number(parsed[4] || "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100)
    return "无法读取";
  const digits = parsed[2] + (parsed[3] || ""),
    point = parsed[2].length + exponent;
  const whole =
    point <= 0
      ? "0"
      : (
          digits.slice(0, point) +
          "0".repeat(Math.max(0, point - digits.length))
        ).replace(/^0+(?=\d)/, "");
  const fraction = (
    point < 0 ? "0".repeat(-point) + digits : digits.slice(point)
  ).replace(/0+$/, "");
  return (
    (parsed[1] === "-" && /[1-9]/.test(digits) ? "-" : "") +
    whole +
    (fraction ? "." + fraction : "")
  );
}

/** An adjustment's absolute target is not a cash movement or its net effect. */
export function walletEntryAmount(
  kind: string,
  amount: string | null,
  currency: string | null,
) {
  const label =
    kind === "adjust"
      ? "余额调整目标"
      : kind === "deposit"
        ? "存入"
        : kind === "withdraw"
          ? "取出"
          : "未核对的流水";
  return `${label} ${cardDecimal(amount)} ${currency || "币种未核对"}`;
}
