import {
  useDeploymentVerification,
  requiresDeploymentVerification,
} from "./deployment-verification";
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
  cancelled: "已取消",
};
export function DeploymentSettings({
  session,
  appearance,
}: {
  session: Session;
  appearance: AppearanceController;
}) {
  const verification = useDeploymentVerification(session, () => {
    state.reload();
    setConfigOpen(false);
  });
  const state = useResource<Deployment>("/deployment");
  const [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const [watchingUpdate, setWatchingUpdate] = useState<string | null>(null);
  const buildPending = useRef<string | null>(null);
  const [buildConfirm, setBuildConfirm] = useState(false);
  // Keep the UUID after a timeout: only query that receipt; never submit a new request implicitly.
  const pending = useRef<{ id: string; release: Release } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("verify") === "github") {
      window.history.replaceState(null, "", "/deploy-status");
      verification.request(() => {
        window.location.assign(base + "/deployment/github/start");
      });
    } else if (params.has("github_error")) {
      setMessage(params.get("github_error") || "GitHub 授权未完成");
      setConfigOpen(true);
    } else if (params.get("github") === "connected")
      setMessage("GitHub 授权已保存");
  }, []);
  const data = state.data;
  useEffect(() => {
    if (!watchingUpdate) return;
    const receipt = data?.receipts.find((r) => r.request_id === watchingUpdate);
    if (!receipt) return;
    setMessage(
      `${states[receipt.status] || receipt.status} · ${receipt.request_id}`,
    );
    if (!["queued", "running"].includes(receipt.status))
      setWatchingUpdate(null);
  }, [watchingUpdate, data?.receipts]);
  function observeUpdate(receipt: Receipt) {
    setMessage(
      `${states[receipt.status] || receipt.status} · ${receipt.request_id}`,
    );
    setWatchingUpdate(
      ["queued", "running"].includes(receipt.status)
        ? receipt.request_id
        : null,
    );
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
  async function update(resume?: { id: string; release: Release }) {
    if (!data?.release || busy) return;
    setBusy(true);
    setMessage("");
    try {
      if (pending.current && !resume) {
        const result = await api<Receipt>(
          `/deployment/requests/${pending.current.id}`,
        );
        observeUpdate(result);
        pending.current = null;
      } else {
        pending.current = resume || { id: requestId(), release: data.release };
        const result = await api<Receipt>(
          "/deployment/requests",
          {
            method: "POST",
            body: JSON.stringify({
              request_id: pending.current.id,
              release: pending.current.release,
            }),
          },
          session.csrf,
        );
        observeUpdate(result);
        pending.current = null;
      }
      setConfirm(false);
      state.reload();
    } catch (error) {
      if (requiresDeploymentVerification(error) && pending.current) {
        const attempt = pending.current;
        pending.current = null;
        setConfirm(false);
        verification.request(() => update(attempt));
      } else if (
        error instanceof ApiError &&
        error.status === 404 &&
        pending.current
      ) {
        setMessage(`尚未查到回执，请稍后核对：${pending.current.id}`);
      } else {
        setMessage(error instanceof Error ? error.message : "更新请求失败");
        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500
        )
          pending.current = null;
      }
    } finally {
      setBusy(false);
    }
  }
  async function build(resumeId?: string) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const checking = !resumeId && !!buildPending.current;
      if (resumeId || !buildPending.current)
        buildPending.current = resumeId || requestId();
      const result = await api<{ status: string; request_id: string }>(
        checking
          ? `/deployment/builds/${buildPending.current}`
          : "/deployment/builds",
        checking
          ? {}
          : {
              method: "POST",
              body: JSON.stringify({ request_id: buildPending.current }),
            },
        session.csrf,
      );
      setMessage(
        `${result.status === "submitted" ? "构建请求已提交" : "构建结果待核对"} · ${result.request_id}`,
      );
      buildPending.current = null;
      setBuildConfirm(false);
      state.reload();
    } catch (error) {
      if (requiresDeploymentVerification(error) && buildPending.current) {
        const attempt = buildPending.current;
        buildPending.current = null;
        setBuildConfirm(false);
        verification.request(() => build(attempt));
        return;
      }
      setMessage(error instanceof Error ? error.message : "构建请求失败");
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 404
      )
        buildPending.current = null;
    } finally {
      setBusy(false);
    }
  }
  const buildState = runState(data?.build?.status, data?.build?.conclusion);
  const checkState = runState(data?.check?.status, data?.check?.conclusion);
  const activeBuild = !!data?.build && data.build.status !== "completed";
  const sourceCurrent =
    !!data?.source && data.release?.revision === data.source.sha;
  const runtimeCurrent = !!data?.matches_release;
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
                  <dt>群晖执行器</dt>
                  <dd>{data?.runner?.online ? "已连接" : "未连接"}</dd>
                </div>
              </dl>
              {data?.receipts.map((r) => (
                <p key={r.id}>
                  v{r.version} · {states[r.status] || r.status} · {r.request_id}
                </p>
              ))}
              {data?.build_requests.map((r) => (
                <p key={r.request_id}>
                  {r.status === "submitted"
                    ? "构建请求已提交"
                    : "构建结果待核对"}{" "}
                  · {r.request_id}
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
              <i className="deploy-dot good" />
              运行 v{data?.running_version || "—"}
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
              disabled={
                busy ||
                !data?.can_build ||
                activeBuild ||
                !!state.error ||
                !!data?.source_error
              }
              onClick={() =>
                buildPending.current ? void build() : setBuildConfirm(true)
              }
            >
              <i
                className={`deploy-dot ${activeBuild ? "pending" : sourceCurrent ? "good" : "neutral"}`}
              />
              <IconPackageExport />
              {buildPending.current
                ? "核对构建回执"
                : activeBuild
                  ? "镜像构建中"
                  : sourceCurrent
                    ? "镜像已是最新"
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
                  ? "容器已是最新"
                  : !data?.runner?.online
                    ? "执行器未连接"
                    : data?.release
                      ? "有新镜像"
                      : "暂无镜像"}
            </button>
          </div>
          {data?.source_error && (
            <p role="status" className="deploy-message">
              {data.source_error}
            </p>
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
              ? `v${data.release.version} · ${data.release.revision.slice(0, 7)}`
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
        {verification.dialog}
        {buildConfirm && data && (
          <Dialog title="确认构建发布" onClose={() => setBuildConfirm(false)}>
            <p>使用 {data.repository} 的 main 分支源码构建并发布镜像？</p>
            <div className="dialog-actions">
              <button
                className="button"
                onClick={() => setBuildConfirm(false)}
                disabled={busy}
              >
                取消
              </button>
              <button
                className="button primary"
                onClick={() => void build()}
                disabled={
                  busy || !data.can_build || activeBuild || !!state.error
                }
              >
                确认构建
              </button>
            </div>
          </Dialog>
        )}
        {confirm && data?.can_update && (
          <Dialog title="确认更新群晖" onClose={() => setConfirm(false)}>
            <p>
              更新到 v{data.release?.version}？期间网页与后台任务会短暂中断。
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
