import { LoadingPlaceholder } from "./loading-placeholder";
import "./audit-activity.css";
import "./portfolio.css";
import { DailyActivitySummary } from "./daily-activity-summary";
import { useLocation, useNavigate } from "react-router-dom";
import { RefreshCw, Search } from "lucide-react";
import {
  activitySelection,
  activitySearch,
  activityLabel,
} from "./activity-presentation";
import { Dialog } from "./dialog";
import { feedDateTime } from "./feed-display";
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
  const [offset, setOffset] = useState(0),
    [subpage, setSubpage] = useState(0);
  const { data, error, reload } = useResource<{
    items: Declaration[];
    hasMore: boolean;
    nextOffset: number | null;
  }>(`/activities/imported?offset=${offset}`);
  const [selected, setSelected] = useState<Declaration | null>(null);
  return (
    <section className="activity-imported">
      <div className="activity-section-heading">
        <h2>本人导入的旧活动声明</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="刷新旧活动声明"
          onClick={reload}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      <p>这些记录来自本人导入原件，保留原时间与内容；平台执行审计单独展示。</p>
      {error && <p role="alert">{error}</p>}
      <div className="activity-log-card">
        {data?.items.slice(subpage * 20, (subpage + 1) * 20).map((row) => (
          <div className="activity-import-row" key={row.id}>
            <button
              type="button"
              className="activity-entry-title"
              onClick={() => setSelected(row)}
            >
              {activityLabel(String(row.original.action || "")) === "平台事件"
                ? "旧活动声明"
                : activityLabel(String(row.original.action || ""))}
            </button>
            <time>
              {feedDateTime(
                typeof row.original.created_at === "string"
                  ? row.original.created_at
                  : undefined,
              )}
            </time>
          </div>
        ))}
      </div>
      {selected && (
        <Dialog
          title="旧活动原件声明"
          className="activity-proof-dialog"
          onClose={() => setSelected(null)}
        >
          <div className="activity-proof">
            <p>来源：{selected.source} · 本人导入声明</p>
            <p>原编号 {selected.originalId}</p>
            <p>原件 {selected.sourceId}</p>
            <pre className="activity-original">
              {JSON.stringify(selected.original, null, 2)}
            </pre>
          </div>
        </Dialog>
      )}
      {data && !data.items.length && <p>没有导入声明</p>}
      {data && (offset > 0 || data.items.length > 20 || data.hasMore) && (
        <div className="workspace-pagination">
          <button
            type="button"
            disabled={offset === 0 && subpage === 0}
            onClick={() => {
              if (subpage > 0) setSubpage((value) => value - 1);
              else {
                setOffset(Math.max(0, offset - 200));
                setSubpage(9);
              }
            }}
          >
            上一页
          </button>
          <span>当前读取{data.items.length}条声明</span>
          <button
            type="button"
            disabled={(subpage + 1) * 20 >= data.items.length && !data.hasMore}
            onClick={() => {
              if ((subpage + 1) * 20 < data.items.length)
                setSubpage((value) => value + 1);
              else if (data.nextOffset !== null) {
                setOffset(data.nextOffset);
                setSubpage(0);
              }
            }}
          >
            下一页
          </button>
        </div>
      )}
    </section>
  );
}

export function ActivityPage({ session }: { session: Session }) {
  const location = useLocation(),
    navigate = useNavigate();
  const { data, error, reload, refreshing } =
    useResource<Activity>("/activities");
  const { view, query, page } = activitySelection(
    location.search,
    session.user.role === "admin",
  );
  const update = (nextView: string = view, nextPage = 0, nextQuery = query) =>
    navigate(
      {
        pathname: location.pathname,
        search: activitySearch(location.search, nextView, nextPage, nextQuery),
      },
      { replace: true },
    );
  usePanelReady("/activity", Boolean(data));
  const rows =
    (session.user.role === "admin" && view === "system"
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
        {(view === "user" || view === "system") && (
          <button
            type="button"
            className="icon-button"
            aria-label="刷新活动"
            disabled={refreshing}
            onClick={reload}
          >
            <RefreshCw size={19} />
          </button>
        )}
      </div>
      <WorkspaceTabs
        label="活动视图"
        value={view}
        onChange={(value) => update(value)}
        items={[
          { value: "user", label: "本人活动" },
          ...(session.user.role === "admin"
            ? [{ value: "system", label: "系统活动" }]
            : []),
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
        {session.user.role === "admin" && (
          <RequestObservations
            key={JSON.stringify([
              session.instance_id,
              session.user.id,
              session.user.role,
              session.receipt_scope,
              session.csrf,
            ])}
            expanded
            active={view === "requests"}
          />
        )}
      </WorkspaceView>
      <WorkspaceView
        active={view === "user" || view === "system"}
        label="活动时间线"
      >
        <div className="activity-filters">
          <label className="activity-search">
            <Search size={17} aria-hidden="true" />
            <input
              aria-label="查找活动"
              placeholder="查找活动"
              value={query}
              maxLength={200}
              onChange={(event) => update(view, 0, event.target.value)}
            />
          </label>
        </div>
        {error && <p role="alert">{error}</p>}
        {!data && !error && <LoadingPlaceholder label="正在读取" compact />}
        {data && (
          <ActivityTimeline
            rows={filtered}
            page={page}
            onPage={(value) => update(view, value)}
            showUser={view === "system"}
          />
        )}
      </WorkspaceView>
    </section>
  );
}
