import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { requestId } from "./request-id";
import type { LibraryAsset } from "./asset-library-market";
export type MaterialCommand = {
  requestId: string;
  revision: number;
  action: "create" | "delete" | "restore";
  asset: LibraryAsset;
};
export function useMaterialCommand(
  session: Session,
  active: boolean,
  onChanged: () => void,
) {
  const storage =
    "alcor.material-command:" +
    JSON.stringify([
      session.instance_id,
      session.user.id,
      session.receipt_scope,
    ]);
  const [job, setJob] = useState<MaterialCommand | null>(null),
    [busy, setBusy] = useState(false),
    [locked, setLocked] = useState(false),
    [error, setError] = useState(""),
    [last, setLast] = useState<MaterialCommand | null>(null);
  const live = useRef(active),
    epoch = useRef(0),
    abort = useRef<AbortController | null>(null);
  useEffect(() => {
    live.current = active;
    ++epoch.current;
    if (!active) {
      abort.current?.abort();
      setBusy(false);
    }
    return () => {
      live.current = false;
      ++epoch.current;
      abort.current?.abort();
    };
  }, [active]);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storage);
      if (!raw) return;
      const v = JSON.parse(raw) as MaterialCommand;
      if (
        !v ||
        !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v.requestId) ||
        !["create", "delete", "restore"].includes(v.action) ||
        !Number.isSafeInteger(v.revision) ||
        v.revision < 0 ||
        typeof v.asset?.id !== "string"
      )
        throw Error("素材操作记录无法读取");
      setJob(v);
    } catch (e) {
      setLocked(true);
      setError(e instanceof Error ? e.message : "素材操作记录无法读取");
    }
  }, [storage]);
  async function execute(next?: Omit<MaterialCommand, "requestId">) {
    if (
      !live.current ||
      busy ||
      locked ||
      apiSessionSnapshot().csrf !== session.csrf
    )
      return;
    const expected = job || (next ? { ...next, requestId: requestId() } : null);
    if (!expected) return;
    const check = !!job;
    try {
      sessionStorage.setItem(storage, JSON.stringify(expected));
    } catch {
      setError("无法保存操作记录，请检查浏览器存储");
      return;
    }
    setJob(expected);
    setBusy(true);
    setError("");
    const sequence = epoch.current,
      controller = new AbortController();
    abort.current = controller;
    const valid = () =>
      live.current &&
      epoch.current === sequence &&
      apiSessionSnapshot().csrf === session.csrf;
    function finish(raw: unknown) {
      const v = raw as {
        requestId?: string;
        revision?: number;
        id?: string;
        asset?: LibraryAsset;
        deleted?: boolean;
        kind?: string;
      };
      if (
        v?.requestId !== expected!.requestId ||
        v.revision !== expected!.revision + 1 ||
        (expected!.action === "create"
          ? v.asset?.id !== expected!.asset.id
          : v.id !== expected!.asset.id ||
            v.deleted !== (expected!.action === "delete"))
      )
        throw Error("素材操作结果待核对");
      sessionStorage.removeItem(storage);
      setJob(null);
      setLast(expected);
      onChanged();
      return v;
    }
    try {
      const params = new URLSearchParams({
        requestId: expected.requestId,
        expectedRevision: String(expected.revision),
      });
      const path = check
        ? "/admin/asset-catalog/operations/" + expected.requestId
        : expected.action === "create"
          ? "/admin/asset-catalog/entries"
          : expected.action === "restore"
            ? "/admin/asset-catalog/restore"
            : "/admin/asset-catalog/entries/" +
              encodeURIComponent(expected.asset.id) +
              "?" +
              params;
      const body =
        expected.action === "create"
          ? {
              requestId: expected.requestId,
              expectedRevision: expected.revision,
              publicMetadataConfirmed: true,
              asset: {
                id: expected.asset.id,
                type: expected.asset.type,
                code: expected.asset.code,
                market: expected.asset.market,
                name: expected.asset.name,
              },
              restore: false,
            }
          : {
              requestId: expected.requestId,
              expectedRevision: expected.revision,
              assetId: expected.asset.id,
            };
      const result = await api<unknown>(
        path,
        {
          method: check
            ? "GET"
            : expected.action === "delete"
              ? "DELETE"
              : "POST",
          signal: controller.signal,
          ...(!check && expected.action !== "delete"
            ? { body: JSON.stringify(body) }
            : {}),
        },
        session.csrf,
      );
      if (valid()) return finish(result);
    } catch (reason) {
      if (valid()) {
        setError(
          reason instanceof Error ? reason.message : "素材操作结果待核对",
        );
        if (reason instanceof ApiError && [401, 403].includes(reason.status))
          setLocked(true);
        if (
          !check &&
          reason instanceof ApiError &&
          [400, 404, 409, 422].includes(reason.status)
        )
          try {
            const v = await api<unknown>(
              "/admin/asset-catalog/operations/" + expected.requestId,
              { signal: controller.signal },
            );
            if (valid()) finish(v);
          } catch (e) {
            if (valid() && e instanceof ApiError && e.status === 404) {
              sessionStorage.removeItem(storage);
              setJob(null);
              onChanged();
            }
          }
      }
    } finally {
      if (valid()) setBusy(false);
      if (abort.current === controller) abort.current = null;
    }
  }
  return {
    busy,
    pending: !!job,
    locked,
    error,
    last,
    blocked: busy || !!job || locked,
    execute,
    check: () => execute(),
    clearLast: () => setLast(null),
  };
}
