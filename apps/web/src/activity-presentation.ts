export type ActivityEntry = {
  id: string;
  event: string;
  detail: string;
  createdAt: string;
  userName: string;
};
const labels: Record<string, string> = {
  "broker.create": "创建券商账户",
  "cards.custom.created": "创建自建卡片",
  "cards.source.imported": "登记卡面目录原件",
  "celebs.create": "创建公开持仓资料",
  "celebs.reorder": "调整公开持仓顺序",
  "celebs.update": "更新公开持仓资料",
  "fees.plan.confirm": "保存个人费率",
  "fire-planning.saved": "保存 FIRE 规划",
  "fund.source.create": "登记资金来源",
  "watch-groups.create": "创建自选分组",
  "auth.login.success": "登录成功",
  "auth.login.failed": "登录失败",
  "auth.login.rate_limited": "登录过于频繁",
  "auth.register.success": "注册账号",
  "auth.logout": "退出登录",
  password_change: "修改密码",
  password_change_rejected: "修改密码被拒绝",
  profile_update: "更新资料",
  profile_email_rejected: "邮箱修改被拒绝",
  file_upload: "上传文件",
  data_export: "导出数据",
  data_import: "导入数据",
  data_import_preview: "预览导入",
  data_import_blocked: "导入被阻止",
  data_import_rejected: "导入被拒绝",
  records_clear: "清空持仓",
  records_clear_rejected: "清空持仓被拒绝",
  account_delete: "注销账号",
  account_delete_rejected: "注销被拒绝",
  "session.created": "创建登录会话",
  "session.revoked": "撤销登录会话",
  "user.created": "创建账号",
  "account.updated": "更新账号",
  "account.preferences.updated": "更新界面偏好",
  "account.password.changed": "修改账号密码",
  "account.password.proof.issued": "核验账号密码",
  "account.operation.closed": "结束账号操作核对",
  "account.closure.prepared": "准备注销账号",
  "account.closure.request_closed": "结束注销请求核对",
  "client.saved": "保存客户端配置",
  "client.grant.revoked": "撤销客户端授权",
  "backup.created": "创建备份",
  "backup.restored": "恢复备份",
  "deployment.requested": "请求更新容器",
  "deployment.build_requested": "请求构建版本",
  "deployment.config_saved": "保存发布配置",
  "cash.recorded": "登记现金变更",
  "cash.request.closed": "结束现金请求核对",
  "broker.position.transfer": "登记持仓转移",
  "broker.statement.preview": "预览券商报表",
  "broker.statement.import": "导入券商报表",
  "api.document.saved": "保存接口文档",
  "asset-library.access": "更新素材访问权限",
  "asset-catalog.source.imported": "登记素材来源",
  "cards.wallet.financial_recorded": "登记卡片金融记录",
  "cards.wallet.details_updated": "更新卡片资料",
  "cards.wallet.details_revealed": "查看卡片资料",
};
export const activityLabel = (event: string) => labels[event] || "平台事件";
export const activityLevel = (event: string) =>
  /rate_limited|warning/.test(event)
    ? "warning"
    : /failed|rejected|blocked|denied|error/.test(event)
      ? "error"
      : "info";
export function activityMoment(raw: string) {
  const time = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw) ? Date.parse(raw) : NaN;
  if (!Number.isFinite(time))
    return { day: "时间待核对", clock: "—", dateTime: undefined };
  const date = new Date(time);
  return {
    day: date.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }),
    clock: date.toLocaleTimeString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }),
    dateTime: raw,
  };
}
export function activitySelection(search: string, admin: boolean) {
  const params = new URLSearchParams(search),
    raw = params.get("scope");
  const view =
    raw === "summary" || raw === "imported"
      ? raw
      : admin && (raw === "system" || raw === "requests")
        ? raw
        : "user";
  const page = params.get("page") || "1";
  return {
    view,
    query: (params.get("q") || "").slice(0, 200),
    page: /^[1-9]\d{0,3}$/.test(page) ? Math.min(Number(page) - 1, 999) : 0,
  };
}
export function activitySearch(
  search: string,
  view: string,
  page: number,
  query: string,
) {
  const params = new URLSearchParams(search);
  if (view === "user") params.delete("scope");
  else params.set("scope", view);
  if (page > 0) params.set("page", String(page + 1));
  else params.delete("page");
  if (query) params.set("q", query);
  else params.delete("q");
  if (view !== "requests")
    for (const key of ["op", "level", "mod", "market"]) params.delete(key);
  return params.toString();
}
export function activityDetail(detail: string) {
  const value = detail.trim();
  if (/^[a-f0-9-]{32,64}$/i.test(value) || /^fg-[a-f0-9]+$/.test(value))
    return "";
  return value;
}
const reasons: Record<string, string> = {
  history_retained_unavailable: "保留行情暂不可用",
  licensed_unadjusted_daily_history_missing: "缺少获准的未复权日线",
  multiple_history_sources_require_explicit_selection: "需要确认唯一日线来源",
  two_observed_completed_daily_bars_missing: "缺少两根已结束的日线观察",
  daily_fact_identity_or_price_unknown: "日线身份或价格待核对",
  daily_source_original_unverified: "日线原件尚未核实",
  record_source_scope_incomplete: "持仓来源范围不完整",
  trade_replay_budget_exceeded: "成交历史超出本次核对范围",
  fee_replay_budget_exceeded: "费用历史超出本次核对范围",
  verified_opening_not_before_observation_window:
    "缺少观察期间之前的已核实期初",
  historical_trade_quantity_unknown: "历史成交数量未知",
  historical_quantity_invalid: "历史数量待核对",
  effective_trade_or_transfer_lineage_unverified: "成交或转移衔接尚未核实",
  security_units_or_multiplier_unknown: "证券单位或倍数未知",
  current_quantity_unknown: "当前数量未知",
  account_kind_unknown: "账户类型未知",
  official_report_is_not_complete_period_trade_history:
    "报表不能代替完整期间成交历史",
  history_source_authorization_changed: "行情来源授权已变化",
};
export const dailyReasonLabel = (reason: string) =>
  reasons[reason] || "另有证据待核对";
