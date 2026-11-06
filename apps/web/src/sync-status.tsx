import { useNavigate } from "react-router-dom";
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
    </>
  );
}
