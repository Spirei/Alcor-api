import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { requestId } from "./request-id";
import { SelectMenu } from "./select-menu";
import { iconBlob, iconDataPreview } from "./watch-group-icon-media";
import {
  clearIconRequests,
  readIconRequest,
  retainIconRequest,
  releaseIconRequest,
  validIconRequest,
  iconCurrent,
  groupIcon,
  iconReceipt,
  type IconCurrent,
  type IconReceipt,
  type GroupIcon,
} from "./watch-group-icon-state";
import { Camera, Trash2, ImageOff } from "lucide-react";
import type { GroupListing, WatchGroup } from "./watch-groups-state";
import "./watch-group-icons.css";
const base = "/watch-groups";
export function WatchGroupIcons({
  session,
  groups,
  active,
  blocked,
  onBlocked,
  onChanged,
  onDenied,
  library,
}: {
  session: Session;
  groups: GroupListing | null;
  active: boolean;
  blocked: boolean;
  onBlocked: (value: boolean) => void;
  onChanged: () => void;
  onDenied: (reason: unknown) => void;
  library?: {
    visibleIds: string[];
    renderName: (group: WatchGroup) => ReactNode;
  };
}) {
  const scope = JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  const [history, setHistory] = useState<
    (GroupIcon & {
      createdAt: string;
      current: boolean;
      availability: string;
    })[]
  >([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyReady, setHistoryReady] = useState(false);
  const [groupId, setGroupId] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [metadata, setMetadata] = useState<IconCurrent | null>(null),
    [pending, setPending] = useState<string | null>(null),
    [lookup, setLookup] = useState(""),
    [receipt, setReceipt] = useState<IconReceipt | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [locked, setLocked] = useState(false),
    [refresh, setRefresh] = useState(0),
    [previewUrl, setPreviewUrl] = useState<string | null>(null),
    [previewVersion, setPreviewVersion] = useState("");
  const queued = useRef<"upload" | "clear" | null>(null);
  const live = useRef(false),
    epoch = useRef(0),
    original = useRef<string | null>(null),
    rejected = useRef<string | null>(null),
    reading = useRef<AbortController | null>(null),
    work = useRef<AbortController | null>(null),
    input = useRef<HTMLInputElement>(null),
    image = useRef<HTMLImageElement>(null);
  const displayed = useCallback(
    () => apiSessionSnapshot().csrf === session.csrf,
    [session.csrf],
  );
  const clearFile = useCallback(() => {
    setFile(null);
    if (input.current) input.current.value = "";
  }, []);
  const clearPreview = useCallback(() => {
    image.current?.removeAttribute("src");
    setPreviewUrl(null);
    setPreviewVersion("");
  }, []);
  const pause = useCallback(() => {
    live.current = false;
    ++epoch.current;
    reading.current?.abort();
    reading.current = null;
    work.current?.abort();
    work.current = null;
    clearFile();
    clearPreview();
    setMetadata(null);
    setHistory([]);
    setHistoryCursor(null);
    setHistoryReady(false);
    setReceipt(null);
    setReady(false);
    setBusy(false);
  }, [clearFile, clearPreview]);
  const fail = useCallback(
    (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "图标操作失败");
      if (
        !displayed() ||
        (reason instanceof ApiError &&
          ([401, 403].includes(reason.status) ||
            reason.code === "session_changed"))
      ) {
        pause();
        setLocked(true);
        original.current = null;
        setPending(null);
        setGroupId("");
        setLookup("");
        setNotice("");
        try {
          clearIconRequests(sessionStorage);
        } catch {}
        onBlocked(true);
        onDenied(reason);
      }
    },
    [displayed, pause, onBlocked, onDenied],
  );
  useLayoutEffect(() => {
    live.current = active && !locked && displayed();
    ++epoch.current;
    return pause;
  }, [active, locked, displayed, pause]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) pause();
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [pause]);
  useEffect(() => {
    if (!live.current || !displayed()) return;
    try {
      const id = readIconRequest(sessionStorage, scope);
      original.current = id;
      setPending(id);
      onBlocked(!!id);
      setReady(true);
    } catch (reason) {
      setLocked(true);
      onBlocked(true);
      fail(reason);
    }
  }, [active, scope, displayed, fail, onBlocked]);
  useEffect(() => {
    if (
      groups &&
      groupId &&
      !groups.groups.some((g) => g.id === groupId && g.kind === "custom")
    ) {
      clearFile();
      clearPreview();
      setGroupId("");
      setMetadata(null);
    }
  }, [groups, groupId, clearFile, clearPreview]);
  useEffect(() => {
    setMetadata(null);
    clearPreview();
    if (
      !live.current ||
      !groupId ||
      !groups?.groups.some((g) => g.id === groupId && g.kind === "custom")
    )
      return;
    const generation = epoch.current,
      controller = new AbortController();
    reading.current?.abort();
    reading.current = controller;
    void api<unknown>(base + "/" + encodeURIComponent(groupId) + "/icon", {
      signal: controller.signal,
    })
      .then((raw) => {
        if (
          live.current &&
          displayed() &&
          generation === epoch.current &&
          !controller.signal.aborted
        )
          setMetadata(iconCurrent(raw, groupId));
      })
      .catch((reason) => {
        if (
          live.current &&
          generation === epoch.current &&
          !controller.signal.aborted
        )
          fail(reason);
      });
    return () => controller.abort();
  }, [
    groupId,
    groups?.revision,
    active,
    refresh,
    displayed,
    clearPreview,
    fail,
  ]);
  function known(raw: unknown, id: string) {
    const value = iconReceipt(raw, id);
    if (original.current === id) {
      releaseIconRequest(sessionStorage, scope, id);
      original.current = null;
      setPending(null);
      rejected.current = null;
      onBlocked(false);
    }
    setReceipt(value);
    setHistory([]);
    setHistoryCursor(null);
    setHistoryReady(false);
    setLookup(id);
    setError("");
    setNotice("");
    clearFile();
    setRefresh((v) => v + 1);
    onChanged();
  }
  function rejectedMissing(id: string) {
    releaseIconRequest(sessionStorage, scope, id);
    original.current = null;
    setPending(null);
    onBlocked(false);
    setNotice((rejected.current ?? "操作未受理") + "；请核对后再操作");
    rejected.current = null;
    setRefresh((v) => v + 1);
    onChanged();
  }
  async function check(id = original.current ?? lookup.trim()) {
    if (!live.current || !displayed() || work.current) return;
    if (!validIconRequest(id)) {
      setError("请输入有效操作编号");
      return;
    }
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    setError("");
    try {
      const raw = await api<unknown>(base + "/operations/" + id, {
        signal: controller.signal,
      });
      if (live.current && displayed() && generation === epoch.current)
        known(raw, id);
    } catch (reason) {
      if (
        live.current &&
        generation === epoch.current &&
        !controller.signal.aborted
      ) {
        if (
          reason instanceof ApiError &&
          reason.status === 404 &&
          original.current === id &&
          rejected.current
        )
          rejectedMissing(id);
        else {
          fail(reason);
          if (
            reason instanceof ApiError &&
            reason.status === 404 &&
            original.current === id
          )
            setNotice("尚未查到原回执，操作结果仍待核对");
        }
      }
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (generation === epoch.current) setBusy(false);
      }
    }
  }
  async function submit(clear = false, historical?: GroupIcon) {
    if (
      !live.current ||
      !displayed() ||
      work.current ||
      original.current ||
      blocked ||
      !ready ||
      !groups ||
      !metadata ||
      metadata.revision !== groups.revision ||
      !groupId
    )
      return;
    if (
      !clear &&
      !historical &&
      (!file ||
        file.size <= 0 ||
        file.size > metadata.maxBytes ||
        !metadata.extensions.includes(
          file.name.split(".").pop()?.toLowerCase() ?? "",
        ))
    ) {
      setError("请选择JPG、PNG、GIF、WEBP或SVG，最大2MiB");
      return;
    }
    const id = requestId(),
      generation = epoch.current,
      controller = new AbortController();
    let body: FormData | string;
    if (clear || historical)
      body = JSON.stringify({
        requestId: id,
        expectedRevision: metadata.revision,
        action: "update",
        data: { id: groupId, icon: historical?.url ?? "" },
      });
    else {
      body = new FormData();
      body.set("requestId", id);
      body.set("expectedRevision", String(metadata.revision));
      body.set("file", file!);
    }
    try {
      retainIconRequest(sessionStorage, scope, id);
    } catch (reason) {
      fail(reason);
      return;
    }
    original.current = id;
    rejected.current = null;
    setPending(id);
    onBlocked(true);
    setReceipt(null);
    setNotice("");
    setError("");
    work.current = controller;
    setBusy(true);
    clearFile();
    clearPreview();
    try {
      const raw = await api<unknown>(
        clear || historical
          ? base + "/operations"
          : base + "/" + encodeURIComponent(groupId) + "/icon",
        { method: "POST", body, signal: controller.signal },
        session.csrf,
        60000,
      );
      if (live.current && displayed() && generation === epoch.current)
        known(raw, id);
    } catch (reason) {
      if (
        live.current &&
        generation === epoch.current &&
        !controller.signal.aborted
      ) {
        fail(reason);
        if (reason instanceof ApiError && ![401, 403].includes(reason.status)) {
          if ([400, 404, 405, 409, 413, 415, 422, 429].includes(reason.status))
            rejected.current = reason.message;
          try {
            const raw = await api<unknown>(base + "/operations/" + id, {
              signal: controller.signal,
            });
            if (live.current && displayed() && generation === epoch.current)
              known(raw, id);
          } catch (lookupError) {
            if (
              live.current &&
              generation === epoch.current &&
              !controller.signal.aborted
            ) {
              if (
                lookupError instanceof ApiError &&
                lookupError.status === 404 &&
                rejected.current
              )
                rejectedMissing(id);
              else if (
                lookupError instanceof ApiError &&
                [401, 403].includes(lookupError.status)
              )
                fail(lookupError);
              else setNotice("图标操作结果尚未确认，请查询原编号");
            }
          }
        }
      }
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (generation === epoch.current) setBusy(false);
      }
    }
  }
  async function readMedia(media: GroupIcon, originalBytes: boolean) {
    if (!live.current || !displayed() || work.current) return;
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    setError("");
    clearPreview();
    try {
      const context = {
        csrf: session.csrf,
        current: () =>
          live.current && generation === epoch.current && displayed(),
      };
      if (originalBytes) {
        const blob = await iconBlob(media, true, context, controller.signal);
        if (!context.current()) return;
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "group-icon-" + media.version + ".original";
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      } else {
        const data = await iconDataPreview(media, context, controller.signal);
        if (!context.current()) return;
        setPreviewUrl(data);
        setPreviewVersion(media.version);
      }
    } catch (reason) {
      if (
        live.current &&
        generation === epoch.current &&
        !controller.signal.aborted
      )
        fail(reason);
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (generation === epoch.current) setBusy(false);
      }
    }
  }
  async function loadHistory(more = false) {
    if (
      !live.current ||
      !displayed() ||
      busy ||
      !groupId ||
      (more && !historyCursor)
    )
      return;
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    setError("");
    try {
      const raw = await api<{
        groupId: string;
        items: (GroupIcon & {
          createdAt: string;
          current: boolean;
          availability: string;
        })[];
        nextCursor: string | null;
        originalsRetained: boolean;
      }>(
        base +
          "/" +
          encodeURIComponent(groupId) +
          "/icons?limit=50" +
          (more ? "&after=" + encodeURIComponent(historyCursor!) : ""),
        { signal: controller.signal },
      );
      if (live.current && displayed() && generation === epoch.current) {
        if (
          raw.groupId !== groupId ||
          !Array.isArray(raw.items) ||
          raw.items.length > 50 ||
          raw.items.some((item) => groupIcon(item).groupId !== groupId)
        )
          throw new Error("图标历史归属待核对");
        setHistory((previous) =>
          more ? [...previous, ...raw.items] : raw.items,
        );
        setHistoryCursor(raw.nextCursor);
        setHistoryReady(true);
      }
    } catch (reason) {
      if (!controller.signal.aborted && generation === epoch.current)
        fail(reason);
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (generation === epoch.current) setBusy(false);
      }
    }
  }
  useEffect(() => {
    const action = queued.current;
    if (
      !library ||
      !action ||
      !active ||
      locked ||
      busy ||
      pending ||
      blocked ||
      !ready ||
      !metadata ||
      metadata.revision !== groups?.revision ||
      metadata.group.id !== groupId ||
      (action === "upload" && !file)
    )
      return;
    queued.current = null;
    void submit(action === "clear");
  }, [
    library,
    active,
    locked,
    busy,
    pending,
    blocked,
    ready,
    metadata,
    groups?.revision,
    groupId,
    file,
  ]);
  const custom = groups?.groups.filter((g) => g.kind === "custom") ?? [],
    disabled = !active || locked || busy || !!pending || blocked || !ready;
  if (library)
    return (
      <section className="asset-group-library">
        <input
          hidden
          ref={input}
          type="file"
          accept=".jpg,.jpeg,.png,.gif,.webp,.svg"
          aria-label="更换股票分组图标"
          onChange={(e) => {
            const selected = e.target.files?.[0];
            if (selected) {
              queued.current = "upload";
              setFile(selected);
            } else queued.current = null;
          }}
        />
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {pending && (
          <div className="notice">
            <span>图标操作结果待确认</span>
            <button
              disabled={!active || locked || busy || !ready}
              onClick={() => void check()}
            >
              核对原操作
            </button>
          </div>
        )}
        {receipt && !pending && (
          <p role="status">
            {receipt.state === "failed"
              ? receipt.message
              : receipt.icon
                ? "图标已更新"
                : "分组图标已移除，原件已保留"}
          </p>
        )}
        <div className="asset-library-items list">
          {custom
            .filter((g) => library.visibleIds.includes(g.id))
            .map((g, i) => (
              <article className="asset-library-item" key={g.id}>
                <span className="asset-library-rank">{i + 1}</span>
                <button
                  type="button"
                  className="asset-library-picture asset-library-icon-button asset-icon-frame"
                  aria-label={`更换 ${g.name} 图标`}
                  disabled={disabled}
                  onClick={() => {
                    if (groupId !== g.id) {
                      setGroupId(g.id);
                      setMetadata(null);
                    }
                    setReceipt(null);
                    input.current?.click();
                  }}
                >
                  <StockGroupThumbnail
                    key={g.id + ":" + groups?.revision}
                    groupId={g.id}
                    session={session}
                    active={active}
                  />
                  <span className="asset-library-camera" aria-hidden="true">
                    <Camera size={17} />
                  </span>
                </button>
                <span className="asset-library-caption">
                  {library.renderName(g)}
                </span>
                <button
                  type="button"
                  className="asset-row-remove"
                  title="移除分组图标，保留分组和原件"
                  aria-label={`移除 ${g.name} 图标`}
                  disabled={disabled}
                  onClick={() => {
                    queued.current = "clear";
                    setReceipt(null);
                    if (groupId !== g.id) {
                      setGroupId(g.id);
                      setMetadata(null);
                    } else setRefresh((v) => v + 1);
                  }}
                >
                  <Trash2 size={17} />
                </button>
              </article>
            ))}
        </div>
      </section>
    );
  return (
    <section className="watch-group-icons">
      <h2>分组图标</h2>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="watch-icon-fields">
        <SelectMenu
          label="图标分组"
          value={groupId}
          options={[
            { value: "", label: "选择自定义分组" },
            ...custom.map((g) => ({ value: g.id, label: g.name })),
          ]}
          onChange={(value) => {
            clearFile();
            clearPreview();
            setReceipt(null);
            setMetadata(null);
            ++epoch.current;
            setHistory([]);
            setHistoryCursor(null);
            setHistoryReady(false);
            setGroupId(value);
          }}
          disabled={disabled}
          variant="field"
        />
        <label>
          图片
          <input
            ref={input}
            type="file"
            accept=".jpg,.jpeg,.png,.gif,.webp,.svg"
            disabled={disabled || !metadata}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button
          type="button"
          className="primary"
          disabled={
            disabled ||
            !file ||
            !metadata ||
            metadata.revision !== groups?.revision
          }
          onClick={() => void submit()}
        >
          上传图标
        </button>
        <button
          type="button"
          disabled={
            disabled ||
            !metadata ||
            metadata.sourceState === "empty" ||
            metadata.revision !== groups?.revision
          }
          onClick={() => void submit(true)}
        >
          清空图标
        </button>
      </div>
      {metadata?.sourceState === "unmapped" && (
        <p role="status">旧图标尚未有本人文件映射</p>
      )}
      {metadata?.icon && (
        <IconVersionActions
          media={metadata.icon}
          label="当前版本"
          disabled={disabled}
          onRead={readMedia}
        />
      )}
      {groupId && (
        <details>
          <summary>保留的图标版本</summary>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void loadHistory()}
          >
            读取版本
          </button>
          {history.map((item) => (
            <div key={item.version}>
              <IconVersionActions
                media={item}
                label={(item.current ? "当前 · " : "") + item.createdAt}
                disabled={disabled}
                onRead={readMedia}
              />
              <small>原件可用性按读取结果核对</small>
              <button
                type="button"
                disabled={
                  disabled ||
                  item.current ||
                  !metadata ||
                  metadata.revision !== groups?.revision
                }
                onClick={() => void submit(false, item)}
              >
                使用此版本
              </button>
            </div>
          ))}
          {historyReady && !history.length && <p>暂无保留版本</p>}
          {historyCursor && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => void loadHistory(true)}
            >
              读取更多版本
            </button>
          )}
        </details>
      )}
      <div className="watch-icon-lookup">
        <label>
          图标操作编号
          <input
            value={pending ?? lookup}
            onChange={(e) => setLookup(e.target.value)}
            readOnly={!!pending}
            disabled={locked}
            spellCheck={false}
          />
        </label>
        <button
          type="button"
          disabled={
            !active ||
            locked ||
            busy ||
            !ready ||
            !validIconRequest(pending ?? lookup.trim())
          }
          onClick={() => void check()}
        >
          查询图标回执
        </button>
      </div>
      {pending && <p role="status">原图标操作待核对 · {pending}</p>}
      {receipt && (
        <div role="status">
          <p>
            {receipt.state === "failed"
              ? receipt.message
              : receipt.icon
                ? "图标已保存"
                : "回执中的图标为空"}
          </p>
          {receipt.icon && (
            <IconVersionActions
              media={receipt.icon}
              label="回执版本"
              disabled={!active || locked || busy}
              onRead={readMedia}
            />
          )}
          <details>
            <summary>操作详情</summary>
            <dl>
              <dt>操作编号</dt>
              <dd>{receipt.requestId}</dd>
              <dt>分组版本</dt>
              <dd>{receipt.revision}</dd>
              {receipt.group && (
                <>
                  <dt>分组编号</dt>
                  <dd>{receipt.group.id}</dd>
                </>
              )}
            </dl>
          </details>
        </div>
      )}
      {previewUrl && (
        <figure>
          <img ref={image} src={previewUrl} alt="分组图标预览" />
          <figcaption>{previewVersion}</figcaption>
        </figure>
      )}
    </section>
  );
}
export function IconVersionActions({
  media,
  label,
  disabled,
  onRead,
}: {
  media: GroupIcon;
  label: string;
  disabled: boolean;
  onRead: (media: GroupIcon, original: boolean) => void;
}) {
  return (
    <div className="watch-icon-version">
      <span>
        {label} · {media.version}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onRead(media, false)}
      >
        预览
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onRead(media, true)}
      >
        下载原件
      </button>
    </div>
  );
}

function StockGroupThumbnail({
  groupId,
  session,
  active,
}: {
  groupId: string;
  session: Session;
  active: boolean;
}) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    setSrc("");
    if (!active) return;
    const abort = new AbortController();
    const current = () =>
      !abort.signal.aborted && apiSessionSnapshot().csrf === session.csrf;
    void api<unknown>(
      "/watch-groups/" + encodeURIComponent(groupId) + "/icon",
      { signal: abort.signal },
    )
      .then((raw) => {
        const value = iconCurrent(raw, groupId);
        return value.icon
          ? iconDataPreview(
              value.icon,
              { csrf: session.csrf, current },
              abort.signal,
            )
          : "";
      })
      .then((v) => {
        if (current()) setSrc(v);
      })
      .catch(() => {});
    return () => abort.abort();
  }, [groupId, session.csrf, active]);
  return src ? (
    <img src={src} alt="" decoding="async" />
  ) : (
    <ImageOff size={20} />
  );
}
