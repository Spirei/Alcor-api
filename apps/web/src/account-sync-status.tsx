import { syncRows } from "./sync-status-model";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, type Session } from "./api";
import { RefreshCw } from "lucide-react";
type Domain = {
  commitSignalComplete: boolean;
  state: "observed" | "partial" | "unavailable" | "forbidden";
  revision: number | null;
  lastChangedAt: string | null;
  sources: string[];
  missingSources: string[];
  coveredSince?: string | null;
  expectedSources?: string[];
};
type Binding = {
  instanceId: string;
  userId: string;
  role: string;
  principal: string;
  scopes: string[];
  sessionVersion: number;
  apiVersion: number;
};
type Signals = {
  userId: string;
  instanceId: string;
  context: string;
  epoch: string;
  scope: string;
  installedAt: string;
  observedAt: string;
  binding: Binding;
  financialAuthority: false;
  legacyComplete: false;
  domains: Record<string, Domain>;
  unrepresentedSources?: string[];
};
type Device = {
  id: string;
  kind: string;
  name: string;
  current: boolean;
  createdAt: number | null;
  expiresAt: number | null;
  lastUsedAt: number | null;
  lastUsedEvidence: string;
  authorizationState: string;
  onlineState: string;
};
type DeviceState = Omit<Signals, "domains"> & { device: Device };
type RawFields = {
  version: number;
  userId: string;
  namespace: string;
  fields: Record<string, { revision: number; value: unknown }>;
  fieldProvenance?: Record<
    string,
    {
      authority: string;
      originalBytesRetained: boolean;
      market?: string;
      planId?: string;
      revision?: number;
    }
  >;
};
type FieldSummary = {
  namespace: string;
  items: {
    key: string;
    revision: number;
    deleted: boolean;
    authority?: string;
    originalBytesRetained?: boolean;
    market?: string;
    planId?: string;
    planRevision?: number;
  }[];
};
const domainLabels: Record<string, string> = {
  profile: "个人资料",
  portfolio: "持仓与交易",
  watch: "自选与分组",
  brokers: "券商账户",
  alerts: "提醒",
  resources: "文件与资源",
  feed: "动态",
  settings: "设置",
  authorization: "授权与安全",
};
const states: Record<string, string> = {
  observed: "已观察",
  partial: "部分来源",
  unavailable: "来源不可用",
  forbidden: "无当前权限",
};
function summarize(
  value: RawFields,
  namespace: string,
  userId: string,
): FieldSummary {
  if (value.userId !== userId || value.namespace !== namespace)
    throw new Error("同步字段账号或类别不符");
  return {
    namespace,
    items: Object.entries(value.fields).map(([key, row]) => {
      const source = value.fieldProvenance?.[key];
      return {
        key,
        revision: row.revision,
        deleted: row.value === null,
        authority: source?.authority,
        originalBytesRetained: source?.originalBytesRetained,
        market: source?.market,
        planId: source?.planId,
        planRevision: source?.revision,
      };
    }),
  };
}
function fieldLabel(key: string) {
  try {
    const parts = JSON.parse(key);
    if (
      Array.isArray(parts) &&
      parts.every((value) => typeof value === "string")
    )
      return parts
        .map((value, index) =>
          index === 0
            ? (
                {
                  hidden: "取消关注",
                  pinned: "置顶",
                  aliases: "别名",
                  notes: "显示备注",
                  moved: "显示移动",
                  groups: "附加分组",
                  orders: "显示顺序",
                } as Record<string, string>
              )[value] || value
            : value,
        )
        .join(" · ");
  } catch {
    /* Fee keys use the original plan/history path. */
  }
  return key;
}
const time = (value: number | null) =>
  value === null ? "未知" : new Date(value).toLocaleString("zh-CN");
