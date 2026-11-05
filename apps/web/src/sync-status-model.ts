export type ChangeSignals = {
  userId: string;
  instanceId: string;
  observedAt: string;
  domains: Record<
    string,
    {
      state: string;
      revision: number | null;
      lastChangedAt: string | null;
      commitSignalComplete: boolean;
    }
  >;
  unrepresentedSources: string[];
};
const labels: Record<string, string> = {
  profile: "个人资料",
  portfolio: "账户与资产",
  watch: "自选与分组",
  brokers: "券商账户",
  alerts: "提醒与通知",
  resources: "资源库",
  feed: "动态",
  settings: "个人配置",
  authorization: "设备与授权",
};
export function syncRows(value: ChangeSignals) {
  if (!value.domains || !Number.isFinite(Date.parse(value.observedAt)))
    throw Error("同步状态无效");
  return Object.entries(labels).map(([key, label]) => {
    const row = value.domains[key];
    const complete =
      row?.state === "observed" &&
      row.commitSignalComplete === true &&
      Number.isSafeInteger(row.revision) &&
      row.revision! >= 0;
    return {
      key,
      label,
      status: complete
        ? "已监测"
        : row?.state === "forbidden"
          ? "未授权"
          : row?.state === "partial"
            ? "部分覆盖"
            : "待接入",
      changedAt:
        row?.lastChangedAt && Number.isFinite(Date.parse(row.lastChangedAt))
          ? row.lastChangedAt
          : null,
    };
  });
}
