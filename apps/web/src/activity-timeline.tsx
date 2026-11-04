import { Fragment } from "react";
type Entry = {
  id: string;
  event: string;
  detail: string;
  createdAt: string;
  userName: string;
};
const labels: Record<string, string> = {
  "auth.login.success": "登录成功",
  "auth.login.failed": "登录失败",
  "auth.logout": "退出登录",
  "auth.register.success": "注册账号",
  password_change: "修改密码",
  profile_update: "更新资料",
  file_upload: "上传文件",
  data_export: "导出数据",
  data_import: "导入数据",
};
export function ActivityTimeline({
  rows,
  page,
  onPage,
}: {
  rows: readonly Entry[];
  page: number;
  onPage: (page: number) => void;
}) {
  const size = 20,
    current = Math.min(page, Math.max(0, Math.ceil(rows.length / size) - 1));
  let previous = "";
  return (
    <div className="activity-timeline">
      <ol>
        {rows.slice(current * size, (current + 1) * size).map((row) => {
          const date = new Date(row.createdAt),
            valid = Number.isFinite(date.getTime()),
            day = valid ? date.toLocaleDateString("zh-CN") : "时间待核对",
            heading = day !== previous;
          previous = day;
          const level = /failed|rejected|blocked|denied|error/.test(row.event)
            ? "error"
            : /rate_limited|warning/.test(row.event)
              ? "warning"
              : "info";
          return (
            <Fragment key={row.id}>
              {heading && <li className="activity-day">{day}</li>}
              <li className="activity-event" data-level={level}>
                <span className="activity-dot" aria-hidden="true" />
                <time
                  dateTime={valid ? row.createdAt : undefined}
                  title={row.createdAt}
                >
                  {valid
                    ? date.toLocaleTimeString("zh-CN", {
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })
                    : "—"}
                </time>
                <div>
                  <strong>{labels[row.event] || row.event}</strong>
                  {row.detail && <p>{row.detail}</p>}
                  <small>{row.userName || "用户未知"}</small>
                </div>
              </li>
            </Fragment>
          );
        })}
      </ol>
      {!rows.length && <p>暂无活动</p>}
      {rows.length > size && (
        <div className="workspace-pagination">
          <span>
            第 {current + 1} / {Math.ceil(rows.length / size)} 页 · 当前已读{" "}
            {rows.length} 条
          </span>
          <button disabled={!current} onClick={() => onPage(current - 1)}>
            上一页
          </button>
          <button
            disabled={(current + 1) * size >= rows.length}
            onClick={() => onPage(current + 1)}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
