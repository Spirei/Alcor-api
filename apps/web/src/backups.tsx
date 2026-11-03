import { BackupScheduleControls } from "./backup-schedule-controls";
import { useLocation } from "react-router-dom";
import { requestId as newRequestId } from "./request-id";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, base } from "./api";
import type { Session, Task } from "./api";
import { useResource, useTaskInvalidation } from "./hooks";
import { Dialog } from "./dialog";
import { SelectMenu } from "./select-menu";

type Backup = {
  id: string;
  software_version: string;
  bytes: number;
  sha256: string;
  created_at: string;
  verified_at: string | null;
  retention_state: "deleted" | "admitted" | "unknown" | null;
  download_available: boolean;
};
type Target = {
  id: string;
  name: string;
  instance_id: string;
  environment: string;
};
type Preview = {
  restore_ticket: string;
  target_id: string;
  target_name: string;
  instance_id: string;
  environment: string;
  tables: number;
  files: number;
  bytes: number;
};
const names: Record<string, string> = {
  "backup.create": "创建备份",
  "backup.verify": "校验备份",
  "backup.restore": "恢复备份",
};
const states: Record<string, string> = {
  queued: "等待执行",
  running: "执行中",
  cancel_requested: "等待取消",
  cancelled: "已取消",
  succeeded: "已完成",
  failed: "失败",
};
const terminal = new Set(["cancelled", "succeeded", "failed"]);

