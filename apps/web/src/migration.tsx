import { LoadingPlaceholder } from "./loading-placeholder";
import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Minus, Plus, RefreshCw, Search } from "lucide-react";
import type { Capability, ImplementationStage, MigrationRegister } from "./api";
import { useResource, useMigrationInvalidation } from "./hooks";
import { usePanelReady } from "./transition-qa";
import {
  capabilityClientProgress,
  capabilityEntryEvidence,
  capabilityMatches,
  dispositionLabels,
  implementationPlan,
  nonApiImplementationStage,
  migrationSourceProgress,
  migrationDomainState,
} from "./migration-view";
import { MigrationStatus } from "./migration-status";
import "./migration.css";
import { MigrationWorkStatusPanel } from "./migration-work-status";

type View = "capabilities" | "legacy" | "clients";
const migrationClients = [
  ["new_web", "新 Web"],
  ["legacy_web", "旧 Web"],
  ["ios", "App"],
] as const;

function CapabilityDetail({
  cap,
  stage,
}: {
  cap: Capability;
  stage?: ImplementationStage;
}) {
  const entry = capabilityEntryEvidence(cap.implementation);
  const staged =
    cap.implementation.status === "pending_validation" ||
    cap.implementation.status === "partial_pending_validation";
  return (
    <details className="capability-detail">
      <summary
        className={
          cap.implementation.status === "retired" ? "retired-row" : undefined
        }
      >
        <span>{cap.name}</span>
        <span className="operation-state">
          <MigrationStatus
            status={cap.implementation.status}
            label={
              cap.implementation.status === "pending" ? "待实现" : undefined
            }
          />
        </span>
      </summary>
      <div className="capability-body">
        {(cap.implementation.status === "pending_validation" ||
          cap.implementation.status === "partial_pending_validation") && (
          <p>
            {cap.implementation.status === "pending_validation"
              ? "已实现，待集中验证。"
              : "部分接口已实现，待验证；其余仍在迁移。"}
            未计入已验证或客户端验收数量。
          </p>
        )}
        {staged && Boolean(stage?.pending_validation.length) && (
          <div aria-label="待验证内容">
            <strong>待验证内容</strong>
            <ul>
              {stage?.pending_validation.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        )}
        {staged && Boolean(stage?.remaining_implementation?.length) && (
          <div aria-label="尚未实现内容">
            <strong>尚未实现内容</strong>
            <ul>
              {stage?.remaining_implementation?.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        )}
        <dl>
          <div>
            <dt>{entry.label}</dt>
            <dd>
              <code>
                {cap.method} {cap.proposed_path}
              </code>
            </dd>
          </div>
          {entry.routes.length > 0 && (
            <div>
              <dt>
                {entry.legacyOnly ? "已验证旧协议实际入口" : "已验证实际入口"}
              </dt>
              <dd>
                {entry.routes.map((route) => (
                  <div key={route.method + route.path}>
                    <code>
                      {route.method} {route.path}
                    </code>
                  </div>
                ))}
              </dd>
            </div>
          )}
          <div>
            <dt>处理方式</dt>
            <dd>{dispositionLabels[cap.disposition] || "待核对"}</dd>
          </div>
        </dl>
        {Boolean(cap.action_contracts?.length) && (
          <dl aria-label="操作契约">
            {cap.action_contracts?.map((action) => (
              <div key={action.action}>
                <dt>
                  <code>{action.action}</code>
                </dt>
                <dd>
                  <code>
                    {action.method} {action.path}
                  </code>
                  <p className="muted migration-action-meta">
                    <span>{action.auth}</span>
                    <MigrationStatus status={action.status} />
                  </p>
                </dd>
              </div>
            ))}
          </dl>
        )}
        {cap.constraints.map((note) => (
          <p className="muted" key={note}>
            {note}
          </p>
        ))}
        {Boolean(cap.protocol_matrix?.length) && (
          <div className="portfolio-table">
            <table aria-label="协议验证">
              <thead>
                <tr>
                  <th>来源</th>
                  <th>服务</th>
                  <th>新 Web</th>
                  <th>旧 Web</th>
                  <th>App</th>
                </tr>
              </thead>
              <tbody>
                {cap.protocol_matrix?.map((part) => (
                  <tr key={part.source_key}>
                    <td>
                      <code>{part.source_key}</code>
                    </td>
                    <td>
                      <MigrationStatus status={part.implementation.status} />
                    </td>
                    <td>
                      <MigrationStatus status={part.clients.new_web} />
                    </td>
                    <td>
                      <MigrationStatus status={part.clients.legacy_web} />
                    </td>
                    <td>
                      <MigrationStatus status={part.clients.ios} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="operation-list" aria-label="关联旧契约">
          {cap.bindings.map((binding) => (
            <div
              key={binding.source_kind + binding.source_id}
              className={
                binding.status === "retired" ? "retired-row" : undefined
              }
            >
              <span className="method">{binding.method}</span>
              <code>{binding.path}</code>
              <span className="operation-state">
                <MigrationStatus status={binding.status} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

export function MigrationPage() {
  const resource = useResource<MigrationRegister>("/system/migration");
  const { data, error, reload, refreshing } = resource;
  const invalidateOverview = useMigrationInvalidation();
  const [workRefresh, setWorkRefresh] = useState(0);
  const refresh = () => {
    setWorkRefresh((value) => value + 1);
    reload();
    invalidateOverview();
  };
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("capabilities");
  usePanelReady("/migration", Boolean(data));
  const plan = useMemo(
    () =>
      implementationPlan(data?.capability_plan, data?.implementation_staging),
    [data],
  );
  const sourceProgress = migrationSourceProgress(plan);
  const grouped = useMemo(() => {
    const result = new Map<string, Capability[]>();
    for (const cap of plan?.capabilities || []) {
      for (const id of cap.feature_ids)
        result.set(id, [...(result.get(id) || []), cap]);
    }
    return result;
  }, [plan]);
  const domains = useMemo(
    () =>
      (data?.domains || []).filter((domain) => {
        const own = (domain.id + " " + domain.name + " " + domain.target)
          .toLowerCase()
          .includes(query.trim().toLowerCase());
        return (
          own ||
          (grouped.get(domain.id) || []).some((cap) =>
            capabilityMatches(cap, query),
          )
        );
      }),
    [data, query, grouped],
  );
  const mapping = useMemo(
    () =>
      new Map(plan?.bindings.map((binding) => [binding.source_id, binding])),
    [plan],
  );
  const capabilities = new Map(plan?.capabilities.map((cap) => [cap.id, cap]));
  return (
    <>
      <div className="page-heading">
        <h1>迁移进度</h1>
        <button
          type="button"
          className="button secondary"
          onClick={refresh}
          disabled={refreshing}
          aria-label="刷新迁移进度"
        >
          <RefreshCw size={16} className={refreshing ? "spin" : undefined} />
          {refreshing ? "刷新中…" : "刷新"}
        </button>
      </div>
      <MigrationWorkStatusPanel refreshKey={workRefresh} />
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={refresh}
            disabled={refreshing}
          >
            重新读取
          </button>
        </div>
      )}
      {!data ? (
        error ? (
          <div role="status">迁移清单不可用</div>
        ) : (
          <LoadingPlaceholder />
        )
      ) : (
        <>
          <div className="migration-progress-overview">
            <div className="migration-summary-line">
              {Boolean(
                plan?.capabilities.some(
                  (cap) => cap.implementation.status === "pending_validation",
                ),
              ) && (
                <span>
                  <strong>
                    {
                      plan?.capabilities.filter(
                        (cap) =>
                          cap.implementation.status === "pending_validation",
                      ).length
                    }
                  </strong>
                  待验证
                </span>
              )}
              {Boolean(
                plan?.capabilities.some(
                  (cap) =>
                    cap.implementation.status === "partial_pending_validation",
                ),
              ) && (
                <span>
                  <strong>
                    {
                      plan?.capabilities.filter(
                        (cap) =>
                          cap.implementation.status ===
                          "partial_pending_validation",
                      ).length
                    }
                  </strong>
                  部分待验证
                </span>
              )}
              {Boolean(plan?.summary.retired_legacy_methods) && (
                <span>
                  <strong>{plan?.summary.retired_legacy_methods}</strong>
                  按要求移除
                </span>
              )}
              <span>
                <strong>{data.summary.domains}</strong>业务域
              </span>
              <span>
                <strong>{data.summary.method_bindings}</strong>旧方法
              </span>
              <span>
                <strong>{data.summary.identified_dispatches}</strong>动态动作
              </span>
            </div>
            {sourceProgress && (
              <div
                className="migration-progress"
                data-complete={sourceProgress.ratio === 1}
                data-stale={Boolean(error)}
              >
                <div className="migration-progress-caption">
                  <span>源码候选覆盖</span>
                  <strong>
                    {sourceProgress.verified} / {sourceProgress.total} ·{" "}
                    {sourceProgress.percent.toFixed(1)}
                    <small>%</small>
                  </strong>
                </div>
                <div
                  className="migration-progress-track"
                  role="progressbar"
                  aria-label="源码候选覆盖进度"
                  aria-valuemin={0}
                  aria-valuemax={sourceProgress.total}
                  aria-valuenow={sourceProgress.verified}
                  aria-valuetext={`${sourceProgress.verified} / ${sourceProgress.total} 项已有源码候选，${sourceProgress.percent.toFixed(1)}%`}
                  style={
                    {
                      "--migration-progress": sourceProgress.ratio,
                    } as CSSProperties
                  }
                >
                  <span className="migration-progress-fill">
                    <span />
                  </span>
                </div>
                <small>
                  候选覆盖不代表迁移完成。待验证{" "}
                  {sourceProgress.pendingValidation}
                  {sourceProgress.nonApi.total > 0 && (
                    <>
                      {" "}
                      · 非接口专项源码 {sourceProgress.nonApi.complete} /{" "}
                      {sourceProgress.nonApi.total}
                    </>
                  )}
                </small>
              </div>
            )}
          </div>
          {plan ? (
            <div className="migration-tracks" aria-label="迁移分项进度">
              <div>
                <span>旧协议本地核验</span>
                <strong>
                  {plan.summary.legacy_local_verified} /{" "}
                  {plan.summary.legacy_methods}
                </strong>
                <small>
                  本地验证 · {plan.summary.legacy_accepted} 完整验收
                </small>
              </div>
              <div>
                <span>旧 Web / App 改接</span>
                <strong>{plan.summary.client_integrations_accepted}</strong>
                <small>已验收</small>
              </div>
            </div>
          ) : (
            <div className="notice" role="status">
              能力映射尚未提供
            </div>
          )}
          <div className="migration-switch" role="group" aria-label="迁移视图">
            {(
              [
                ["capabilities", "业务能力"],
                ["legacy", "旧接口"],
                ["clients", "客户端改接"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className="button secondary"
                aria-pressed={view === value}
                onClick={() => setView(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="table-toolbar">
            <div className="input-search">
              <Search size={17} />
              <input
                aria-label="搜索迁移功能"
                placeholder="搜索功能、编号或接口"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <span className="muted">{domains.length} 个业务域</span>
          </div>
          <div className="domain-list">
            {domains.map((domain) => {
              const allCaps = grouped.get(domain.id) || [];
              const domainMatches = (
                domain.id +
                " " +
                domain.name +
                " " +
                domain.target
              )
                .toLowerCase()
                .includes(query.trim().toLowerCase());
              const caps = domainMatches
                ? allCaps
                : allCaps.filter((cap) => capabilityMatches(cap, query));
              const allOps = (data.operations || []).filter((op) =>
                op.feature_ids.includes(domain.id),
              );
              const clients = migrationClients.map(([client, label]) => ({
                client,
                name: label,
                ...capabilityClientProgress(allCaps, client),
              }));
              const nonApi =
                !allCaps.length && !allOps.length
                  ? plan?.non_api_work.find(
                      (work) => work.feature_id === domain.id,
                    )
                  : undefined;
              const nonApiStage = nonApiImplementationStage(
                data.implementation_staging,
                domain.id,
              );
              const domainState = migrationDomainState(
                domain.status,
                nonApi
                  ? []
                  : view === "capabilities"
                    ? allCaps.map((cap) => cap.implementation.status)
                    : view === "legacy"
                      ? allOps.map((op) => op.status)
                      : clients.map((client) => client.status),
                nonApi?.status,
              );
              const ops = allOps.filter(
                (op) =>
                  domainMatches ||
                  (op.method + " " + op.path)
                    .toLowerCase()
                    .includes(query.trim().toLowerCase()) ||
                  mapping
                    .get(op.id)
                    ?.capability_ids.some((id) =>
                      caps.some((cap) => cap.id === id),
                    ),
              );
              return (
                <div className="domain-item" key={domain.id}>
                  <button
                    className={
                      "domain-row " +
                      (domainState === "retired" ? "retired-row " : "") +
                      (selected === domain.id ? "selected" : "")
                    }
                    onClick={() =>
                      setSelected(selected === domain.id ? null : domain.id)
                    }
                    aria-expanded={selected === domain.id}
                  >
                    <span className="domain-id">{domain.id}</span>
                    <span className="domain-name">
                      {domain.name}
                      <span className="domain-stage-line">
                        <small>{domain.stage}</small>
                      </span>
                    </span>
                    <span className="domain-count">
                      {nonApi
                        ? "非 API 工作"
                        : view === "legacy"
                          ? `${domain.operation_count} 个方法`
                          : domainState === "retired"
                            ? `${allCaps.length} 项已移除`
                            : `${allCaps.length} 个能力候选`}
                    </span>
                    <span className="domain-state">
                      <MigrationStatus
                        status={domainState}
                        label={
                          domainState === "local_verified" ||
                          domainState === "accepted"
                            ? "已完成"
                            : undefined
                        }
                        domain
                      />
                    </span>
                    {selected === domain.id ? (
                      <Minus size={15} />
                    ) : (
                      <Plus size={15} />
                    )}
                  </button>
                  {selected === domain.id && (
                    <div className="migration-domain-detail">
                      {nonApi && (
                        <div className="capability-body">
                          <p>
                            {nonApi.name} ·{" "}
                            <MigrationStatus status={domainState} />
                          </p>
                          {nonApiStage && (
                            <>
                              <p>{nonApiStage.version}</p>
                              <div>
                                <strong>实现文件</strong>
                                <ul>
                                  {nonApiStage.implementation_files.map(
                                    (file) => (
                                      <li key={file}>
                                        <code>{file}</code>
                                      </li>
                                    ),
                                  )}
                                </ul>
                              </div>
                              <div>
                                <strong>实际入口</strong>
                                <ul>
                                  {nonApiStage.routes.map((route) => (
                                    <li key={route.method + route.path}>
                                      <code>
                                        {route.method} {route.path}
                                      </code>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                              <div>
                                <strong>待验证内容</strong>
                                <ul>
                                  {nonApiStage.pending_validation.map(
                                    (note) => (
                                      <li key={note}>{note}</li>
                                    ),
                                  )}
                                </ul>
                              </div>
                              {!!nonApiStage.remaining_implementation
                                ?.length && (
                                <div>
                                  <strong>尚未实现内容</strong>
                                  <ul>
                                    {nonApiStage.remaining_implementation.map(
                                      (note) => (
                                        <li key={note}>{note}</li>
                                      ),
                                    )}
                                  </ul>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                      {!nonApi &&
                        view === "capabilities" &&
                        (caps.length ? (
                          caps.map((cap) => (
                            <CapabilityDetail
                              key={cap.id}
                              cap={cap}
                              stage={data.implementation_staging?.find(
                                (stage) => stage.key === cap.key,
                              )}
                            />
                          ))
                        ) : (
                          <p className="muted">
                            {plan?.non_api_work.find(
                              (work) => work.feature_id === domain.id,
                            )?.name || "能力映射待核对"}{" "}
                            · 待专项验收
                          </p>
                        ))}
                      {!nonApi && view === "legacy" && (
                        <div className="legacy-bindings">
                          {ops.map((op) => {
                            const links = mapping.get(op.id);
                            return (
                              <details
                                key={op.id}
                                className="capability-detail"
                              >
                                <summary
                                  className={
                                    op.status === "retired"
                                      ? "retired-row"
                                      : undefined
                                  }
                                >
                                  <span>
                                    <code>
                                      {op.method} {op.path}
                                    </code>
                                  </span>
                                  <span className="operation-state">
                                    <MigrationStatus status={op.status} />
                                  </span>
                                </summary>
                                <div className="capability-body">
                                  {links?.source_kind ===
                                    "dispatch_container" && (
                                    <p className="muted">
                                      动态动作容器，能力按子动作登记
                                    </p>
                                  )}
                                  {links?.capability_ids.map((id) => {
                                    const cap = capabilities.get(id);
                                    return (
                                      cap && (
                                        <div
                                          className="mapped-capability"
                                          key={id}
                                        >
                                          <span>{cap.name}</span>
                                          <code>
                                            {cap.method} {cap.proposed_path}
                                          </code>
                                          <span className="muted">
                                            {dispositionLabels[cap.disposition]}
                                          </span>
                                        </div>
                                      )
                                    );
                                  }) || (
                                    <span className="muted">映射待核对</span>
                                  )}
                                </div>
                              </details>
                            );
                          })}
                          {!ops.length && (
                            <p className="muted">无已登记接口，需专项验收</p>
                          )}
                        </div>
                      )}
                      {!nonApi && view === "clients" && (
                        <dl className="migration-client-list">
                          {clients.map(({ client, name, ...progress }) => {
                            return (
                              <div key={client}>
                                <dt>{name}</dt>
                                <dd>
                                  <MigrationStatus {...progress} />
                                </dd>
                              </div>
                            );
                          })}
                        </dl>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {!domains.length && <p className="muted">没有匹配的功能</p>}
          </div>
        </>
      )}
    </>
  );
}
