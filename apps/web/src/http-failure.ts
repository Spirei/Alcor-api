/** Keep framework errors and proxy failures distinct without rendering response HTML. */
export function httpFailureMessage(status: number, detail: unknown): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (status === 401) return "登录已过期，请重新登录";
  if (status === 403) return "当前操作未获授权，请核对权限";
  if (status === 429) return "请求过于频繁，请稍后重试";
  if (status === 502 || status === 503 || status === 504)
    return `服务暂时不可用（HTTP ${status}），请稍后重试`;
  return `请求失败（HTTP ${status}），请重试`;
}
