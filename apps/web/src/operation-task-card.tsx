import { useId, type CSSProperties, type ReactNode } from "react";
import {
  Archive,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  FileInput,
  GitCompareArrows,
  History,
  ListChecks,
  RefreshCw,
  ScanLine,
  Server,
  Smartphone,
  Workflow,
} from "lucide-react";
import "./operation-task-card.css";

export type OperationState =
  "idle" | "running" | "confirm" | "success" | "failed" | "unknown" | "partial";

export type OperationEvent = { label: string; at?: string };
export type OperationHistoryItem = {
  id: string;
  title: string;
  status: OperationState;
  statusLabel?: string;
  createdAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  target?: string;
  message?: string;
  requestId?: string;
  taskId?: string | null;
  fields?: { label: string; value: string }[];
  events?: OperationEvent[];
};

const stateLabels: Record<OperationState, string> = {
  idle: "未开始",
  running: "执行中",
  confirm: "等待确认",
  success: "已完成",
  failed: "失败",
  unknown: "结果待核对",
  partial: "部分完成",
};
const stageIcons = [ScanLine, GitCompareArrows, Workflow, ListChecks];

function validDate(value: string | null | undefined) {
  if (!value?.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function timeLabel(value: string | null | undefined) {
  const date = validDate(value);
  return date
    ? date.toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
    : "未知";
}

function durationLabel(item: OperationHistoryItem) {
  const start = validDate(item.startedAt);
  const finish = validDate(item.finishedAt);
  if (!start || !finish || finish.getTime() < start.getTime())
    return "用时未知";
  const seconds = (finish.getTime() - start.getTime()) / 1000;
  return seconds < 60
    ? `${seconds.toFixed(1)} 秒`
    : `${Math.floor(seconds / 60)} 分 ${Math.floor(seconds % 60)} 秒`;
}

function Endpoint({ name }: { name: string }) {
  const Icon = /文件|归档|备份/.test(name)
    ? Archive
    : /App|iOS|设备/i.test(name)
      ? Smartphone
      : /恢复|数据库/.test(name)
        ? Database
        : /导入/.test(name)
          ? FileInput
          : Server;
  return (
    <div className="operation-task-endpoint">
      <span className="operation-task-endpoint-icon">
        <Icon size={20} strokeWidth={1.5} aria-hidden="true" />
      </span>
      <span>{name}</span>
    </div>
  );
}

function EventList({ events }: { events: OperationEvent[] }) {
  return (
    <ol className="operation-task-events">
      {events.map((event, index) => (
        <li key={`${event.at ?? "unknown"}-${index}`}>
          <span className="operation-task-event-mark" aria-hidden="true" />
          <div>
            <span>{event.label}</span>
            {event.at !== undefined && (
              <time dateTime={validDate(event.at) ? event.at : undefined}>
                {timeLabel(event.at)}
              </time>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function OperationTaskCard({
  title,
  source,
  target,
  steps,
  state,
  currentStep,
  statusLabel,
  message,
  requestId,
  events = [],
  children,
}: {
  title: string;
  source: string;
  target: string;
  steps: string[];
  state: OperationState;
  currentStep?: number;
  statusLabel?: string;
  message?: string;
  requestId?: string;
  events?: OperationEvent[];
  children?: ReactNode;
}) {
  const headingId = useId();
  const stageKnown =
    Number.isInteger(currentStep) &&
    currentStep! >= 0 &&
    currentStep! < steps.length;
  const position =
    state === "success"
      ? 1
      : stageKnown && steps.length > 1
        ? currentStep! / (steps.length - 1)
        : 0;
  const style = { "--operation-position": position } as CSSProperties;
  const currentLabel =
    state === "success"
      ? statusLabel || stateLabels.success
      : stageKnown
        ? steps[currentStep!]
        : statusLabel || stateLabels[state];
  return (
    <section
      className="operation-task-card"
      aria-labelledby={headingId}
      data-state={state}
      style={style}
    >
      <div className="operation-task-main">
        <header className="operation-task-heading">
          <h2 id={headingId}>{title}</h2>
          <span className="operation-task-status" data-state={state}>
            {statusLabel || stateLabels[state]}
          </span>
        </header>
        <div className="operation-task-route" aria-label="来源与目标">
          <Endpoint name={source} />
          <span className="operation-task-bridge" aria-hidden="true" />
          <Endpoint name={target} />
        </div>
        {steps.length > 0 && (
          <>
            <ol
              className="operation-task-steps"
              style={{
                gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
              }}
              aria-label="任务阶段"
            >
              {steps.map((label, index) => {
                const done =
                  state === "success" || (stageKnown && index < currentStep!);
                const current =
                  state !== "success" && stageKnown && index === currentStep;
                const Icon = stageIcons[index % stageIcons.length];
                return (
                  <li
                    key={`${label}-${index}`}
                    className={
                      done ? "is-done" : current ? "is-current" : undefined
                    }
                    aria-current={current ? "step" : undefined}
                    aria-label={`${label}，${done ? "已完成" : current ? (state === "running" ? "当前阶段" : stateLabels[state]) : "尚未核对"}`}
                  >
                    <span className="operation-task-step-icon">
                      <Icon size={17} strokeWidth={1.5} aria-hidden="true" />
                      {done && (
                        <span className="operation-task-step-check">
                          <Check size={10} strokeWidth={2} aria-hidden="true" />
                        </span>
                      )}
                    </span>
                    <span>{label}</span>
                  </li>
                );
              })}
            </ol>
            <div className="operation-task-track-space">
              <div
                className="operation-task-track"
                role="progressbar"
                aria-label="任务阶段"
                aria-valuemin={0}
                aria-valuemax={steps.length}
                aria-valuenow={
                  state === "success"
                    ? steps.length
                    : stageKnown && state !== "unknown"
                      ? currentStep
                      : undefined
                }
                aria-valuetext={
                  state === "success"
                    ? statusLabel || stateLabels.success
                    : stageKnown
                      ? `${currentLabel}，${statusLabel || stateLabels[state]}`
                      : "当前阶段待核对"
                }
              >
                <span className="operation-task-track-fill" />
                <span className="operation-task-track-carrier">
                  <span className="operation-task-track-dot" />
                </span>
              </div>
            </div>
          </>
        )}
        <div className="operation-task-focus" role="status" aria-live="polite">
          <span className="operation-task-current">{currentLabel}</span>
          {message && <p>{message}</p>}
        </div>
        {events.length > 0 && (
          <div className="operation-task-log">
            <h3>任务动态</h3>
            <EventList events={events.slice(-3)} />
            {events.length > 3 && (
              <details className="operation-task-full-events">
                <summary>全部动态（{events.length}）</summary>
                <EventList events={events} />
              </details>
            )}
          </div>
        )}
        {requestId && (
          <details className="operation-task-receipt">
            <summary>原请求回执</summary>
            <dl>
              <dt>请求编号</dt>
              <dd>{requestId}</dd>
            </dl>
          </details>
        )}
      </div>
      {children && <div className="operation-task-actions">{children}</div>}
    </section>
  );
}

export function OperationHistory({
  title = "任务记录",
  items,
  loading = false,
  error,
  onReload,
  hasPrevious = false,
  hasNext = false,
  onPrevious,
  onNext,
  page = 1,
  onOpenTask,
}: {
  title?: string;
  items: OperationHistoryItem[];
  loading?: boolean;
  error?: string;
  onReload?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  page?: number;
  onOpenTask?: (id: string) => void;
}) {
  const headingId = useId();
  return (
    <section
      className="operation-history"
      aria-labelledby={headingId}
      aria-busy={loading}
    >
      <header className="operation-history-heading">
        <h2 id={headingId}>
          <History size={16} strokeWidth={1.5} aria-hidden="true" />
          {title}
        </h2>
        {onReload && (
          <button
            type="button"
            className="icon-button"
            aria-label={`刷新${title}`}
            disabled={loading}
            onClick={onReload}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        )}
      </header>
      {error && (
        <p className="operation-history-error" role="alert">
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <p className="operation-history-empty" role="status">
          {loading
            ? "正在读取任务记录"
            : error
              ? "任务记录未能读取"
              : "暂无任务记录"}
        </p>
      ) : (
        <div className="operation-history-records">
          {items.map((item) => (
            <details
              className="operation-history-record"
              key={item.id}
              data-state={item.status}
            >
              <summary>
                <span className="operation-history-when">
                  <time
                    dateTime={
                      validDate(item.createdAt) ? item.createdAt! : undefined
                    }
                  >
                    {timeLabel(item.createdAt)}
                  </time>
                  <span>{durationLabel(item)}</span>
                </span>
                <span className="operation-history-object">
                  <strong>{item.title}</strong>
                  {item.target && <span>{item.target}</span>}
                </span>
                <span
                  className="operation-task-status"
                  data-state={item.status}
                >
                  {item.statusLabel || stateLabels[item.status]}
                </span>
                <ChevronDown
                  size={15}
                  className="operation-history-chevron"
                  aria-hidden="true"
                />
              </summary>
              <div className="operation-history-detail">
                <dl>
                  <dt>创建时间</dt>
                  <dd>{timeLabel(item.createdAt)}</dd>
                  <dt>开始时间</dt>
                  <dd>{timeLabel(item.startedAt)}</dd>
                  <dt>结束时间</dt>
                  <dd>{timeLabel(item.finishedAt)}</dd>
                  {item.requestId && (
                    <>
                      <dt>请求编号</dt>
                      <dd className="operation-history-request">
                        {item.requestId}
                      </dd>
                    </>
                  )}
                  {item.fields?.map((field, index) => (
                    <div
                      className="operation-history-field"
                      key={`${field.label}-${index}`}
                    >
                      <dt>{field.label}</dt>
                      <dd>{field.value}</dd>
                    </div>
                  ))}
                  {item.message && (
                    <>
                      <dt>消息</dt>
                      <dd
                        className={
                          item.status === "failed"
                            ? "operation-history-error"
                            : undefined
                        }
                      >
                        {item.message}
                      </dd>
                    </>
                  )}
                </dl>
                {onOpenTask &&
                  item.taskId &&
                  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(
                    item.taskId,
                  ) && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => onOpenTask(item.taskId!)}
                    >
                      查看完整任务回执
                    </button>
                  )}
                {item.events?.length ? (
                  <EventList events={item.events} />
                ) : null}
              </div>
            </details>
          ))}
        </div>
      )}
      {(onPrevious || onNext) && (
        <footer className="operation-history-pagination">
          <span>第 {Number.isSafeInteger(page) && page > 0 ? page : 1} 页</span>
          <div>
            <button
              type="button"
              className="icon-button"
              aria-label={`上一页${title}`}
              disabled={!hasPrevious || loading || !onPrevious}
              onClick={onPrevious}
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`下一页${title}`}
              disabled={!hasNext || loading || !onNext}
              onClick={onNext}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}
