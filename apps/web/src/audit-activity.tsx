import "./audit-activity.css";
import "./portfolio.css";
import { DailyActivitySummary } from "./daily-activity-summary";
import { useLocation } from "react-router-dom";
import { RequestObservations } from "./request-observations";
import { useState } from "react";
import type { Session } from "./api";
import { useResource } from "./hooks";
import { usePanelReady } from "./transition-qa";

type Entry = {
  id: string;
  event: string;
  detail: string;
  createdAt: string;
  userName: string;
};
type Activity = { userLogs: Entry[]; systemLogs: Entry[] };
type Declaration = {id:string;sourceId:string;originalId:string;source:string;platformAudit:false;original:Record<string,unknown>};

function ImportedActivity(){
  const [offset,setOffset]=useState(0);
  const {data,error,reload}=useResource<{items:Declaration[];hasMore:boolean;nextOffset:number|null}>(`/activities/imported?offset=${offset}`);
  return <details><summary>导入的旧活动声明</summary><p>这些记录来自本人导入原件，保留原时间与内容；平台执行审计单独展示。</p>
    <button type="button" className="button secondary small" onClick={reload}>重新读取</button>
    {error&&<p role="alert">{error}</p>}
    {data?.items.map(row=><details key={row.id}><summary>{String(row.original.created_at??'原时间未知')} · {String(row.original.action??'旧活动')}</summary><p>原编号 {row.originalId} · 原件 {row.sourceId}</p><pre>{JSON.stringify(row.original,null,2)}</pre></details>)}
    {data&&!data.items.length&&<p>没有导入声明</p>}
    {offset>0&&<button type="button" onClick={()=>setOffset(Math.max(0,offset-200))}>上一页</button>}
    {data?.hasMore&&data.nextOffset!==null&&<button type="button" onClick={()=>setOffset(data.nextOffset!)}>下一页</button>}
  </details>;
}

export function ActivityPage({ session }: { session: Session }) {
  const location = useLocation();
  const { data, error, reload } = useResource<Activity>("/activities");
  const [system, setSystem] = useState(false);
  const [query, setQuery] = useState("");
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
      <h1>活动</h1>
      <DailyActivitySummary session={session} active={location.pathname === "/activity"} />
      <ImportedActivity key={JSON.stringify([session.instance_id,session.user.id,session.csrf])}/>
      {session.user.role === "admin" && <RequestObservations />}
      <div className="module-actions">
        <button
          type="button"
          className="button secondary small"
          onClick={reload}
        >
          重新读取
        </button>
        <input
          aria-label="查找活动"
          placeholder="查找活动"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
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
            onClick={() => setSystem(false)}
          >
            本人活动
          </button>
          <button
            type="button"
            className="button secondary small"
            aria-pressed={system}
            onClick={() => setSystem(true)}
          >
            系统活动
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p role="status">正在读取…</p>}
      {data && (
        <div className="portfolio-table">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>事件</th>
                <th>对象</th>
                <th>用户</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.createdAt).toLocaleString()}</td>
                  <td>{row.event}</td>
                  <td>{row.detail || "—"}</td>
                  <td>{row.userName}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <p>暂无活动</p>}
        </div>
      )}
    </section>
  );
}
