import type { CustomProvider } from "./fx-provider-editor";
export function providerInputError(value: CustomProvider | undefined): string {
  if (!value || "type" in value) return "";
  try {
    const url = new URL(value.url);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      url.pathname.includes("[redacted]")
    )
      return "请输入完整有效的汇率接口地址";
  } catch {
    return "请输入完整有效的汇率接口地址";
  }
  if (!value.approval.addresses.length)
    return "请展开自定义接口，填写服务器 IP 并确认目标";
  if (value.schedule && !value.schedule.timezone.trim())
    return "定时更新需要填写时区";
  return "";
}
