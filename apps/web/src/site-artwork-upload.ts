import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { requestId } from "./request-id";
import {
  sharedAssetConfig,
  sharedAssetReceipt,
  type AssetReceipt,
} from "./shared-assets-state";
import {
  artworkRequest,
  siteArtworkFields,
  type ArtworkRequest,
  type SiteArtworkField,
} from "./site-artwork-state";

const root = "/admin/shared-assets";

/** One pending immutable image upload per identity; publishing it remains a separate site save. */
export function useSiteArtworkUpload({
  session,
  active,
  onUploaded,
  onFailure,
}: {
  session: Session;
  active: boolean;
  onUploaded: (field: SiteArtworkField, value: AssetReceipt) => void;
  onFailure: (error: unknown) => void;
}) {
  const [pending, setPending] = useState<ArtworkRequest | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const generation = useRef(0),
    live = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const original = useRef<ArtworkRequest | null>(null);
  const callbacks = useRef({ onUploaded, onFailure });
  callbacks.current = { onUploaded, onFailure };
  const key =
    "alcor.site-artwork.pending:" +
    JSON.stringify([
      session.instance_id,
      session.user.id,
      session.user.role,
      session.receipt_scope,
    ]);
  const displayed = () => apiSessionSnapshot().csrf === session.csrf;
  useLayoutEffect(() => {
    ++generation.current;
    live.current = active && displayed();
    return () => {
      live.current = false;
      ++generation.current;
      controller.current?.abort();
      controller.current = null;
      setBusy(false);
    };
  }, [active, session.csrf]);
  useEffect(() => {
    try {
      original.current = artworkRequest(sessionStorage.getItem(key));
      setPending(original.current);
      setReady(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "原图片操作无法读取");
    }
  }, [key]);
  function fail(reason: unknown) {
    setError(reason instanceof Error ? reason.message : "图片操作失败");
    if (
      !displayed() ||
      (reason instanceof ApiError &&
        ([401, 403].includes(reason.status) ||
          reason.code === "session_changed"))
    ) {
      live.current = false;
      ++generation.current;
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Retire identity-bound receipt. */
      }
      original.current = null;
      setPending(null);
      callbacks.current.onFailure(reason);
    }
  }
  function known(raw: unknown, request: ArtworkRequest) {
    const result = sharedAssetReceipt(raw, request.id);
    const kind = siteArtworkFields.find(
      (item) => item.field === request.field,
    )!.kind;
    if (result.state === "completed" && result.kind !== kind)
      throw new Error("原图片类型与回执不一致，请继续核对");
    sessionStorage.removeItem(key);
    original.current = null;
    setPending(null);
    if (result.state === "completed") {
      callbacks.current.onUploaded(request.field, result);
      setError("");
    } else setError(result.message);
  }
  async function query() {
    const request = original.current;
    if (
      !request ||
      !ready ||
      !live.current ||
      !displayed() ||
      controller.current
    )
      return;
    const epoch = generation.current,
      abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    try {
      const value = await api<unknown>(root + "/operations/" + request.id, {
        signal: abort.signal,
      });
      if (live.current && displayed() && generation.current === epoch)
        known(value, request);
    } catch (reason) {
      if (!abort.signal.aborted && generation.current === epoch) fail(reason);
    } finally {
      if (controller.current === abort) controller.current = null;
      if (generation.current === epoch) setBusy(false);
    }
  }
  async function upload(field: SiteArtworkField, file: File) {
    if (
      !ready ||
      !live.current ||
      !displayed() ||
      controller.current ||
      original.current
    )
      return;
    const epoch = generation.current,
      abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    let submitted = false;
    try {
      const config = sharedAssetConfig(
        await api<unknown>(root, { signal: abort.signal }),
      );
      if (!live.current || !displayed() || epoch !== generation.current) return;
      const kind = siteArtworkFields.find((item) => item.field === field)!.kind;
      const rule = config.kinds[kind];
      if (
        file.size <= 0 ||
        file.size > rule.maxBytes ||
        !rule.extensions.includes(
          file.name.split(".").pop()?.toLowerCase() || "",
        )
      )
        throw new Error("图片为空、格式不支持或超过此类型大小上限");
      const request = { id: requestId(), field };
      sessionStorage.setItem(key, JSON.stringify(request));
      original.current = request;
      setPending(request);
      const body = new FormData();
      body.set("file", file);
      body.set("kind", kind);
      body.set("requestId", request.id);
      body.set("expectedRevision", String(config.revision));
      submitted = true;
      const result = await api<unknown>(
        root + "/upload",
        { method: "POST", body, signal: abort.signal },
        session.csrf,
        300000,
      );
      if (live.current && displayed() && epoch === generation.current)
        known(result, request);
    } catch (reason) {
      if (!abort.signal.aborted && epoch === generation.current) {
        fail(reason);
        // A known rejection with no receipt has not accepted this upload. Network
        // failures and malformed replies retain the original UUID for recovery.
        if (
          submitted &&
          live.current &&
          original.current &&
          reason instanceof ApiError &&
          [400, 409, 413, 422].includes(reason.status)
        ) {
          const request = original.current;
          try {
            const result = await api<unknown>(
              root + "/operations/" + request.id,
              { signal: abort.signal },
            );
            if (live.current && displayed() && generation.current === epoch)
              known(result, request);
          } catch (lookup) {
            if (
              !abort.signal.aborted &&
              live.current &&
              displayed() &&
              generation.current === epoch &&
              lookup instanceof ApiError &&
              lookup.status === 404
            ) {
              sessionStorage.removeItem(key);
              original.current = null;
              setPending(null);
            } else if (
              !abort.signal.aborted &&
              live.current &&
              generation.current === epoch
            )
              fail(lookup);
          }
        }
      }
    } finally {
      if (controller.current === abort) controller.current = null;
      if (generation.current === epoch) setBusy(false);
    }
  }
  return { pending, busy, error, ready, upload, query };
}
