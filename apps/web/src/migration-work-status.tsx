import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, ApiError } from "./api";
import { apiSessionSnapshot, isCurrentApiSession } from "./api-session";
import {
  migrationWorkPresentation,
  parseMigrationWorkStatus,
} from "./migration-work-status-model";
import type { MigrationWorkStatus } from "./migration-work-status-model";
import "./migration-work-status.css";

type Snapshot = {
  status: MigrationWorkStatus | null;
  connected: boolean;
  binding: ReturnType<typeof apiSessionSnapshot>;
};
export function MigrationWorkStatusPanel({
  refreshKey = 0,
}: {
  refreshKey?: number;
}) {
  const { pathname } = useLocation();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [visible, setVisible] = useState(!document.hidden);
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);
  const binding = apiSessionSnapshot();
  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    const ticket = ++generation.current;
    if (!visible || pathname !== "/migration" || !binding.csrf) return;
    const controller = new AbortController();
    let inFlight = false,
      fallback = false,
      retired = false;
    const current = () =>
      !controller.signal.aborted &&
      generation.current === ticket &&
      isCurrentApiSession(binding);
    const read = async () => {
      setNow(Date.now());
      if (!current()) {
        setSnapshot(null);
        return;
      }
      if (inFlight || retired) return;
      inFlight = true;
      try {
        let raw: unknown;
        if (!fallback) {
          try {
            raw = await api<unknown>(
              "/system/migration/work-status",
              { signal: controller.signal },
              binding.csrf || undefined,
            );
          } catch (error) {
            if (!(error instanceof ApiError) || error.status !== 404)
              throw error;
            fallback = true;
          }
        }
        if (fallback) {
          const register = await api<{ migration_work_status?: unknown }>(
            "/system/migration",
            { signal: controller.signal },
            binding.csrf || undefined,
          );
          raw = register.migration_work_status;
        }
        if (!current()) return;
        const status = parseMigrationWorkStatus(raw);
        setSnapshot((previous) => {
          // A late or rolled-back sequence cannot replace newer evidence.
          if (
            status &&
            previous &&
            isCurrentApiSession(previous.binding) &&
            previous.status &&
            status.sequence < previous.status.sequence
          )
            return { ...previous, connected: false };
          return { status, connected: true, binding };
        });
      } catch (error) {
        if (!current()) return;
        if (
          error instanceof ApiError &&
          (error.status === 401 || error.status === 403)
        ) {
          retired = true;
          setSnapshot(null);
          return;
        }
        setSnapshot((previous) => ({
          status:
            previous && isCurrentApiSession(previous.binding)
              ? previous.status
              : null,
          connected: false,
          binding,
        }));
      } finally {
        inFlight = false;
      }
    };
    void read();
    const timer = window.setInterval(() => void read(), 5000);
    return () => {
      ++generation.current;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [pathname, visible, binding.epoch, refreshKey]);
  const live =
    snapshot && isCurrentApiSession(snapshot.binding) ? snapshot : null;
  const presentation = migrationWorkPresentation(
    live?.status || null,
    now,
    live?.connected ?? true,
  );
  return (
    <section className="migration-work-status" aria-label="迁移工作状态">
      <div
        className={`migration-work-wave${presentation.animated && visible && pathname === "/migration" ? " is-active" : ""}`}
        aria-hidden="true"
      >
        {[0, 1, 2, 3, 4].map((index) => (
          <i key={index} />
        ))}
      </div>
      <div className="migration-work-copy">
        <div className="migration-work-line">
          <strong>{presentation.label}</strong>
          {live?.status?.feature_id && <span>{live.status.feature_id}</span>}
          {live?.status?.step && <span>{live.status.step}</span>}
        </div>
        {live?.status?.summary && (
          <div className="migration-work-summary">{live.status.summary}</div>
        )}
        {live?.status && (
          <time dateTime={live.status.updated_at}>
            最后更新 {new Date(live.status.updated_at).toLocaleString()}
          </time>
        )}
      </div>
    </section>
  );
}
