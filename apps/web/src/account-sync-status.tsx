import { syncRows } from "./sync-status-model";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError, type Session } from "./api";
import {
  RefreshCw,
  ListFilter,
  ReceiptText,
  MonitorSmartphone,
  FileInput,
  ArchiveRestore,
} from "lucide-react";
import { Dialog } from "./dialog";
import { WorkspaceTabs } from "./workspace-ui";
import { LoadingPlaceholder } from "./loading-placeholder";
import "./sync-status.css";
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
  value === null ||
  !Number.isFinite(value) ||
  !Number.isFinite(new Date(value).getTime())
    ? "未知"
    : new Date(value).toLocaleString("zh-CN");
const sourceTime = (value: string | null | undefined) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString("zh-CN")
    : "未知";
const domainGroups = [
  { label: "账户与资产", keys: ["brokers", "portfolio", "watch"] },
  { label: "个人内容", keys: ["profile", "resources", "feed"] },
  { label: "设置与安全", keys: ["alerts", "settings", "authorization"] },
];
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
  const [diagnostics, setDiagnostics] = useState(false),
    [diagnosticSection, setDiagnosticSection] = useState("connection"),
    [serviceAddress, setServiceAddress] = useState("");
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
    setDiagnostics(false);
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
    // Same-session management metadata stays visible while its replacement is checked.
    // clear() still withdraws it on a context failure, hidden view or changed identity.
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
  const rows = signals
    ? syncRows({
        ...signals,
        unrepresentedSources: signals.unrepresentedSources || [],
      })
    : [];
  return (
    <section className="account-sync-panel account-sync-overview workspace-ui">
      <div className="account-sync-toolbar">
        <span>
          {signals
            ? `核对于 ${sourceTime(signals.observedAt)}`
            : "当前服务变更监测"}
        </span>
        <div className="account-sync-toolbar-actions">
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setServiceAddress(window.location.origin);
              setDiagnostics(true);
            }}
          >
            诊断详情
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="刷新同步状态"
            aria-busy={busy}
            disabled={busy || !active}
            onClick={() => void load()}
          >
            <RefreshCw
              size={16}
              className={busy ? "sync-refreshing" : undefined}
            />
          </button>
        </div>
      </div>
      <p className="sync-scope-note">
        仅监测当前服务；其他服务的数据不会自动合并。
      </p>
      {Object.entries(errors).map(([key, value]) => (
        <p key={key} role="alert" className="sync-read-error">
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
      {epochChanged && (
        <p role="status" className="sync-read-notice">
          来源已变化，已撤下旧版本。
        </p>
      )}
      {!signals && busy && <LoadingPlaceholder label="正在核对同步范围" />}
      {signals && (
        <div className="sync-domain-groups" aria-busy={busy}>
          {domainGroups.map((group) => (
            <section
              key={group.label}
              className="sync-domain-group"
              aria-label={group.label}
            >
              <h2>{group.label}</h2>
              <div>
                {group.keys.map((key) => {
                  const row = rows.find((value) => value.key === key)!;
                  return (
                    <div className="sync-domain-row" key={key}>
                      <span>{row.label}</span>
                      <span
                        className="sync-domain-state"
                        data-state={
                          row.status === "已监测"
                            ? "observed"
                            : signals.domains[key]?.state === "forbidden"
                              ? "forbidden"
                              : "unknown"
                        }
                      >
                        <i aria-hidden="true" />
                        {row.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
      <div className="sync-business-groups">
        <section aria-label="账户管理" className="sync-business-group">
          <h2>账户管理</h2>
          <div className="sync-entry-list">
            <Link className="sync-entry" to="/watch-groups">
              <ListFilter size={18} />
              <span>自选分组</span>
            </Link>
            <Link className="sync-entry" to="/fees">
              <ReceiptText size={18} />
              <span>费用</span>
            </Link>
            <button
              type="button"
              className="sync-entry"
              onClick={onOpenDevices}
            >
              <MonitorSmartphone size={18} />
              <span>设备与授权</span>
            </button>
          </div>
        </section>
        <section aria-label="数据管理" className="sync-business-group">
          <h2>数据管理</h2>
          <div className="sync-entry-list">
            <Link className="sync-entry" to="/legacy-import">
              <FileInput size={18} />
              <span>导入数据</span>
            </Link>
            {session.user.role === "admin" && (
              <Link className="sync-entry" to="/backups">
                <ArchiveRestore size={18} />
                <span>备份恢复</span>
              </Link>
            )}
          </div>
        </section>
      </div>
      {diagnostics && (
        <Dialog
          title="诊断详情"
          className="sync-diagnostic-dialog"
          onClose={() => setDiagnostics(false)}
        >
          <div className="sync-diagnostic-body">
            <WorkspaceTabs
              label="同步诊断分类"
              value={diagnosticSection}
              onChange={setDiagnosticSection}
              items={[
                { value: "connection", label: "当前连接" },
                { value: "coverage", label: "来源覆盖" },
                { value: "fields", label: "字段记录" },
              ]}
            />
            {diagnosticSection === "connection" && (
              <div className="sync-diagnostic-sections">
                <section>
                  <h3>当前服务</h3>
                  <dl className="sync-diagnostic-values">
                    <div>
                      <dt>服务地址</dt>
                      <dd>
                        <code>{serviceAddress}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>监测范围</dt>
                      <dd>当前服务、当前登录账号</dd>
                    </div>
                  </dl>
                </section>
                {signals && (
                  <section>
                    <h3>账号与来源</h3>
                    <dl className="sync-diagnostic-values">
                      <div>
                        <dt>账号</dt>
                        <dd>
                          <code>{signals.userId}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>实例</dt>
                        <dd>
                          <code>{signals.instanceId}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>来源代次</dt>
                        <dd>
                          <code>{signals.epoch}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>平台启用</dt>
                        <dd>{sourceTime(signals.installedAt)}</dd>
                      </div>
                      <div>
                        <dt>覆盖口径</dt>
                        <dd>{signals.scope}</dd>
                      </div>
                      <div>
                        <dt>读取时间</dt>
                        <dd>{sourceTime(signals.observedAt)}</dd>
                      </div>
                      <div>
                        <dt>授权范围</dt>
                        <dd>{signals.binding.scopes.join("、") || "未登记"}</dd>
                      </div>
                      <div>
                        <dt>会话代次</dt>
                        <dd>{signals.binding.sessionVersion}</dd>
                      </div>
                      <div>
                        <dt>变更标识</dt>
                        <dd>
                          <code>{signals.context}</code>
                        </dd>
                      </div>
                    </dl>
                  </section>
                )}
                {device && (
                  <section>
                    <h3>当前设备</h3>
                    <dl className="sync-diagnostic-values">
                      <div>
                        <dt>名称</dt>
                        <dd>
                          {device.device.name} ·{" "}
                          {device.device.kind === "web" ? "Web" : "App"} ·{" "}
                          {device.device.current ? "当前会话" : "当前性待核对"}
                        </dd>
                      </div>
                      <div>
                        <dt>授权</dt>
                        <dd>
                          {device.device.authorizationState === "active"
                            ? "当前有效"
                            : device.device.authorizationState}
                        </dd>
                      </div>
                      <div>
                        <dt>在线状态</dt>
                        <dd>
                          {device.device.onlineState === "unknown"
                            ? "未知"
                            : device.device.onlineState}
                        </dd>
                      </div>
                      <div>
                        <dt>创建</dt>
                        <dd>{time(device.device.createdAt)}</dd>
                      </div>
                      <div>
                        <dt>到期</dt>
                        <dd>{time(device.device.expiresAt)}</dd>
                      </div>
                      <div>
                        <dt>最近使用</dt>
                        <dd>{time(device.device.lastUsedAt)}</dd>
                      </div>
                      <div>
                        <dt>设备标识</dt>
                        <dd>
                          <code>{device.device.id}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>使用时间依据</dt>
                        <dd>
                          {device.device.lastUsedEvidence === "unavailable"
                            ? "不可用"
                            : device.device.lastUsedEvidence}
                        </dd>
                      </div>
                    </dl>
                  </section>
                )}
                <p className="sync-diagnostic-note">
                  有效凭据不代表设备在线；变更修订不作为余额或金融写入证明。
                </p>
              </div>
            )}
            {diagnosticSection === "coverage" && (
              <div className="sync-diagnostic-sections">
                {signals ? (
                  <>
                    <section>
                      <h3>变更来源</h3>
                      <p className="sync-diagnostic-note">
                        读取于 {sourceTime(signals.observedAt)}
                        {signals.legacyComplete === false
                          ? " · 旧来源尚未完整验收"
                          : ""}
                      </p>
                      <div className="sync-diagnostic-table">
                        <table>
                          <thead>
                            <tr>
                              <th>范围</th>
                              <th>修订与时间</th>
                              <th>来源覆盖</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(signals.domains).map(
                              ([name, value]) => (
                                <tr key={name}>
                                  <td>
                                    <strong>
                                      {domainLabels[name] || name}
                                    </strong>
                                    <small>
                                      {states[value.state] || value.state}
                                    </small>
                                  </td>
                                  <td>
                                    {value.revision === null
                                      ? "未知"
                                      : value.revision}
                                    <small>
                                      {sourceTime(value.lastChangedAt)}
                                    </small>
                                  </td>
                                  <td>
                                    <dl className="sync-source-values">
                                      <div>
                                        <dt>提交信号</dt>
                                        <dd>
                                          {value.commitSignalComplete
                                            ? "已覆盖登记范围"
                                            : "尚未完整覆盖"}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt>已登记</dt>
                                        <dd>
                                          {value.sources.join("、") || "无"}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt>缺失</dt>
                                        <dd>
                                          {value.missingSources.join("、") ||
                                            "无已登记缺项"}
                                        </dd>
                                      </div>
                                      {value.coveredSince && (
                                        <div>
                                          <dt>覆盖起点</dt>
                                          <dd>
                                            {sourceTime(value.coveredSince)}
                                          </dd>
                                        </div>
                                      )}
                                      {value.expectedSources && (
                                        <div>
                                          <dt>预期来源</dt>
                                          <dd>
                                            {value.expectedSources.join("、") ||
                                              "未登记"}
                                          </dd>
                                        </div>
                                      )}
                                    </dl>
                                  </td>
                                </tr>
                              ),
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>
                    {!!signals.unrepresentedSources?.length && (
                      <section>
                        <h3>尚未纳入的来源</h3>
                        <p>{signals.unrepresentedSources.join("、")}</p>
                      </section>
                    )}
                  </>
                ) : (
                  <p className="sync-diagnostic-empty">尚未取得来源记录</p>
                )}
              </div>
            )}
            {diagnosticSection === "fields" && (
              <div className="sync-diagnostic-sections">
                <FieldList summary={watch} namespace="watch" />
                <FieldList summary={fees} namespace="fees" />
              </div>
            )}
          </div>
        </Dialog>
      )}
    </section>
  );
}
function FieldList({
  summary,
  namespace,
}: {
  summary: FieldSummary | null;
  namespace: "watch" | "fees";
}) {
  return (
    <section>
      <h3>
        {namespace === "watch" ? "自选显示字段" : "费率字段"}
        {summary && summary.items.length > 0 && (
          <span className="sync-field-count">{summary.items.length}</span>
        )}
      </h3>
      {!summary ? (
        <p className="sync-diagnostic-empty">尚未取得字段记录</p>
      ) : !summary.items.length ? (
        <p className="sync-diagnostic-empty">
          当前服务暂无字段记录；不表示其他服务的数据已迁移。
        </p>
      ) : (
        <div className="sync-diagnostic-table">
          <table>
            <thead>
              <tr>
                <th>字段</th>
                <th>修订</th>
                <th>状态与来源</th>
              </tr>
            </thead>
            <tbody>
              {summary.items.map((item) => (
                <tr key={item.key}>
                  <td>
                    {fieldLabel(item.key)}
                    {item.market && <small>{item.market}</small>}
                    {item.planId && (
                      <small>
                        规则 {item.planId}
                        {item.planRevision === undefined
                          ? ""
                          : ` · 修订 ${item.planRevision}`}
                      </small>
                    )}
                  </td>
                  <td>{item.revision}</td>
                  <td>
                    {item.deleted ? "删除墓碑（金融历史保留）" : "已保存字段"}
                    {namespace === "fees" && (
                      <>
                        <small>
                          {item.authority === "retained_legacy_original"
                            ? "保留旧规则原件"
                            : item.authority ===
                                "platform_revision_projection_not_original"
                              ? "平台修订兼容投影（非旧原件）"
                              : item.authority === "retained_deletion_tombstone"
                                ? "保留删除墓碑（历史规则保留）"
                                : item.authority || "来源口径未知"}
                        </small>
                        <small>
                          旧原字节：
                          {item.originalBytesRetained === true
                            ? "保留"
                            : item.originalBytesRetained === false
                              ? "未附"
                              : "未知"}
                        </small>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
