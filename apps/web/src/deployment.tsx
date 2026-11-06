import { Fragment, useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Moon,
  Sun,
  RefreshCw,
  Github,
  Package,
  SlidersHorizontal,
  GitBranch,
  ShieldCheck,
  ChevronRight,
  CircleCheck,
  CircleX,
  LoaderCircle,
  Clock,
  ExternalLink,
} from "lucide-react";
import { api, ApiError, base, type Session } from "./api";
import { useResource } from "./hooks";
import { usePanelReady } from "./transition-qa";
import { requestId } from "./request-id";
import type { AppearanceController } from "./use-appearance";
import { Dialog } from "./dialog";
import {
  DeploymentHeatmap,
  type DeploymentActivity,
} from "./deployment-heatmap";
import {
  runState,
  formatTime,
  formatDuration,
  workflowLabel,
  buildReceiptMessage,
  canRestartBuild,
  receiptCloseTarget,
  updateNeedsObservation,
  verificationOnly,
  deploymentPollDelay,
  type Deployment,
  type Release,
  type Receipt,
  type WorkflowRun,
} from "./deployment-view";
import {
  DeploymentConfigForm,
  useDeploymentConfig,
  startGithubAuthorization,
} from "./deployment-config";
import { IconPackageExport, IconServerCog } from "./deployment-icons";
import "./deployment.css";
const states: Record<string, string> = {
  queued: "等待执行",
  running: "更新中",
  succeeded: "更新成功",
  failed: "更新失败",
  unknown: "结果待核对",
  cancelled: "记录已关闭",
};
export function DeploymentSettings({
  session,
  appearance,
}: {
  session: Session;
  appearance: AppearanceController;
}) {
  const state = useResource<Deployment>("/deployment");
  const [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const [watchingUpdate, setWatchingUpdate] = useState<string | null>(null);
  const [closing, setClosing] = useState<{
    request_id: string;
    release: Release;
  } | null>(null);
  const buildPending = useRef<string | null>(null);
  const ignoredBuilds = useRef(new Set<string>());
  const ignoredUpdates = useRef(new Set<string>());
  const [buildConfirm, setBuildConfirm] = useState<{
    repository: string;
    revision: string;
    previous: string | null;
  } | null>(null);
  // Keep the UUID after a timeout: only query that receipt; never submit a new request implicitly.
  const pending = useRef<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("verify") === "github") {
      window.history.replaceState(null, "", "/deploy-status");
      window.location.assign(base + "/deployment/github/start");
    } else if (params.has("github_error")) {
      setMessage(params.get("github_error") || "GitHub 授权未完成");
      setConfigOpen(true);
    } else if (params.get("github") === "connected")
      setMessage("GitHub 授权已保存");
  }, []);
  const data = state.data;
  useEffect(() => {
    if (data?.source && data.release?.revision === data.source.sha) {
      if (buildPending.current) {
        buildPending.current = null;
        setMessage("当前 main 已有可用镜像，原构建回执保留在详情中");
      }
      return;
    }
    const last = data?.build_requests[0];
    if (
      !buildPending.current &&
      last &&
      !ignoredBuilds.current.has(last.request_id) &&
      ["dispatching", "unknown"].includes(last.status)
    ) {
      buildPending.current = last.request_id;
      setMessage((previous) => previous || buildReceiptMessage(last));
    }
  }, [data?.build_requests, data?.release?.revision, data?.source?.sha]);
  useEffect(() => {
    const receipt = pending.current
      ? data?.receipts.find((r) => r.request_id === pending.current)
      : data?.receipts.find(
          (r) =>
            !ignoredUpdates.current.has(r.request_id) &&
            updateNeedsObservation(r),
        );
    if (receipt) observeUpdate(receipt);
  }, [data?.receipts]);
  function observeUpdate(receipt: Receipt) {
    setMessage(
      `${receipt.status === "running" ? "已通知 Watchtower，等待容器恢复" : states[receipt.status] || receipt.status} · ${receipt.request_id}`,
    );
    if (["queued", "running", "unknown"].includes(receipt.status)) {
      pending.current = receipt.request_id;
      setWatchingUpdate(
        updateNeedsObservation(receipt) ? receipt.request_id : null,
      );
    } else {
      if (pending.current === receipt.request_id) pending.current = null;
      ignoredUpdates.current.add(receipt.request_id);
      setWatchingUpdate((current) =>
        current === receipt.request_id ? null : current,
      );
    }
  }
  const config = useDeploymentConfig();
  const [page, setPage] = useState(1),
    [configOpen, setConfigOpen] = useState(false);
  const rawHistory = useResource<{
    items: WorkflowRun[];
    total: number | null;
    page: number;
    configured: boolean;
    repository: string;
  }>(`/deployment/history?page=${page}`);
  const rawActivity = useResource<DeploymentActivity>("/deployment/activity");
  const history = {
    ...rawHistory,
    data:
      rawHistory.data?.repository === data?.repository ? rawHistory.data : null,
  };
  const activity = {
    ...rawActivity,
    data:
      rawActivity.data?.repository === data?.repository
        ? rawActivity.data
        : null,
  };
  useEffect(() => {
    setPage(1);
  }, [data?.repository]);
  useEffect(() => {
    document.title = "发布状态 · Alcor";
  }, []);
  usePanelReady("/deploy-status", !!data || !!state.error);
  async function update(original?: string) {
    if ((!original && !pending.current && !data?.release) || busy) return;
    const checking = original || pending.current;
    const id = checking || requestId();
    setBusy(true);
    setMessage("");
    try {
      if (checking) {
        const result = await api<Receipt>(`/deployment/requests/${id}`);
        if (result.request_id !== id)
          throw new Error("更新回执编号不匹配，请核对原请求");
        observeUpdate(result);
      } else {
        pending.current = id;
        const result = await api<Receipt>(
          "/deployment/requests",
          {
            method: "POST",
            body: JSON.stringify({
              request_id: id,
              release: data!.release,
            }),
          },
          session.csrf,
        );
        if (result.request_id !== id)
          throw new Error("更新回执编号不匹配，请核对原请求");
        observeUpdate(result);
      }
      setConfirm(false);
      state.reload();
    } catch (error) {
      if (error instanceof ApiError && error.status === 404 && checking) {
        ignoredUpdates.current.add(id);
        if (pending.current === id) pending.current = null;
        setWatchingUpdate(null);
        setMessage(`未查到此更新回执，未再次通知 Watchtower · ${id}`);
      } else {
        setMessage(error instanceof Error ? error.message : "更新请求失败");
        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408
        )
          pending.current = null;
      }
    } finally {
      setBusy(false);
    }
  }
  async function closeUpdate() {
    if (!closing || busy) return;
    const approval = closing;
    setBusy(true);
    setMessage("");
    try {
      const result = await api<Receipt & { message?: string }>(
        `/deployment/requests/${approval.request_id}/close`,
        {
          method: "POST",
          body: JSON.stringify({ release: approval.release }),
        },
        session.csrf,
      );
      if (
        result.request_id !== approval.request_id ||
        result.status !== "cancelled"
      )
        throw new Error("关闭结果不匹配，请核对原请求");
      observeUpdate(result);
      setMessage(result.message || `更新记录已关闭 · ${result.request_id}`);
      state.reload();
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        error.status >= 500 ||
        error.status === 408
      ) {
        pending.current = approval.request_id;
        setWatchingUpdate(approval.request_id);
        setMessage(`关闭结果待核对，请查询原回执 · ${approval.request_id}`);
        state.reload();
      } else {
        setMessage(error.message);
        state.reload();
      }
    } finally {
      setClosing(null);
      setBusy(false);
    }
  }
  function confirmBuild(previous: string | null = null) {
    if (!data?.source) return;
    setBuildConfirm({
      repository: data.repository,
      revision: data.source.sha,
      previous,
    });
  }
  async function build(approval = buildConfirm) {
    if (busy) return;
    const checking = !approval && !!buildPending.current;
    if (
      !checking &&
      (!approval ||
        !data?.can_build ||
        !checkedSource ||
        sourceCurrent ||
        activeBuild ||
        !!state.error ||
        !!data.source_error ||
        data?.repository !== approval.repository ||
        data?.source?.sha !== approval.revision ||
        (approval.previous &&
          (approval.previous !== buildPending.current ||
            !canRestartBuild(data, approval.previous))))
    ) {
      setBuildConfirm(null);
      setMessage("构建状态已变化，请刷新后重新确认");
      state.reload();
      return;
    }
    if (approval?.previous) ignoredBuilds.current.add(approval.previous);
    if (!checking) buildPending.current = requestId();
    const id = buildPending.current!;
    setBusy(true);
    setMessage("");
    try {
      setMessage(checking ? "正在查询原构建回执…" : "正在提交构建请求…");
      const result = await api<{
        status: string;
        request_id: string;
        message?: string;
      }>(
        checking ? `/deployment/builds/${id}` : "/deployment/builds",
        checking
          ? {}
          : {
              method: "POST",
              body: JSON.stringify({
                request_id: id,
                expected_revision: approval!.revision,
              }),
            },
        session.csrf,
        120000,
      );
      if (result.request_id !== id)
        throw new Error("构建回执编号不匹配，请核对原请求");
      setMessage(`${buildReceiptMessage(result)} · ${result.request_id}`);
      if (["submitted", "failed"].includes(result.status)) {
        ignoredBuilds.current.add(result.request_id);
        buildPending.current = null;
      }
      setBuildConfirm(null);
      state.reload();
    } catch (error) {
      if (checking && error instanceof ApiError && error.status === 404) {
        ignoredBuilds.current.add(id);
        buildPending.current = null;
        setBuildConfirm(null);
        setMessage(`未查到此构建的受理记录，可重新构建 · ${id}`);
        state.reload();
      } else
        setMessage(error instanceof Error ? error.message : "构建请求失败");
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        ![404, 408].includes(error.status)
      )
        buildPending.current = null;
    } finally {
      setBusy(false);
    }
  }
  const buildState = runState(data?.build?.status, data?.build?.conclusion);
  const checkState = runState(data?.check?.status, data?.check?.conclusion);
  const activeBuild = !!data?.build && data.build.status !== "completed";
  const checkedSource =
    !!data?.source &&
    data.check?.sha === data.source.sha &&
    data.check.status === "completed" &&
    data.check?.conclusion === "success";
  const canRebuild =
    !state.error && canRestartBuild(data, buildPending.current);
  const verifyOnly = verificationOnly(data?.jobs);
  const sourceCurrent =
    !!data?.source && data.release?.revision === data.source.sha;
  const runtimeCurrent = !!data?.matches_release;
  const pollDelay = deploymentPollDelay(
    data,
    state.refreshing,
    !!state.error,
    !!watchingUpdate,
  );
  useEffect(() => {
    if (pollDelay === null) return;
    const refreshVisible = () => {
      if (!document.hidden) state.reload();
    };
    const timer = setTimeout(refreshVisible, pollDelay);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [pollDelay, state.refreshing, state.updatedAt, state.error, state.reload]);
  const observedBuild = useRef<{
    repository: string;
    id: number;
    status: string;
  } | null>(null);
  useEffect(() => {
    if (!data?.build) return;
    const next = {
      repository: data.repository,
      id: data.build.id,
      status: data.build.status,
    };
    const prior = observedBuild.current;
    const changed =
      prior &&
      prior.repository === next.repository &&
      (prior.id !== next.id ||
        (prior.status !== next.status && next.status === "completed"));
    // Do not consume a transition while an older history read is still pending.
    if (changed && rawHistory.refreshing) return;
    observedBuild.current = next;
    if (changed) rawHistory.reload();
  }, [
    data?.repository,
    data?.build?.id,
    data?.build?.status,
    rawHistory.refreshing,
    rawHistory.reload,
  ]);
  const repositoryUrl = data?.repository
    ? `https://github.com/${data.repository}`
    : null;
  const packageUrl = data?.package_url || null;
  const pages = Math.max(1, Math.ceil((history.data?.total || 0) / 5));
  const refreshing =
    state.refreshing ||
    history.refreshing ||
    activity.refreshing ||
    config.refreshing;
  function refresh() {
    if (!busy && !buildPending.current && !pending.current && !watchingUpdate)
      setMessage("");
    state.reload();
    history.reload();
    activity.reload();
    config.reload();
  }
  return (
    <main className="deploy-page">
      <div className="deploy-container">
        <header className="deploy-header">
          <div>
            <h1>发布与更新</h1>
          </div>
          <div className="deploy-toolbar">
            <button
              className="deploy-icon"
              aria-label={appearance.mode === "dark" ? "切换浅色" : "切换深色"}
              onClick={() =>
                appearance.update({
                  mode: appearance.mode === "dark" ? "light" : "dark",
                })
              }
            >
              {appearance.mode === "dark" ? <Moon /> : <Sun />}
            </button>
            <button
              className="deploy-icon"
              aria-label="刷新状态"
              disabled={refreshing}
              onClick={refresh}
            >
              <RefreshCw className={refreshing ? "deploy-spinning" : ""} />
            </button>
            <button
              className="deploy-icon"
              aria-label="使用 GitHub 授权，新窗口打开"
              onClick={() =>
                startGithubAuthorization(config.data, (message) => {
                  setMessage(message);
                  setConfigOpen(true);
                })
              }
            >
              <Github />
            </button>
            {packageUrl ? (
              <a
                className="deploy-icon"
                href={packageUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="查看 GHCR 镜像"
              >
                <Package />
              </a>
            ) : (
              <button
                className="deploy-icon"
                aria-label="GHCR 镜像尚未配置"
                disabled
              >
                <Package />
              </button>
            )}
            <button
              className="deploy-icon"
              aria-label="配置账号"
              aria-expanded={configOpen}
              onClick={() => setConfigOpen((v) => !v)}
            >
              <SlidersHorizontal />
            </button>
          </div>
        </header>
        {state.error && (
          <p className="deploy-alert" role="alert">
            {state.error}
            {pollDelay === 15000 && <span> · 稍后自动重试</span>}
          </p>
        )}
        {configOpen && (
          <>
            <DeploymentConfigForm
              session={session}
              onClose={() => setConfigOpen(false)}
            />
            <details className="deploy-release-details">
              <summary>发布详情与回执</summary>
              <dl>
                <div>
                  <dt>运行镜像声明</dt>
                  <dd>{data?.running_image || "未提供"}</dd>
                </div>
                <div>
                  <dt>发布镜像</dt>
                  <dd>{data?.release?.image || "—"}</dd>
                </div>
                <div>
                  <dt>Watchtower</dt>
                  <dd>{data?.runner?.online ? "已连接" : "未连接"}</dd>
                </div>
              </dl>
              {data?.receipts.map((r) => {
                const target = receiptCloseTarget(r);
                return (
                  <p key={r.id}>
                    {states[r.status] || r.status} · {r.request_id}
                    {["unknown", "running", "queued"].includes(r.status) && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void update(r.request_id)}
                      >
                        核对原回执
                      </button>
                    )}
                    {target && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          setClosing({
                            request_id: r.request_id,
                            release: target,
                          })
                        }
                      >
                        关闭记录
                      </button>
                    )}
                  </p>
                );
              })}
              {data?.build_requests.map((r) => (
                <p key={r.request_id}>
                  {buildReceiptMessage(r)} · {r.request_id}
                </p>
              ))}
            </details>
          </>
        )}
        <section
          className="deploy-card deploy-flow"
          aria-labelledby="flow-title"
        >
          <div className="deploy-section-head">
            <h2 id="flow-title">发布流程</h2>
            <NavLink className="deploy-runtime" to="/settings">
              <i
                className={`deploy-dot ${data?.running_revision ? "good" : "neutral"}`}
              />
              线上 {data?.running_revision?.slice(0, 7) || "待核对"}
            </NavLink>
          </div>
          <div className="deploy-flow-steps">
            {repositoryUrl ? (
              <a
                className="deploy-chip"
                href={data?.source?.url || repositoryUrl}
                target="_blank"
                rel="noreferrer"
              >
                <i className="deploy-dot neutral" />
                <GitBranch />
                {data?.source
                  ? `main · ${data.source.sha.slice(0, 7)}`
                  : `${data?.repository.split("/")[1]} main`}
              </a>
            ) : (
              <span className="deploy-chip">
                <i className="deploy-dot neutral" />
                <GitBranch />
                仓库未配置
              </span>
            )}
            <ChevronRight className="deploy-seam" />
            <span className={`deploy-chip ${checkState.tone}`}>
              <i className={`deploy-dot ${checkState.tone}`} />
              <ShieldCheck />
              {data?.check?.conclusion === "success"
                ? "检查通过"
                : data?.check
                  ? checkState.label
                  : "等待检查"}
            </span>
            <ChevronRight className="deploy-seam" />
            <button
              className="deploy-chip deploy-publish"
              aria-busy={busy && !!buildPending.current}
              disabled={
                busy ||
                !data?.can_build ||
                activeBuild ||
                !!state.error ||
                !!data?.source_error ||
                (!buildPending.current && (sourceCurrent || !checkedSource))
              }
              onClick={() =>
                buildPending.current ? void build(null) : confirmBuild()
              }
            >
              <i
                className={`deploy-dot ${activeBuild || (busy && buildPending.current) ? "pending" : sourceCurrent ? "good" : "neutral"}`}
              />
              <IconPackageExport />
              {busy && buildPending.current
                ? "处理构建请求中…"
                : buildPending.current
                  ? "核对构建回执"
                  : activeBuild
                    ? "镜像构建中"
                    : sourceCurrent
                      ? "镜像已是最新"
                      : !checkedSource
                        ? "等待检查通过"
                        : "构建发布镜像"}
            </button>
            <ChevronRight className="deploy-seam" />
            <button
              className="deploy-chip"
              disabled={
                busy || (!pending.current && !data?.can_update) || !!state.error
              }
              onClick={() =>
                pending.current ? void update() : setConfirm(true)
              }
            >
              <i
                className={`deploy-dot ${runtimeCurrent || (data?.release && data?.runner?.online) ? "good" : "neutral"}`}
              />
              <IconServerCog />
              {pending.current
                ? "核对更新回执"
                : runtimeCurrent
                  ? sourceCurrent
                    ? "容器已是最新"
                    : "等待新镜像"
                  : !data?.runner?.online
                    ? "Watchtower 未连接"
                    : data?.release
                      ? "通知更新容器"
                      : "暂无镜像"}
            </button>
          </div>
          {data?.source_error && (
            <p role="status" className="deploy-message">
              {data.source_error}
            </p>
          )}
          {canRebuild && (
            <div className="deploy-message">
              <button
                className="button secondary small"
                disabled={busy || state.refreshing}
                onClick={() => confirmBuild(buildPending.current)}
              >
                重新检查并构建
              </button>
            </div>
          )}
          {data?.release && !data.schema_compatible && (
            <p role="status" className="deploy-message">
              此版本需要单独执行数据库迁移。
            </p>
          )}
        </section>
        <section
          className="deploy-card deploy-progress"
          aria-labelledby="progress-title"
        >
          <div className="deploy-section-head deploy-card-head">
            <div>
              <h2 id="progress-title">镜像构建进度</h2>
              {verifyOnly && (
                <p className="deploy-message">仅验证构建 · 未发布镜像</p>
              )}
              <p>
                {data?.build
                  ? `${data.build.sha.slice(0, 7)} · ${data.jobs?.filter((j) => j.status === "completed").length ?? "—"} / ${data.jobs?.length ?? "—"} 阶段 · ${formatDuration(data.build.started_at, data.build.status === "completed" ? data.build.updated_at : data.checked_at)}`
                  : data?.build_error || "暂无构建记录"}
              </p>
            </div>
            {data?.build && (
              <a
                className="deploy-chip deploy-small"
                href={data.build.url}
                target="_blank"
                rel="noreferrer"
              >
                <StatusIcon
                  status={data.build.status}
                  conclusion={data.build.conclusion}
                />
                {buildState.label}
                <ExternalLink />
              </a>
            )}
          </div>
          <div className="deploy-jobs">
            {data?.jobs?.length ? (
              data.jobs.map((job, index) => (
                <Fragment key={job.id}>
                  <details
                    className="deploy-job"
                    open={job.status !== "completed" ? true : undefined}
                  >
                    <summary>
                      <StatusIcon
                        status={job.status}
                        conclusion={job.conclusion}
                      />
                      <span>
                        <strong>{workflowLabel(job.name)}</strong>
                        <small>
                          {runState(job.status, job.conclusion).label} ·{" "}
                          {formatDuration(
                            job.started_at,
                            job.completed_at || data.checked_at,
                          )}
                        </small>
                      </span>
                      <ChevronRight />
                    </summary>
                    <div className="deploy-job-steps">
                      {job.steps.map((step) => (
                        <div key={step.number}>
                          <StatusIcon
                            status={step.status}
                            conclusion={step.conclusion}
                          />
                          <span>{workflowLabel(step.name)}</span>
                          <small>
                            {formatDuration(
                              step.started_at,
                              step.completed_at || data.checked_at,
                            )}
                          </small>
                        </div>
                      ))}
                    </div>
                  </details>
                  {index < data.jobs!.length - 1 && (
                    <ChevronRight className="deploy-seam" />
                  )}
                </Fragment>
              ))
            ) : (
              <p className="deploy-empty">
                {data?.jobs_error ||
                  (!data?.configured
                    ? "尚未配置发布仓库"
                    : data.build
                      ? "暂无构建阶段"
                      : "暂无构建记录")}
              </p>
            )}
          </div>
        </section>
        <section className="deploy-card deploy-latest">
          <div className="deploy-release-line">
            <i className={`deploy-dot ${data?.release ? "good" : "neutral"}`} />
            <h2>
              最新发布 <span>·</span>{" "}
              {data?.release
                ? "已发布"
                : data?.release_error
                  ? "待核对"
                  : "暂无发布"}
            </h2>
          </div>
          <p>
            {data?.release
              ? data.release.revision.slice(0, 7)
              : data?.release_error ||
                (!data?.configured ? "尚未配置发布仓库" : "暂无发布记录")}
          </p>
          {message && (
            <p role="status" className="deploy-message">
              {message}
            </p>
          )}
        </section>
        <section
          className="deploy-card deploy-history"
          aria-labelledby="history-title"
        >
          <div className="deploy-card-head">
            <div className="deploy-history-title">
              <h2 id="history-title">最近运行</h2>
              {history.data?.total != null && (
                <span className="deploy-count">{history.data.total}</span>
              )}
            </div>
          </div>
          {history.error ? (
            <p role="alert" className="deploy-empty">
              {history.error}
            </p>
          ) : history.data?.items.length ? (
            history.data.items.map((run) => (
              <a
                className="deploy-run"
                key={run.id}
                href={run.url}
                target="_blank"
                rel="noreferrer"
              >
                <i
                  className={`deploy-dot ${runState(run.status, run.conclusion).tone}`}
                />
                <span>
                  <strong>{run.title}</strong>
                  <small>
                    {run.sha.slice(0, 7)} ·{" "}
                    {runState(run.status, run.conclusion).label} ·{" "}
                    {formatTime(run.updated_at)}
                  </small>
                </span>
              </a>
            ))
          ) : (
            <p className="deploy-empty">
              {history.refreshing ? "正在读取运行记录…" : "暂无运行记录"}
            </p>
          )}
          <div className="deploy-pagination">
            <span>
              第 {page} / {pages} 页
              {history.data?.total != null
                ? ` · 共 ${history.data.total} 条`
                : ""}
            </span>
            <div>
              <button
                disabled={page === 1 || history.refreshing}
                onClick={() => setPage((p) => p - 1)}
              >
                上一页
              </button>
              <button
                disabled={page >= pages || page >= 200 || history.refreshing}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </button>
            </div>
          </div>
        </section>
        <DeploymentHeatmap data={activity.data} error={activity.error} />
        {closing && (
          <Dialog
            title="关闭更新记录"
            onClose={() => !busy && setClosing(null)}
          >
            <p>
              关闭 {closing.release.revision.slice(0, 7)} 的更新记录？
              关闭记录不会中止已通知的
              Watchtower；请先确认群晖更新已结束。关闭后可重新检查。
            </p>
            <div className="dialog-actions">
              <button
                className="button"
                onClick={() => setClosing(null)}
                disabled={busy}
              >
                取消
              </button>
              <button
                className="button primary"
                onClick={() => void closeUpdate()}
                disabled={busy}
              >
                关闭记录
              </button>
            </div>
          </Dialog>
        )}
        {buildConfirm && data && (
          <Dialog
            title="确认构建发布"
            onClose={() => !busy && setBuildConfirm(null)}
          >
            <p>
              使用 {buildConfirm.repository} 的 main ·{" "}
              {buildConfirm.revision.slice(0, 7)} 构建并发布镜像？
            </p>
            {buildConfirm.previous && (
              <p>
                原请求结果仍未确认，回执保留。将重新检查 GitHub
                发布状态后提交新请求。
              </p>
            )}
            <div className="dialog-actions">
              <button
                className="button"
                onClick={() => setBuildConfirm(null)}
                disabled={busy}
              >
                取消
              </button>
              <button
                className="button primary"
                onClick={() => void build(buildConfirm)}
                disabled={
                  busy ||
                  !data.can_build ||
                  activeBuild ||
                  !checkedSource ||
                  sourceCurrent ||
                  !!state.error ||
                  !!data.source_error ||
                  data.source?.sha !== buildConfirm.revision ||
                  data.repository !== buildConfirm.repository ||
                  (!!buildConfirm.previous && !canRebuild)
                }
              >
                确认构建
              </button>
            </div>
          </Dialog>
        )}
        {confirm && data?.can_update && (
          <Dialog
            title="确认更新群晖"
            onClose={() => !busy && setConfirm(false)}
          >
            <p>
              通知 Watchtower 更新到 {data.release?.revision.slice(0, 7)}
              ？期间网页与后台任务会短暂中断，恢复后核对实际线上提交。
            </p>
            <div className="dialog-actions">
              <button
                className="button"
                onClick={() => setConfirm(false)}
                disabled={busy}
              >
                取消
              </button>
              <button
                className="button primary"
                onClick={() => void update()}
                disabled={busy}
              >
                确认更新
              </button>
            </div>
          </Dialog>
        )}
      </div>
    </main>
  );
}
function StatusIcon({
  status,
  conclusion,
}: {
  status: string;
  conclusion: string | null;
}) {
  const state = runState(status, conclusion);
  const Icon =
    state.tone === "good"
      ? CircleCheck
      : state.tone === "bad"
        ? CircleX
        : status === "in_progress"
          ? LoaderCircle
          : Clock;
  return (
    <Icon
      aria-hidden="true"
      className={`deploy-status-icon ${state.tone} ${status === "in_progress" ? "deploy-spinning" : ""}`}
    />
  );
}