export function AccountSyncStatus({
  session,
  active,
  onOpenDevices,
}: {
  session: Session;
  active: boolean;
  onOpenDevices: () => void;
}) {
  return (
    <Panel
      key={JSON.stringify([
        session.instance_id,
        session.user.id,
        session.user.role,
        session.receipt_scope,
        session.csrf,
        session.expires_at,
      ])}
      session={session}
      active={active}
      onOpenDevices={onOpenDevices}
    />
  );
}
function Panel({
  session,
  active,
  onOpenDevices,
}: {
  session: Session;
  active: boolean;
  onOpenDevices: () => void;
}) {
  const [signals, setSignals] = useState<Signals | null>(null),
    [device, setDevice] = useState<DeviceState | null>(null),
    [watch, setWatch] = useState<FieldSummary | null>(null),
    [fees, setFees] = useState<FieldSummary | null>(null),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [epochChanged, setEpochChanged] = useState(false);
  const epoch = useRef(0),
    alive = useRef(true),
    controller = useRef<AbortController | null>(null),
    context = useRef<string | null>(null),
    sourceEpoch = useRef<string | null>(null);
  function clear() {
    epoch.current++;
    controller.current?.abort();
    setSignals(null);
    setDevice(null);
    setWatch(null);
    setFees(null);
    setBusy(false);
    setEpochChanged(false);
  }
  useEffect(() => {
    alive.current = true;
    if (!active) {
      clear();
      context.current = null;
      sourceEpoch.current = null;
    }
    const hide = () => {
      if (document.hidden) {
        clear();
        context.current = null;
        sourceEpoch.current = null;
      } else if (active) {
        void load();
      }
    };
    document.addEventListener("visibilitychange", hide);
    if (active) void load();
    return () => {
      alive.current = false;
      epoch.current++;
      controller.current?.abort();
      document.removeEventListener("visibilitychange", hide);
    };
  }, [active]);
  function validate(value: {
    userId: string;
    instanceId: string;
    binding: Binding;
  }) {
    if (
      value.userId !== session.user.id ||
      value.instanceId !== session.instance_id ||
      value.binding.userId !== session.user.id ||
      value.binding.instanceId !== session.instance_id ||
      value.binding.role !== session.user.role
    )
      throw new Error("当前同步来源账号、实例或权限不符");
  }
  async function load() {
    if (busy || !active || document.hidden) return;
    const previous = sourceEpoch.current,
      run = ++epoch.current,
      c = new AbortController();
    controller.current?.abort();
    controller.current = c;
    setSignals(null);
    setDevice(null);
    setWatch(null);
    setFees(null);
    setErrors({});
    setBusy(true);
    setEpochChanged(false);
    try {
      const signal = await api<Signals>("/account/changes", {
        signal: c.signal,
        headers: context.current
          ? { "X-Alcor-Context": context.current }
          : undefined,
      });
      if (!alive.current || run !== epoch.current || c.signal.aborted) return;
      validate(signal);
      context.current = signal.context;
      sourceEpoch.current = signal.epoch;
      setEpochChanged(previous !== null && previous !== signal.epoch);
      setSignals(signal);
      const results = await Promise.allSettled([
        api<DeviceState>("/account/device-state", {
          signal: c.signal,
          headers: { "X-Alcor-Context": signal.context },
        }),
        api<RawFields>("/account/state?namespace=watch", { signal: c.signal }),
        api<RawFields>("/account/state?namespace=fees", { signal: c.signal }),
      ]);
      if (!alive.current || run !== epoch.current || c.signal.aborted) return;
      for (const result of results)
        if (
          result.status === "rejected" &&
          result.reason instanceof ApiError &&
          [401, 403].includes(result.reason.status)
        )
          throw result.reason;
      const failure: Record<string, string> = {};
      const [current, watchFields, feeFields] = results;
      if (current.status === "fulfilled") {
        validate(current.value);
        if (
          current.value.context !== signal.context ||
          current.value.epoch !== signal.epoch
        )
          throw new Error("同步来源代次已变化，请重新读取");
        setDevice(current.value);
      } else
        failure.device =
          current.reason instanceof Error
            ? current.reason.message
            : "设备状态不可用";
      if (watchFields.status === "fulfilled")
        setWatch(summarize(watchFields.value, "watch", session.user.id));
      else
        failure.watch =
          watchFields.reason instanceof Error
            ? watchFields.reason.message
            : "自选字段不可用";
      if (feeFields.status === "fulfilled")
        setFees(summarize(feeFields.value, "fees", session.user.id));
      else
        failure.fees =
          feeFields.reason instanceof Error
            ? feeFields.reason.message
            : "费率字段不可用";
      setErrors(failure);
    } catch (failure) {
      if (!c.signal.aborted && run === epoch.current) {
        clear();
        context.current = null;
        sourceEpoch.current = null;
        setErrors({
          read: failure instanceof Error ? failure.message : "同步状态读取失败",
        });
      }
    } finally {
      if (run === epoch.current) setBusy(false);
    }
  }
  return (
    <section className="account-sync-panel workspace-ui">
      <div className="account-sync-toolbar">
        <span>当前账号同步范围</span>
        <button
          className="icon-button"
          aria-label="刷新同步状态"
          aria-busy={busy}
          disabled={busy || !active}
          onClick={() => void load()}
        >
          <RefreshCw size={16} className={busy ? "spin" : undefined} />
        </button>
      </div>
      {Object.entries(errors).map(([key, value]) => (
        <p key={key} role="alert">
          {
            (
              {
                read: "读取",
                device: "当前设备",
                watch: "自选字段",
                fees: "费率字段",
              } as Record<string, string>
            )[key]
          }{" "}
          · {value}
        </p>
      ))}
      {epochChanged && <p role="status">来源代次已变化，旧版本不再用于比较</p>}
      {signals && (
        <>
          <div className="sync-status-list">
            {syncRows({
              ...signals,
              unrepresentedSources: signals.unrepresentedSources || [],
            }).map((row) => (
              <div className="sync-status-row" key={row.key}>
                <div>
                  <strong>{row.label}</strong>
                  <small>
                    {row.changedAt
                      ? `最近变更 ${new Date(row.changedAt).toLocaleString()}`
                      : "尚无变更时间"}
                  </small>
                </div>
                <span>{row.status}</span>
              </div>
            ))}
          </div>
          <details>
            <summary>来源与覆盖范围</summary>
            <p>
              读取时间 {signals.observedAt} · 平台启用以来的变更范围
              {signals.legacyComplete === false ? " · 旧来源尚未完整验收" : ""}
            </p>
            <div className="workspace-table">
              <table>
                <thead>
                  <tr>
                    <th>类别</th>
                    <th>状态</th>
                    <th>当前账号修订</th>
                    <th>最近变更</th>
                    <th>来源</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(signals.domains).map(([name, value]) => (
                    <tr key={name}>
                      <td>{domainLabels[name] || name}</td>
                      <td>{states[value.state] || value.state}</td>
                      <td>
                        {value.revision === null ? "未知" : value.revision}
                      </td>
                      <td>{value.lastChangedAt || "未知"}</td>
                      <td>
                        <details>
                          <summary>
                            已登记 {value.sources.length} · 缺失{" "}
                            {value.missingSources.length}
                          </summary>
                          {value.coveredSince && (
                            <p>覆盖起点 {value.coveredSince}</p>
                          )}
                          <p>已登记来源 {value.sources.join("、") || "无"}</p>
                          <p>
                            缺失来源{" "}
                            {value.missingSources.join("、") || "无已登记缺项"}
                          </p>
                          {value.expectedSources && (
                            <p>
                              预期来源{" "}
                              {value.expectedSources.join("、") || "未登记"}
                            </p>
                          )}
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details>
              <summary>来源与账号标识</summary>
              <dl>
                <dt>账号</dt>
                <dd>{signals.userId}</dd>
                <dt>实例</dt>
                <dd>{signals.instanceId}</dd>
                <dt>来源代次</dt>
                <dd>{signals.epoch}</dd>
                <dt>平台启用</dt>
                <dd>{signals.installedAt}</dd>
                <dt>当前会话授权范围</dt>
                <dd>{signals.binding.scopes.join("、")}</dd>
                <dt>会话代次</dt>
                <dd>{signals.binding.sessionVersion}</dd>
                <dt>变更标识</dt>
                <dd>{signals.context}</dd>
              </dl>
              <p>变更修订不作为金融写入确认或余额证明</p>
            </details>
          </details>
        </>
      )}
      {device && (
        <details>
          <summary>当前设备与授权</summary>
          <p>
            {device.device.name} ·{" "}
            {device.device.kind === "web" ? "Web" : "App"} ·{" "}
            {device.device.current ? "当前会话" : "当前性待核对"}
          </p>
          <dl>
            <dt>授权</dt>
            <dd>
              {device.device.authorizationState === "active"
                ? "当前有效"
                : device.device.authorizationState}
            </dd>
            <dt>在线状态</dt>
            <dd>
              {device.device.onlineState === "unknown"
                ? "未知（不据有效凭据推断在线）"
                : device.device.onlineState}
            </dd>
            <dt>创建</dt>
            <dd>{time(device.device.createdAt)}</dd>
            <dt>到期</dt>
            <dd>{time(device.device.expiresAt)}</dd>
            <dt>最近使用</dt>
            <dd>{time(device.device.lastUsedAt)}</dd>
          </dl>
          <details>
            <summary>设备标识</summary>
            <p>{device.device.id}</p>
            <p>
              使用时间依据{" "}
              {device.device.lastUsedEvidence === "unavailable"
                ? "不可用"
                : device.device.lastUsedEvidence}
            </p>
          </details>
          <button
            type="button"
            className="button secondary"
            onClick={onOpenDevices}
          >
            管理登录设备
          </button>
        </details>
      )}
      {watch && <FieldList summary={watch} />}
      <Link className="button secondary" to="/watch-groups">
        打开本人自选与分组
      </Link>
      {fees && <FieldList summary={fees} />}
      <Link className="button secondary" to="/fees">
        打开本人费率与原件核对
      </Link>
    </section>
  );
}
function FieldList({ summary }: { summary: FieldSummary }) {
  return (
    <details>
      <summary>
        {summary.namespace === "watch" ? "自选显示字段" : "费率同步字段"} ·{" "}
        {summary.items.length} 项
      </summary>
      {!summary.items.length && <p>平台当前无字段记录，不表示旧来源已迁移</p>}
      <div className="workspace-table">
        <table>
          <thead>
            <tr>
              <th>字段</th>
              <th>字段修订</th>
              <th>状态</th>
              {summary.namespace === "fees" && (
                <>
                  <th>来源口径</th>
                  <th>旧原字节</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {summary.items.map((item) => (
              <tr key={item.key}>
                <td>
                  {fieldLabel(item.key)}
                  {item.market && <small> · {item.market}</small>}
                </td>
                <td>{item.revision}</td>
                <td>
                  {item.deleted ? "删除墓碑（不删除金融历史）" : "已保存字段"}
                </td>
                {summary.namespace === "fees" && (
                  <>
                    <td>
                      {item.authority === "retained_legacy_original"
                        ? "保留旧规则原件"
                        : item.authority ===
                            "platform_revision_projection_not_original"
                          ? "平台修订兼容投影（非旧原件）"
                          : item.authority === "retained_deletion_tombstone"
                            ? "保留删除墓碑（历史规则保留）"
                            : item.authority || "未知"}
                    </td>
                    <td>
                      {item.originalBytesRetained === true
                        ? "保留"
                        : item.originalBytesRetained === false
                          ? "未附"
                          : "未知"}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
