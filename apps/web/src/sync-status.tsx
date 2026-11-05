import { Link, useNavigate } from "react-router-dom";
import type { Session } from "./api";
import { AccountSyncStatus } from "./account-sync-status";
export function SyncStatusPage({
  session,
  active,
}: {
  session: Session;
  active: boolean;
}) {
  const navigate = useNavigate();
  return (
    <>
      <div className="page-heading">
        <h1>同步</h1>
      </div>
      <AccountSyncStatus
        session={session}
        active={active}
        onOpenDevices={() => navigate("/account#account-owned-devices")}
      />
      <div className="sync-status-links">
        <Link className="button secondary" to="/legacy-import">
          导入数据
        </Link>
        {session.user.role === "admin" && (
          <Link className="button secondary" to="/backups">
            备份恢复
          </Link>
        )}
      </div>
    </>
  );
}
