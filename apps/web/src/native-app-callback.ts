export function authorizationCallback(
  value: string,
  redirect: string,
  state: string,
): string {
  const callback = new URL(value),
    expected = new URL(redirect);
  const params = callback.searchParams;
  if (
    callback.protocol !== expected.protocol ||
    callback.host !== expected.host ||
    callback.pathname !== expected.pathname ||
    callback.hash ||
    callback.username ||
    callback.password ||
    params.getAll("state").length !== 1 ||
    params.get("state") !== state ||
    Array.from(params.keys()).some(
      (key) => !["state", "code", "error"].includes(key),
    ) ||
    !(
      (params.getAll("code").length === 1 &&
        !!params.get("code") &&
        !params.has("error")) ||
      (params.getAll("error").length === 1 &&
        params.get("error") === "access_denied" &&
        !params.has("code"))
    )
  )
    throw new Error("回调地址不匹配");
  return callback.toString();
}
