import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { requestId } from "./request-id";
import { SelectMenu } from "./select-menu";
import { resourceSize } from "./resource-state";
import { sourceReadFailure, sourceWindowLabel } from "./source-window-view";
import { attachmentArchiveOriginal } from "./attachment-import-original";
import {
  attachmentImportUuid,
  clearAttachmentImportRequests,
  readAttachmentImportRequest,
  retainAttachmentImportRequest,
  releaseAttachmentImportRequest,
  archiveSummary,
  archivePage,
  attachmentImportPlan,
  attachmentSourceSegment,
  importReceipt,
  archivePhase,
  captureWindow,
  attachmentSourceReason,
  type AttachmentSource,
  type ArchiveSummary,
  type ArchivePage,
  type ArchiveItem,
  type AttachmentImportPlan,
  type AttachmentImportReceipt,
} from "./attachment-import-state";
import "./attachment-import.css";
const base = "/admin/attachment-import";
type Props = {
  session: Session;
  active: boolean;
  blocked: boolean;
  onBlocked: (value: boolean) => void;
  onChanged: () => void;
  onDenied: (reason: unknown) => void;
};
export function AttachmentImportPanel(props: Props) {
  if (props.session.user.role !== "admin")
    return <p role="alert">需要管理员权限</p>;
  return (
    <AttachmentImportSession
      key={JSON.stringify([
        props.session.instance_id,
        props.session.user.id,
        props.session.user.role,
        props.session.receipt_scope,
        props.session.csrf,
        props.session.expires_at,
      ])}
      {...props}
    />
  );
}
function AttachmentImportSession({
  session,
  active,
  blocked,
  onBlocked,
  onChanged,
  onDenied,
}: Props) {
  const scope = JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  const [sources, setSources] = useState<AttachmentSource[]>([]),
    [sourceError, setSourceError] = useState(""),
    [sourceAlias, setSourceAlias] = useState(""),
    [clock, setClock] = useState(Date.now()),
    [catalog, setCatalog] = useState<ArchiveSummary[] | null>(null),
    [catalogCursor, setCatalogCursor] = useState<string | null>(null),
    [nextCatalog, setNextCatalog] = useState<string | null>(null);
  const [selected, setSelected] = useState(""),
    [page, setPage] = useState<ArchivePage | null>(null),
    [after, setAfter] = useState(-1),
    [history, setHistory] = useState<number[]>([]),
    [pageRefresh, setPageRefresh] = useState(0),
    [maxItems, setMaxItems] = useState("32"),
    [retry, setRetry] = useState(false),
    [proof, setProof] = useState<AttachmentImportPlan | null>(null);
  const [pending, setPending] = useState<string | null>(null),
    [lookup, setLookup] = useState(""),
    [closeKind, setCloseKind] = useState<"capture" | "segment">("capture"),
    [receipt, setReceipt] = useState<AttachmentImportReceipt | null>(null),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [locked, setLocked] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const live = useRef(false),
    epoch = useRef(0),
    read = useRef(0),
    original = useRef<string | null>(null),
    rejected = useRef<string | null>(null),
    work = useRef<AbortController | null>(null),
    reading = useRef<AbortController | null>(null),
    manifestRead = useRef<AbortController | null>(null),
    planEpoch = useRef(0);
  const displayed = useCallback(
    () => apiSessionSnapshot().csrf === session.csrf,
    [session.csrf],
  );
  const pause = useCallback(() => {
    live.current = false;
    ++epoch.current;
    ++read.current;
    work.current?.abort();
    work.current = null;
    reading.current?.abort();
    reading.current = null;
    manifestRead.current?.abort();
    manifestRead.current = null;
    setSources([]);
    setCatalog(null);
    setPage(null);
    setProof(null);
    setReceipt(null);
    setError("");
    setNotice("");
    setSourceError("");
    setReady(false);
    setBusy(false);
  }, []);
  const fail = useCallback(
    (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "来源读取失败");
      if (
        !displayed() ||
        (reason instanceof ApiError &&
          ([401, 403].includes(reason.status) ||
            reason.code === "session_changed"))
      ) {
        pause();
        setLocked(true);
        setSourceAlias("");
        setSelected("");
        setLookup("");
        setNotice("");
        original.current = null;
        setPending(null);
        try {
          clearAttachmentImportRequests(sessionStorage);
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
    if (!live.current || !displayed()) return;
    try {
      const id = readAttachmentImportRequest(sessionStorage, scope);
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
  const load = useCallback(async () => {
    if (!live.current || !displayed()) return;
    const generation = epoch.current,
      sequence = ++read.current,
      controller = new AbortController();
    reading.current?.abort();
    reading.current = controller;
    setSourceError("");
    const values = await Promise.allSettled([
      api<{ items: AttachmentSource[]; state?: string; message?: string }>(
        base + "/sources",
        { signal: controller.signal },
      ),
      api<{ items: unknown[]; nextCursor: string | null }>(
        base +
          "/snapshots?limit=25" +
          (catalogCursor ? "&after=" + catalogCursor : ""),
        { signal: controller.signal },
      ),
    ]);
    if (
      !live.current ||
      !displayed() ||
      generation !== epoch.current ||
      sequence !== read.current ||
      controller.signal.aborted
    )
      return;
    for (const value of values)
      if (
        value.status === "rejected" &&
        value.reason instanceof ApiError &&
        [401, 403].includes(value.reason.status)
      ) {
        fail(value.reason);
        return;
      }
    const [options, list] = values;
    if (
      options.status === "fulfilled" &&
      Array.isArray(options.value.items) &&
      options.value.items.every(
        (s) =>
          typeof s.alias === "string" &&
          s.namespace === "admin_shared" &&
          s.scope === "attachments.migrate" &&
          s.migrationWindow &&
          typeof s.migrationWindow.state === "string",
      )
    ) {
      setSources(options.value.items);
      setSourceError(
        options.value.state === "unavailable"
          ? (options.value.message ?? "来源登记无法核验")
          : "",
      );
      setClock(Date.now());
    } else {
      setSources([]);
      setSourceError(
        options.status === "rejected" && options.reason instanceof Error
          ? options.reason.message
          : "来源选项待核对",
      );
    }
    if (list.status === "fulfilled") {
      try {
        if (
          !Array.isArray(list.value.items) ||
          (list.value.nextCursor !== null &&
            !attachmentImportUuid(list.value.nextCursor))
        )
          throw new Error("来源清单列表待核对");
        setCatalog(list.value.items.map(archiveSummary));
        setNextCatalog(list.value.nextCursor);
      } catch (reason) {
        setCatalog(null);
        fail(reason);
      }
    } else {
      setCatalog(null);
      fail(list.reason);
    }
    if (reading.current === controller) reading.current = null;
  }, [catalogCursor, displayed, fail]);
  useEffect(() => {
    if (active && !locked) void load();
  }, [active, locked, load]);
  const loadPage = useCallback(async () => {
    setPage(null);
    setProof(null);
    if (!live.current || !displayed() || !attachmentImportUuid(selected))
      return;
    const generation = epoch.current,
      controller = new AbortController();
    manifestRead.current?.abort();
    manifestRead.current = controller;
    try {
      const raw = await api<unknown>(
        base + "/snapshots/" + selected + "?after=" + after + "&limit=50",
        { signal: controller.signal },
      );
      if (
        live.current &&
        displayed() &&
        generation === epoch.current &&
        !controller.signal.aborted
      )
        setPage(archivePage(raw, selected));
    } catch (reason) {
      if (
        live.current &&
        generation === epoch.current &&
        !controller.signal.aborted
      )
        fail(reason);
    }
  }, [selected, after, displayed, fail]);
  useEffect(() => {
    if (active && !locked) void loadPage();
  }, [active, locked, pageRefresh, loadPage]);
  useLayoutEffect(() => {
    if (blocked) {
      ++planEpoch.current;
      setProof(null);
    }
  }, [blocked]);
  const source = sources.find((s) => s.alias === sourceAlias),
    window = captureWindow(source?.migrationWindow, clock);
  useEffect(() => {
    if (!active || !source) return;
    const dates = [
      Date.parse(source.migrationWindow.notBefore ?? ""),
      Date.parse(source.migrationWindow.expiresAt ?? ""),
    ].filter((t) => Number.isFinite(t) && t > Date.now());
    if (!dates.length) return;
    const timer = setTimeout(
      () => setClock(Date.now()),
      Math.min(2147483647, Math.min(...dates) - Date.now() + 20),
    );
    return () => clearTimeout(timer);
  }, [active, source, clock]);
  function selectManifest(id: string) {
    manifestRead.current?.abort();
    setPage(null);
    setProof(null);
    setSelected(id);
    setAfter(-1);
    setHistory([]);
    setPageRefresh((v) => v + 1);
  }
  function known(raw: unknown, id: string) {
    const value = importReceipt(raw, id);
    if (original.current === id) {
      releaseAttachmentImportRequest(sessionStorage, scope, id);
      original.current = null;
      setPending(null);
      rejected.current = null;
      onBlocked(false);
    }
    setReceipt(value);
    setLookup(id);
    setError("");
    setNotice("");
    setProof(null);
    if (value.manifestId) {
      selectManifest(value.manifestId);
    } else setPageRefresh((v) => v + 1);
    void load();
    onChanged();
  }
  function rejectedMissing(id: string) {
    releaseAttachmentImportRequest(sessionStorage, scope, id);
    original.current = null;
    setPending(null);
    onBlocked(false);
    setNotice((rejected.current ?? "上次操作未受理") + "；请核对后再操作");
    rejected.current = null;
    setProof(null);
    void load();
    void loadPage();
    onChanged();
  }
  async function query(id = original.current ?? lookup.trim()) {
    if (!live.current || !displayed() || work.current) return;
    if (!attachmentImportUuid(id)) {
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
  async function preview() {
    if (
      !live.current ||
      !displayed() ||
      work.current ||
      !page ||
      page.instanceReenrollmentRequired
    )
      return;
    const generation = epoch.current,
      proofGeneration = planEpoch.current,
      controller = new AbortController(),
      id = selected;
    work.current = controller;
    setBusy(true);
    setProof(null);
    setError("");
    try {
      const raw = await api<unknown>(
        base + "/snapshots/" + id + "/preview",
        {
          method: "POST",
          body: JSON.stringify({
            maxItems: Number(maxItems),
            retryBlocked: retry,
          }),
          signal: controller.signal,
        },
        session.csrf,
      );
      const fresh = archivePage(
        await api<unknown>(
          base + "/snapshots/" + id + "?after=" + after + "&limit=50",
          { signal: controller.signal },
        ),
        id,
      );
      const proof = attachmentImportPlan(raw, fresh, Number(maxItems), retry);
      if (
        live.current &&
        displayed() &&
        generation === epoch.current &&
        proofGeneration === planEpoch.current
      ) {
        setPage(fresh);
        setProof(proof);
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
  async function write(kind: "capture" | "segment") {
    if (
      !live.current ||
      !displayed() ||
      work.current ||
      original.current ||
      blocked ||
      !ready
    )
      return;
    const id = requestId(),
      generation = epoch.current,
      controller = new AbortController();
    let body: unknown, path: string;
    try {
      if (kind === "capture") {
        if (
          captureWindow(source?.migrationWindow).state !== "active" ||
          !source
        )
          throw new Error("取数窗口未生效或已到期，请重新读取来源状态");
        body = { requestId: id, sourceAlias: source.alias };
        path = base + "/snapshots";
      } else {
        body = attachmentSourceSegment(
          id,
          proof,
          page,
          Number(maxItems),
          retry,
        );
        path = base + "/snapshots/" + selected + "/segments";
      }
      retainAttachmentImportRequest(sessionStorage, scope, id);
    } catch (reason) {
      fail(reason);
      return;
    }
    original.current = id;
    setPending(id);
    setCloseKind(kind);
    onBlocked(true);
    rejected.current = null;
    setReceipt(null);
    setNotice("");
    setError("");
    setProof(null);
    work.current = controller;
    setBusy(true);
    try {
      const raw = await api<unknown>(
        path,
        {
          method: "POST",
          body: JSON.stringify(body),
          signal: controller.signal,
        },
        session.csrf,
        300000,
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
              else setNotice("附件导入结果尚未确认，请查询原编号");
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
  async function close() {
    const id = original.current;
    if (!id || !live.current || !displayed() || work.current) return;
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    setError("");
    try {
      const raw = await api<unknown>(
        base + "/operations/" + id + "/close",
        {
          method: "POST",
          body: JSON.stringify({ expectedKind: closeKind }),
          signal: controller.signal,
        },
        session.csrf,
      );
      if (live.current && displayed() && generation === epoch.current)
        known(raw, id);
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
  async function download(item: ArchiveItem) {
    if (!live.current || !displayed() || work.current || !page) return;
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    setError("");
    try {
      const blob = await attachmentArchiveOriginal(
        page.manifestId,
        item,
        {
          csrf: session.csrf,
          current: () =>
            live.current && generation === epoch.current && displayed(),
        },
        controller.signal,
      );
      if (!live.current || generation !== epoch.current || !displayed()) return;
      const url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        item.evidence.path.split("/").pop() || "source-original";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
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
  const disabled = !active || locked || busy || !ready || !!pending || blocked;
  const manifestOptions = [
    { value: "", label: "选择已归档清单" },
    ...(catalog ?? []).map((s) => ({
      value: s.manifestId,
      label:
        s.manifest.sourceAlias +
        " · " +
        s.manifestId.slice(0, 8) +
        " · " +
        archivePhase(s),
    })),
  ];
  if (selected && !manifestOptions.some((v) => v.value === selected))
    manifestOptions.push({
      value: selected,
      label: "已选清单 · " + selected.slice(0, 8),
    });
  const sourceOptions = [
    { value: "", label: "选择已登记来源" },
    ...sources.map((s) => ({ value: s.alias, label: s.alias })),
  ];
  if (sourceAlias && !sourceOptions.some((s) => s.value === sourceAlias))
    sourceOptions.push({
      value: sourceAlias,
      label: "来源待核对 · " + sourceAlias,
    });
  const reason = (value: string | null | undefined) =>
    value?.startsWith("source_migration_")
      ? sourceReadFailure(value)
      : attachmentSourceReason(value);
  return (
    <section className="attachment-import-panel">
      <div className="attachment-import-heading">
        <h2>来源导入</h2>
        <span>全局共享</span>
        <button
          type="button"
          onClick={() => {
            setProof(null);
            void load();
            void loadPage();
          }}
          disabled={!active || locked || busy}
        >
          重新读取
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="attachment-import-capture">
        <SelectMenu
          label="共享附件来源"
          value={sourceAlias}
          options={sourceOptions}
          onChange={setSourceAlias}
          disabled={disabled}
          variant="field"
        />
        <button
          type="button"
          disabled={disabled || window.state !== "active"}
          onClick={() => void write("capture")}
        >
          捕获清单
        </button>
      </div>
      {sourceError && <p role="alert">{sourceError}</p>}
      {source && (
        <p className="attachment-import-window">{sourceWindowLabel(window)}</p>
      )}
      {!sourceError && sources.length === 0 && ready && (
        <p>未登记共享附件来源</p>
      )}
      <div className="attachment-import-catalog">
        <SelectMenu
          label="已归档清单"
          value={selected}
          options={manifestOptions}
          onChange={selectManifest}
          disabled={!active || locked || busy}
          variant="field"
        />
        <button
          type="button"
          disabled={!catalogCursor || busy || locked}
          onClick={() => setCatalogCursor(null)}
        >
          最新清单
        </button>
        <button
          type="button"
          disabled={!nextCatalog || busy || locked}
          onClick={() => setCatalogCursor(nextCatalog)}
        >
          更早清单
        </button>
      </div>
      {page && (
        <>
          <div className="attachment-import-summary">
            <strong>{archivePhase(page)}</strong>
            <span>本清单 {page.total} 项</span>
            <span>已应用 {page.applied} 项</span>
            <span>待应用 {page.pending} 项</span>
            <span>阻断 {page.blocked} 项</span>
            <span>
              {page.state === "sealed"
                ? "已知原件 " + resourceSize(page.manifest.knownFileBytes)
                : page.manifest.knownFileBytes > 0
                  ? "已知部分 " + resourceSize(page.manifest.knownFileBytes)
                  : "原件大小待核对"}
            </span>
            {page.targetChangedCount > 0 && (
              <span>目标变更 {page.targetChangedCount} 项</span>
            )}
          </div>
          {page.manifest.blockers.length > 0 && (
            <div role="status">
              {page.manifest.blockers.map((b, i) => (
                <p key={i}>
                  {b.path || "来源范围"} · {reason(b.reason)}
                </p>
              ))}
            </div>
          )}
          <div className="attachment-import-controls">
            <SelectMenu
              label="本段项目上限"
              value={maxItems}
              options={[
                { value: "1", label: "1 项" },
                { value: "8", label: "8 项" },
                { value: "16", label: "16 项" },
                { value: "32", label: "32 项" },
              ]}
              onChange={(v) => {
                setProof(null);
                setMaxItems(v);
              }}
              disabled={disabled}
              variant="field"
            />
            <label className="attachment-import-check">
              <input
                type="checkbox"
                checked={retry}
                disabled={disabled}
                onChange={(e) => {
                  setProof(null);
                  setRetry(e.target.checked);
                }}
              />
              重试已归档但应用受阻的项目
            </label>
            <button
              type="button"
              disabled={disabled || page.instanceReenrollmentRequired}
              onClick={() => void preview()}
            >
              预览本段
            </button>
            <button
              type="button"
              className="primary"
              disabled={
                disabled ||
                !proof ||
                !proof.items.length ||
                page.instanceReenrollmentRequired
              }
              onClick={() => void write("segment")}
            >
              应用本段
            </button>
          </div>
          {proof && <AttachmentImportPreview plan={proof} reason={reason} />}
          <div className="attachment-import-items">
            <h3>清单项目</h3>
            {page.items.map((item) => (
              <div className="attachment-import-item" key={item.ordinal}>
                <div>
                  <strong>{item.evidence.path}</strong>
                  <small>
                    {item.evidence.kind === "directory"
                      ? "文件夹"
                      : item.evidence.size === null
                        ? "大小未核实"
                        : resourceSize(item.evidence.size)}{" "}
                    ·{" "}
                    {item.apply_state === "applied"
                      ? "已应用"
                      : item.apply_state === "blocked" ||
                          item.evidence.captureState === "blocked"
                        ? reason(item.result?.reason ?? item.evidence.reason)
                        : "待应用"}
                  </small>
                </div>
                {item.evidence.kind === "file" &&
                  item.evidence.sha256 &&
                  item.evidence.size !== null &&
                  item.evidence.size <= 52428800 && (
                    <button
                      type="button"
                      disabled={busy || locked || !active}
                      onClick={() => void download(item)}
                    >
                      下载捕获原件
                    </button>
                  )}
              </div>
            ))}
          </div>
          <div className="attachment-import-pagination">
            <button
              type="button"
              disabled={!history.length || busy || locked}
              onClick={() => {
                setProof(null);
                setAfter(history[history.length - 1]);
                setHistory((h) => h.slice(0, -1));
              }}
            >
              上一页
            </button>
            <button
              type="button"
              disabled={page.nextAfter === null || busy || locked}
              onClick={() => {
                setProof(null);
                setHistory((h) => [...h, after]);
                setAfter(page.nextAfter!);
              }}
            >
              下一页
            </button>
          </div>
          <details>
            <summary>清单详情</summary>
            <dl>
              <dt>命名空间</dt>
              <dd>admin_shared</dd>
              <dt>清单编号</dt>
              <dd>{page.manifestId}</dd>
              <dt>清单校验值</dt>
              <dd>{page.digest}</dd>
              <dt>来源</dt>
              <dd>{page.manifest.sourceAlias}</dd>
            </dl>
          </details>
        </>
      )}
      <div className="attachment-import-lookup">
        <label>
          导入操作编号
          <input
            value={pending ?? lookup}
            onChange={(e) => setLookup(e.target.value)}
            readOnly={!!pending}
            spellCheck={false}
            disabled={locked}
          />
        </label>
        <button
          type="button"
          disabled={
            !active ||
            locked ||
            busy ||
            !ready ||
            !attachmentImportUuid(pending ?? lookup.trim())
          }
          onClick={() => void query()}
        >
          查询导入回执
        </button>
      </div>
      {pending && (
        <div className="attachment-import-close">
          <p role="status">原导入操作待核对 · {pending}</p>
          <SelectMenu
            label="待关闭操作类型"
            value={closeKind}
            options={[
              { value: "capture", label: "捕获清单" },
              { value: "segment", label: "应用本段" },
            ]}
            onChange={setCloseKind}
            disabled={busy || locked}
            variant="field"
          />
          <button
            type="button"
            disabled={busy || locked || !active}
            onClick={() => void close()}
          >
            显式关闭原操作
          </button>
        </div>
      )}
      {receipt && (
        <div role="status">
          <p>
            {receipt.state === "failed"
              ? receipt.message
              : receipt.kind === "capture"
                ? receipt.captureState === "sealed"
                  ? "来源清单已捕获"
                  : "来源捕获范围不完整"
                : receipt.targetImportCompleted
                  ? "本清单已全部应用"
                  : "本段应用已核对"}
          </p>
          <details>
            <summary>导入回执详情</summary>
            <dl>
              <dt>操作编号</dt>
              <dd>{receipt.requestId}</dd>
              <dt>命名空间</dt>
              <dd>admin_shared</dd>
              <dt>目录版本</dt>
              <dd>{receipt.revision}</dd>
            </dl>
          </details>
        </div>
      )}
    </section>
  );
}
export function AttachmentImportPreview({
  plan,
  reason,
}: {
  plan: AttachmentImportPlan;
  reason: (value: string | null | undefined) => string;
}) {
  return (
    <div className="attachment-import-preview">
      <h3>本段预览 · {plan.items.length} 项</h3>
      {plan.items.map((item) => (
        <div key={item.ordinal}>
          <span>{item.path}</span>
          <small>
            {item.status === "already_applied"
              ? "已经应用"
              : item.status === "blocked"
                ? "阻断"
                : "待应用"}
            {item.reason ? " · " + reason(item.reason) : ""}
          </small>
        </div>
      ))}
    </div>
  );
}
