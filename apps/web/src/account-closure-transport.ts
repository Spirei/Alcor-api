import { requestResponse } from "./api-response.ts";
import {
  closureObservation,
  type ClosurePending,
} from "./account-closure-state.ts";

async function publicRead(path: string, body: unknown, signal?: AbortSignal) {
  const result = await requestResponse("/api/account/closure/" + path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
    signal,
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await result.json();
  if (!result.ok)
    throw Error(
      typeof value?.error?.message === "string"
        ? value.error.message
        : "原注销请求暂无法核对，请保留原编号",
    );
  return value;
}
export async function observeClosure(
  pending: ClosurePending,
  close = false,
  signal?: AbortSignal,
) {
  const config = await publicRead("config", undefined, signal);
  if (
    config?.instance_id !== pending.instanceId ||
    config?.scope !== "account-closure-only"
  )
    throw Error("实例已变化，未发送原注销查询凭证");
  return closureObservation(
    await publicRead(
      pending.requestId + (close ? "/close" : "/receipt"),
      { receipt_token: pending.receiptToken },
      signal,
    ),
    pending,
  );
}
