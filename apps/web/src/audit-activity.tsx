import "./audit-activity.css";
import "./portfolio.css";
import { DailyActivitySummary } from "./daily-activity-summary";
import { useLocation } from "react-router-dom";
import { RequestObservations } from "./request-observations";
import { useState } from "react";
import type { Session } from "./api";
import { useResource } from "./hooks";
import { usePanelReady } from "./transition-qa";
import { WorkspaceTabs, WorkspaceView } from "./workspace-ui";
import { ActivityTimeline } from "./activity-timeline";

type Entry = {
  id: string;
  event: string;
  detail: string;
  createdAt: string;
  userName: string;
};
type Activity = { userLogs: Entry[]; systemLogs: Entry[] };
type Declaration = {
  id: string;
  sourceId: string;
  originalId: string;
  source: string;
  platformAudit: false;
  original: Record<string, unknown>;
};

function ImportedActivity() {
  const [offset, setOffset] = useState(0);
  const { data, error, reload } = useResource<{
    items: Declaration[];
    hasMore: boolean;
    nextOffset: number | null;
  }>(`/activities/imported?offset=${offset}`);
  return (
    <details>
      <summary>导入的旧活动声明</summary>
      <p>这些记录来自本人导入原件，保留原时间与内容；平台执行审计单独展示。</p>
      <button type="button" className="button secondary small" onClick={reload}>
        重新读取
      </button>
      {error && <p role="alert">{error}</p>}
      {data?.items.map((row) => (
        <details key={row.id}>
          <summary>
            {String(row.original.created_at ?? "原时间未知")} ·{" "}
            {String(row.original.action ?? "旧活动")}
          </summary>
          <p>
            原编号 {row.originalId} · 原件 {row.sourceId}
          </p>
          <pre>{JSON.stringify(row.original, null, 2)}</pre>
        </details>
      ))}
      {data && !data.items.length && <p>没有导入声明</p>}
      {offset > 0 && (
        <button
          type="button"
          onClick={() => setOffset(Math.max(0, offset - 200))}
        >
          上一页
        </button>
      )}
      {data?.hasMore && data.nextOffset !== null && (
        <button type="button" onClick={() => setOffset(data.nextOffset!)}>
          下一页
        </button>
      )}
    </details>
  );
}

export function ActivityPage({ session }: { session: Session }) {
  const location = useLocation();
  const { data, error, reload } = useResource<Activity>("/activities");
  const [system, setSystem] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState("activity"),
    [page, setPage] = useState(0);
  usePanelReady("/activity", Boolean(data));
  const rows =
    (session.user.role === "admin" && system
      ? data?.systemLogs
      : data?.userLogs) || [];
  const filtered = rows.filter((row) =>
    `${row.event} ${row.detail} ${row.userName}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <section className="audit-activity">
      <div className="page-heading">
        <h1>活动</h1>
        <button className="button secondary" onClick={reload}>
          重新读取
        </button>
      </div>
      <WorkspaceTabs
        label="活动视图"
        value={view}
        onChange={setView}
        items={[
          { value: "activity", label: "活动时间线" },
          { value: "summary", label: "每日摘要" },
          { value: "imported", label: "旧活动声明" },
          ...(session.user.role === "admin"
            ? [{ value: "requests", label: "请求观察" }]
            : []),
        ]}
      />
      <WorkspaceView active={view === "summary"} label="每日摘要">
        <DailyActivitySummary
          session={session}
          active={location.pathname === "/activity" && view === "summary"}
        />
      </WorkspaceView>
      <WorkspaceView active={view === "imported"} label="旧活动声明">
        <ImportedActivity
          key={JSON.stringify([
            session.instance_id,
            session.user.id,
            session.csrf,
          ])}
        />
      </WorkspaceView>
      <WorkspaceView active={view === "requests"} label="请求观察">
        {session.user.role === "admin" && <RequestObservations />}
      </WorkspaceView>
      <WorkspaceView active={view === "activity"} label="活动时间线">
        <div className="activity-filters">
          <div className="module-actions">
            <input
              aria-label="查找活动"
              placeholder="查找活动"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
          </div>
          {session.user.role === "admin" && (
            <div
              className="audit-activity-range"
              role="group"
              aria-label="活动范围"
            >
              <button
                type="button"
                className="button secondary small"
                aria-pressed={!system}
                onClick={() => {
                  setSystem(false);
                  setPage(0);
                }}
              >
                本人活动
              </button>
              <button
                type="button"
                className="button secondary small"
                aria-pressed={system}
                onClick={() => {
                  setSystem(true);
                  setPage(0);
                }}
              >
                系统活动
              </button>
            </div>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
        {!data && !error && <p role="status">正在读取…</p>}
        {data && (
          <ActivityTimeline rows={filtered} page={page} onPage={setPage} />
        )}
      </WorkspaceView>
    </section>
  );
}
