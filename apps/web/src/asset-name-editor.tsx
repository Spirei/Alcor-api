import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { requestId } from "./request-id";
import type { LibraryAsset } from "./asset-library-market";

type Job = {
  requestId: string;
  assetId: string;
  name: string;
  revision: number;
};
export function useAssetNameEditor({
  session,
  active,
  onChanged,
  onBlocked,
  domain = "asset",
}: {
  session: Session;
  active: boolean;
  onChanged: () => void;
  onBlocked: (value: boolean) => void;
  domain?: "asset" | "watch-group";
}) {
  const [target, setTarget] = useState<
    (LibraryAsset & { revision: number }) | null
  >(null);
  const input = useRef<HTMLInputElement>(null),
    returnFocus = useRef<HTMLElement | null>(null);
  const storage =
    "alcor.asset-label:" +
    JSON.stringify([
      session.instance_id,
      session.user.id,
      session.receipt_scope,
    ]) +
    (domain === "watch-group" ? ":groups" : "");
  const [job, setJob] = useState<Job | null>(null),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [locked, setLocked] = useState(false);
  const live = useRef(active),
    generation = useRef(0),
    controller = useRef<AbortController | null>(null);
  useEffect(() => {
    live.current = active;
    ++generation.current;
    if (!active) {
      controller.current?.abort();
      setBusy(false);
    }
    return () => {
      live.current = false;
      ++generation.current;
      controller.current?.abort();
    };
  }, [active]);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storage);
      if (raw) {
        const saved = JSON.parse(raw) as Job;
        if (
          !saved ||
          !/^[a-f0-9-]{36}$/.test(saved.requestId) ||
          typeof saved.assetId !== "string" ||
          typeof saved.name !== "string" ||
          !Number.isSafeInteger(saved.revision) ||
          saved.revision < 0
        )
          throw Error("名称修改记录无法读取，请核对浏览器存储");
        setJob(saved);
        setName(saved.name);
      }
    } catch (reason) {
      setLocked(true);
      setError(
        reason instanceof Error ? reason.message : "名称修改记录无法读取",
      );
    }
  }, [storage]);
  useEffect(() => {
    if (target && !job) {
      setName(target.name);
      setError("");
    }
  }, [target?.id]);
  useEffect(() => {
    onBlocked(busy || !!job || locked);
  }, [busy, job, locked, onBlocked]);
  const current = () =>
    live.current && apiSessionSnapshot().csrf === session.csrf;
  function finish(raw: unknown, expected: Job) {
    const value = raw as {
      requestId?: string;
      revision?: number;
      asset?: { id?: string; name?: string };
      group?: { id?: string; name?: string };
    };
    if (
      !value ||
      value.requestId !== expected.requestId ||
      value.revision !== expected.revision + 1 ||
      (domain === "watch-group" ? value.group?.id : value.asset?.id) !==
        expected.assetId ||
      (domain === "watch-group" ? value.group?.name : value.asset?.name) !==
        expected.name
    )
      throw Error("名称修改结果待核对，请查询原操作");
    sessionStorage.removeItem(storage);
    setJob(null);
    setError("");
    onChanged();
    setTarget(null);
  }
  async function execute(check = false) {
    if (!current() || busy || locked || (!target && !job)) return;
    const expected = job || {
      requestId: requestId(),
      assetId: target!.id,
      revision: target!.revision,
      name: name.trim(),
    };
    if (!expected.name || expected.name.length > 120) {
      setError("请输入 1–120 字的素材名称");
      return;
    }
    if (!job && check) return;
    try {
      sessionStorage.setItem(storage, JSON.stringify(expected));
    } catch {
      setError("无法保存操作记录，请检查浏览器存储后重试");
      return;
    }
    setJob(expected);
    setBusy(true);
    setError("");
    const sequence = generation.current,
      abort = new AbortController();
    controller.current = abort;
    const valid = () => current() && generation.current === sequence;
    try {
      const result = await api<unknown>(
        check
          ? (domain === "watch-group"
              ? "/watch-groups/operations/"
              : "/admin/asset-catalog/operations/") + expected.requestId
          : domain === "watch-group"
            ? "/watch-groups/operations"
            : "/admin/asset-catalog/entries/" +
              encodeURIComponent(expected.assetId),
        {
          method: check ? "GET" : domain === "watch-group" ? "POST" : "PUT",
          signal: abort.signal,
          ...(!check
            ? {
                body: JSON.stringify(
                  domain === "watch-group"
                    ? {
                        requestId: expected.requestId,
                        expectedRevision: expected.revision,
                        action: "update",
                        data: { id: expected.assetId, name: expected.name },
                      }
                    : {
                        requestId: expected.requestId,
                        expectedRevision: expected.revision,
                        publicMetadataConfirmed: true,
                        asset: { id: expected.assetId, name: expected.name },
                        restore: false,
                      },
                ),
              }
            : {}),
        },
        session.csrf,
      );
      if (valid()) finish(result, expected);
    } catch (reason) {
      if (valid()) {
        if (reason instanceof ApiError && [401, 403].includes(reason.status))
          setLocked(true);
        setError(
          reason instanceof Error ? reason.message : "名称修改结果待核对",
        );
        if (
          !check &&
          reason instanceof ApiError &&
          [400, 404, 409, 422].includes(reason.status)
        ) {
          try {
            const result = await api<unknown>(
              (domain === "watch-group"
                ? "/watch-groups/operations/"
                : "/admin/asset-catalog/operations/") + expected.requestId,
              { signal: abort.signal },
            );
            if (valid()) finish(result, expected);
          } catch (lookup) {
            if (
              valid() &&
              lookup instanceof ApiError &&
              lookup.status === 404
            ) {
              sessionStorage.removeItem(storage);
              setJob(null);
              onChanged();
            }
          }
        }
      }
    } finally {
      if (valid()) setBusy(false);
      if (controller.current === abort) controller.current = null;
    }
  }
  const editingId = target?.id || job?.assetId || null;
  useLayoutEffect(() => {
    if (editingId) {
      input.current?.focus({ preventScroll: true });
      input.current?.select();
    } else if (
      returnFocus.current?.isConnected &&
      returnFocus.current.getClientRects().length
    )
      returnFocus.current.focus({ preventScroll: true });
  }, [editingId]);
  return {
    editingId,
    input,
    name,
    setName,
    busy,
    pending: !!job,
    error,
    locked,
    begin: (asset: LibraryAsset, revision: number, element: HTMLElement) => {
      if (busy || job || locked) return;
      returnFocus.current = element;
      setTarget({ ...asset, revision });
      setName(asset.name);
      setError("");
    },
    cancel: () => {
      if (!busy && !job) {
        setTarget(null);
        setError("");
      }
    },
    save: () => execute(!!job),
    check: () => execute(true),
  };
}
export function MaterialName({
  asset,
  revision,
  editor,
  disabled = false,
}: {
  asset: LibraryAsset;
  revision: number;
  editor: ReturnType<typeof useAssetNameEditor>;
  disabled?: boolean;
}) {
  const editing = editor.editingId === asset.id;
  return (
    <span className="asset-library-name">
      <strong hidden={editing}>
        {asset.name || asset.code || "未命名素材"}
      </strong>
      <button
        hidden={editing}
        type="button"
        className="asset-market-edit"
        aria-label={`编辑${asset.name}名称`}
        title="修改名称"
        disabled={disabled || editor.locked}
        onClick={(event) => editor.begin(asset, revision, event.currentTarget)}
      >
        <Pencil size={15} />
      </button>
      {editing && (
        <form
          className="asset-inline-name"
          onSubmit={(event) => {
            event.preventDefault();
            void editor.save();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              editor.cancel();
            }
          }}
        >
          <input
            ref={editor.input}
            aria-label="素材名称"
            value={editor.name}
            maxLength={120}
            disabled={editor.busy || editor.pending || editor.locked}
            onChange={(event) => editor.setName(event.target.value)}
          />
          <button
            type="submit"
            className="asset-name-action"
            aria-label={editor.pending ? "核对名称修改结果" : "保存名称"}
            title={editor.pending ? "核对原操作" : "保存"}
            disabled={editor.busy || editor.locked || !editor.name.trim()}
          >
            <Check size={17} />
          </button>
          <button
            type="button"
            className="asset-name-action"
            aria-label="取消修改名称"
            title="取消"
            disabled={editor.busy || editor.pending}
            onClick={editor.cancel}
          >
            <X size={17} />
          </button>
          {editor.error && (
            <small role="alert" className="asset-inline-error">
              {editor.error}
            </small>
          )}
        </form>
      )}
    </span>
  );
}