function JobReceipt({
  requestId,
  storageKey,
  onBusy,
  onDone,
  retry,
}: {
  requestId: string;
  storageKey: string;
  onBusy: (busy: boolean) => void;
  onDone: () => void;
  retry: (() => void) | null;
}) {
  const resource = useResource<Task>("/tasks/receipts/" + requestId, true);
  const done = useRef("");
  useEffect(() => {
    if (!resource.data) return;
    const active = !terminal.has(resource.data.status);
    onBusy(active);
    if (!active && done.current !== requestId) {
      done.current = requestId;
      try {
        sessionStorage.removeItem(storageKey);
      } catch {}
      onDone();
    }
  }, [resource.data, requestId, storageKey, onBusy, onDone]);
  return (
    <section className="card padded backup-receipt" aria-label="任务回执">
      {resource.data ? (
        <>
          <div className="backup-job-heading">
            <h2>{names[resource.data.kind] || "任务"}</h2>
            <span>{states[resource.data.status] || resource.data.status}</span>
          </div>
          {typeof resource.data.result?.message === "string" && (
            <div
              className={
                resource.data.status === "failed"
                  ? "notice error"
                  : "connection-result"
              }
              role="status"
            >
              {resource.data.result.message}
            </div>
          )}
          {resource.data.error_code && !resource.data.result?.message && (
            <div className="notice error" role="alert">
              {resource.data.error_code}
            </div>
          )}
          <details>
            <summary>回执</summary>
            <dl>
              <dt>任务编号</dt>
              <dd>{resource.data.id}</dd>
              <dt>请求编号</dt>
              <dd>{requestId}</dd>
            </dl>
          </details>
        </>
      ) : (
        <div role="status">结果待核对</div>
      )}
      {resource.error && (
        <div className="notice error" role="alert">
          {resource.error}
        </div>
      )}
      {!resource.data && (
        <div className="backup-recovery">
          <button
            type="button"
            className="text-button"
            onClick={resource.reload}
          >
            核对原请求
          </button>
          {retry && (
            <button type="button" className="text-button" onClick={retry}>
              重试原请求
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function BackupsPage({ session }: { session: Session }) {
  const location = useLocation();
  const resource = useResource<{
    items: Backup[];
    targets: Target[];
    configured: boolean;
  }>("/backups", true);
  const invalidate = useTaskInvalidation();
  const storageKey = `alcor.backup.${session.instance_id}.${session.user.id}`;
  const [requestId, setRequestId] = useState<string | null>(() => {
    try {
      const value = sessionStorage.getItem(storageKey);
      return value && /^[a-f0-9-]{36}$/.test(value) ? value : null;
    } catch {
      return null;
    }
  });
  const [active, setActive] = useState(!!requestId),
    [dispatching, setDispatching] = useState(false),
    [error, setError] = useState("");
  const [restore, setRestore] = useState<Backup | null>(null),
    [targetId, setTargetId] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [checking, setChecking] = useState(false);
  const original = useRef<string | null>(null);
  const busy = dispatching || active;
  useEffect(
    () => () => {
      setRestore(null);
      setPreview(null);
      original.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!resource.data && resource.error) {
      setRestore(null);
      setPreview(null);
      original.current = null;
    }
  }, [resource.data, resource.error]);
  async function dispatch(body: string) {
    setDispatching(true);
    setError("");
    try {
      await api("/tasks", { method: "POST", body }, session.csrf);
      invalidate();
      setRestore(null);
      setPreview(null);
      original.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
      if (
        e instanceof ApiError &&
        [400, 401, 403, 409, 422, 429].includes(e.status)
      ) {
        try {
          sessionStorage.removeItem(storageKey);
        } catch {}
        setRequestId(null);
        setActive(false);
        original.current = null;
      }
      if (e instanceof ApiError && [401, 403].includes(e.status))
        resource.reload();
    } finally {
      setDispatching(false);
    }
  }
  function submit(kind: string, payload: Record<string, unknown> = {}) {
    if (busy) return;
    const id = newRequestId(),
      body = JSON.stringify({ request_id: id, kind, ...payload });
    try {
      sessionStorage.setItem(storageKey, id);
    } catch {}
    original.current = body;
    setRequestId(id);
    setActive(true);
    void dispatch(body);
  }
  async function checkTarget() {
    if (!restore || !targetId || checking) return;
    setChecking(true);
    setError("");
    try {
      setPreview(
        await api<Preview>(
          `/backups/${restore.id}/restore-preview?target_id=${encodeURIComponent(targetId)}`,
        ),
      );
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "目标核对失败");
      if (e instanceof ApiError && [401, 403].includes(e.status)) {
        setRestore(null);
        resource.reload();
      }
    } finally {
      setChecking(false);
    }
  }
  async function download(backup: Backup) {
    if (backup.download_available === false) return;
    setError("");
    try {
      const response = await fetch(`${base}/backups/${backup.id}/download`, {
        credentials: "same-origin",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (response.status === 401)
          window.dispatchEvent(new Event("alcor:session-expired"));
        if (response.status === 403) resource.reload();
        throw new Error(data?.error?.message || "下载失败");
      }
      const url = URL.createObjectURL(await response.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = `alcor-${backup.id}.enc`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "下载失败");
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>备份恢复</h1>
        <button
          className="button primary"
          disabled={busy || !resource.data?.configured}
          onClick={() => submit("backup.create")}
        >
          {dispatching ? "提交中…" : "创建备份"}
        </button>
      </div>
      <BackupScheduleControls session={session} active={location.pathname === "/backups"} />
      {(resource.error || error) && (
        <div className="notice error" role="alert">
          {error || resource.error}
        </div>
      )}
      {resource.data && !resource.data.configured && (
        <div className="notice" role="status">
          备份存储未配置
        </div>
      )}
      {requestId && (
        <JobReceipt
          requestId={requestId}
          storageKey={storageKey}
          onBusy={setActive}
          onDone={resource.reload}
          retry={
            original.current
              ? () => {
                  if (original.current) void dispatch(original.current);
                }
              : null
          }
        />
      )}
      {resource.data && (
        <div className="access-list">
          {resource.data.items.length ? (
            resource.data.items.map((backup) => (
              <section className="backup-row" key={backup.id}>
                <div className="backup-row-heading">
                  <h2>{new Date(backup.created_at).toLocaleString("zh-CN")}</h2>
                  <span className="muted">
                    {(backup.bytes / 1024).toFixed(1)} KB · v
                    {backup.software_version}
                  </span>
                </div>
                {backup.retention_state && <p role="status">{backup.retention_state === "deleted" ? "已按保留策略移除文件；历史与回执保留" : "保留策略执行结果待核对，暂不可下载或恢复"}</p>}
                <div className="backup-row-actions">
                  <button
                    className="text-button"
                    disabled={busy || backup.download_available === false}
                    onClick={() =>
                      submit("backup.verify", { backup_id: backup.id })
                    }
                  >
                    校验
                  </button>
                  <button
                    className="text-button"
                    disabled={backup.download_available === false}
                    onClick={() => void download(backup)}
                  >
                    下载
                  </button>
                  <button
                    className="text-button"
                    disabled={busy || backup.download_available === false}
                    onClick={() => {
                      setRestore(backup);
                      setTargetId(resource.data?.targets[0]?.id || "");
                      setPreview(null);
                      setError("");
                    }}
                  >
                    恢复到隔离目标
                  </button>
                </div>
                <details>
                  <summary>详情</summary>
                  <dl>
                    <dt>备份编号</dt>
                    <dd>{backup.id}</dd>
                    <dt>SHA-256</dt>
                    <dd>{backup.sha256}</dd>
                    <dt>最后校验</dt>
                    <dd>
                      {backup.verified_at
                        ? new Date(backup.verified_at).toLocaleString("zh-CN")
                        : "尚未校验"}
                    </dd>
                  </dl>
                </details>
              </section>
            ))
          ) : (
            <div className="empty">
              <h3>暂无备份</h3>
            </div>
          )}
        </div>
      )}
      {restore && (
        <Dialog
          title="恢复到隔离目标"
          onClose={() => {
            if (!checking && !dispatching) {
              setRestore(null);
              setPreview(null);
            }
          }}
        >
          <div className="dialog-content access-form">
            {resource.data?.targets.length ? (
              <>
                <div>
                  <label>恢复目标</label>
                  <SelectMenu
                    label="恢复目标"
                    value={targetId}
                    variant="field"
                    disabled={checking || !!preview}
                    options={resource.data.targets.map((t) => ({
                      value: t.id,
                      label: t.name,
                    }))}
                    onChange={(value) => {
                      setTargetId(value);
                      setPreview(null);
                    }}
                  />
                </div>
                {preview && (
                  <dl className="backup-preview">
                    <dt>目标</dt>
                    <dd>{preview.target_name}</dd>
                    <dt>实例</dt>
                    <dd>{preview.instance_id}</dd>
                    <dt>数据</dt>
                    <dd>
                      {preview.tables} 张表 · {preview.files} 个文件
                    </dd>
                    <dt>恢复后</dt>
                    <dd>会话和客户端授权失效，原连接配置隔离保存</dd>
                  </dl>
                )}
                {error && (
                  <div className="notice error" role="alert">
                    {error}
                  </div>
                )}
                <div className="dialog-actions">
                  <button
                    className="button secondary"
                    disabled={checking || dispatching}
                    onClick={() => {
                      setRestore(null);
                      setPreview(null);
                    }}
                  >
                    取消
                  </button>
                  {preview ? (
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() =>
                        submit("backup.restore", {
                          backup_id: restore.id,
                          target_id: preview.target_id,
                          restore_ticket: preview.restore_ticket,
                        })
                      }
                    >
                      确认恢复
                    </button>
                  ) : (
                    <button
                      className="button primary"
                      disabled={checking || !targetId}
                      onClick={() => void checkTarget()}
                    >
                      {checking ? "核对中…" : "核对目标"}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div role="status">暂无已登记的隔离目标</div>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
