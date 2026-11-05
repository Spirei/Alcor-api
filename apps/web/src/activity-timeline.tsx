import { usePageReveal } from "./workspace-ui";
import { Fragment, useEffect, useState } from "react";
import { Dialog } from "./dialog";
import {
  activityLabel,
  activityLevel,
  activityMoment,
  activityDetail,
  type ActivityEntry,
} from "./activity-presentation";
import { feedDateTime } from "./feed-display";
export function ActivityTimeline({
  rows,
  page,
  onPage,
  showUser = false,
}: {
  rows: readonly ActivityEntry[];
  page: number;
  onPage: (page: number) => void;
  showUser?: boolean;
}) {
  const size = 20,
    current = Math.min(page, Math.max(0, Math.ceil(rows.length / size) - 1));
  const [selected, setSelected] = useState<ActivityEntry | null>(null),
    reveal = usePageReveal(current);
  useEffect(() => setSelected(null), [rows, current]);
  const goTo = (page: number) => {
    reveal.request();
    onPage(page);
  };
  let previous = "";
  return (
    <div
      className="activity-timeline activity-log-card"
      role="group"
      aria-label={`活动时间线 · 第 ${current + 1} 页`}
      tabIndex={-1}
      ref={reveal.ref}
    >
      <ol>
        {rows.slice(current * size, (current + 1) * size).map((row) => {
          const at = activityMoment(row.createdAt),
            heading = at.day !== previous;
          previous = at.day;
          const extra = [
            showUser ? row.userName : "",
            activityDetail(row.detail),
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <Fragment key={row.id}>
              {heading && <li className="activity-day">{at.day}</li>}
              <li
                className="activity-event"
                data-level={activityLevel(row.event)}
              >
                <div className="activity-event-content">
                  {activityLevel(row.event) !== "info" && (
                    <span
                      className="activity-dot"
                      aria-label={
                        activityLevel(row.event) === "error"
                          ? "失败或拒绝"
                          : "警告"
                      }
                    />
                  )}
                  <div>
                    <button
                      type="button"
                      className="activity-entry-title"
                      title={row.event}
                      onClick={() => setSelected(row)}
                      aria-label={`查看${activityLabel(row.event)}详情`}
                    >
                      {activityLabel(row.event)}
                    </button>
                    {extra && <p title={extra}>{extra}</p>}
                  </div>
                </div>
                <time dateTime={at.dateTime} title={row.createdAt}>
                  {at.clock}
                </time>
              </li>
            </Fragment>
          );
        })}
      </ol>
      {!rows.length && <p className="activity-empty">暂无匹配的活动</p>}
      {rows.length > size && (
        <div className="workspace-pagination">
          <span>
            第 {current + 1} / {Math.ceil(rows.length / size)} 页 · 已读{" "}
            {rows.length} 条
          </span>
          <button
            type="button"
            disabled={!current}
            onClick={() => goTo(current - 1)}
          >
            上一页
          </button>
          <button
            type="button"
            disabled={(current + 1) * size >= rows.length}
            onClick={() => goTo(current + 1)}
          >
            下一页
          </button>
        </div>
      )}
      {selected && (
        <Dialog
          title="事件详情"
          className="activity-proof-dialog"
          onClose={() => setSelected(null)}
        >
          <dl className="activity-proof">
            <dt>操作</dt>
            <dd>{activityLabel(selected.event)}</dd>
            <dt>时间</dt>
            <dd>{feedDateTime(selected.createdAt)}</dd>
            <dt>记录用户</dt>
            <dd>{selected.userName || "用户未知"}</dd>
            <dt>原始事件</dt>
            <dd>{selected.event}</dd>
            <dt>原始详情</dt>
            <dd className="activity-original">
              {selected.detail || "未记录详情"}
            </dd>
            <dt>记录编号</dt>
            <dd>{selected.id}</dd>
          </dl>
        </Dialog>
      )}
    </div>
  );
}
