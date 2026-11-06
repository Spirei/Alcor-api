import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import {
  OperationHistory,
  type OperationHistoryItem,
} from "./operation-task-card";

export type OperationKind = "import" | "api" | "sync" | "backup";
type Page = { items: OperationHistoryItem[]; hasMore: boolean };

export function AccountOperationHistory({
  session,
  ...props
}: {
  session: Session;
  kind: OperationKind;
  active?: boolean;
  refreshKey?: string | number;
  onOpenTask?: (id: string) => void;
}) {
  const binding = JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
    session.csrf,
    session.expires_at,
  ]);
  return <History key={binding + props.kind} csrf={session.csrf} {...props} />;
}

function History({
  kind,
  active = true,
  refreshKey,
  csrf,
  onOpenTask,
}: {
  kind: OperationKind;
  active?: boolean;
  refreshKey?: string | number;
  csrf: string;
  onOpenTask?: (id: string) => void;
}) {
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );
  const generation = useRef(0);
  useEffect(() => {
    const changed = () => {
      if (document.hidden) ++generation.current;
      setVisible(!document.hidden);
    };
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    setOffset(0);
  }, [refreshKey]);
  useEffect(() => {
    if (!active || !visible) return;
    if (apiSessionSnapshot().csrf !== csrf) {
      setPage(null);
      setError("登录身份已变化，请重新读取任务记录");
      setLoading(false);
      return;
    }
    const current = ++generation.current;
    const controller = new AbortController();
    setLoading(true);
    setPage(null);
    setError("");
    void api<Page>(
      `/account/operation-history?kind=${kind}&limit=5&offset=${offset}`,
      { signal: controller.signal },
      csrf,
    )
      .then((value) => {
        if (
          current === generation.current &&
          !controller.signal.aborted &&
          apiSessionSnapshot().csrf === csrf
        )
          setPage(value);
      })
      .catch((reason: unknown) => {
        if (current !== generation.current || controller.signal.aborted) return;
        if (
          reason instanceof ApiError &&
          ([401, 403].includes(reason.status) ||
            reason.code === "session_changed")
        )
          setPage(null);
        setError(reason instanceof Error ? reason.message : "任务记录读取失败");
      })
      .finally(() => {
        if (current === generation.current && !controller.signal.aborted)
          setLoading(false);
      });
    return () => {
      ++generation.current;
      controller.abort();
    };
  }, [kind, active, visible, offset, reload, refreshKey, csrf]);
  if (!active) return null;
  return (
    <OperationHistory
      items={page?.items ?? []}
      loading={loading}
      error={error}
      onReload={() => setReload((value) => value + 1)}
      hasPrevious={offset > 0}
      hasNext={page?.hasMore === true}
      onPrevious={() => setOffset((value) => Math.max(0, value - 5))}
      onNext={() => setOffset((value) => value + 5)}
      page={offset / 5 + 1}
      onOpenTask={onOpenTask}
    />
  );
}
