import {AssetSourceControls} from "./asset-source-controls";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { Dialog } from "./dialog";
import { ReportLifetime, reportScope } from "./financial-report-lifetime";
import { requestId } from "./request-id";
import { SelectMenu } from "./select-menu";

type AssetEntry = {
  id: string;
  type: string;
  market: string;
  code: string;
  name: string;
  imageVersion?: string | null;
  darkImageVersion?: string | null;
  deleted?: boolean;
};
type Entries = {
  assets: AssetEntry[];
  revision: number;
  page: number;
  pageSize: number;
  total: number;
};
const assetTypes = [
  { value: "stock", label: "股票" },
  { value: "market", label: "市场" },
  { value: "flag", label: "国旗" },
  { value: "crypto", label: "加密资产" },
  { value: "metal", label: "贵金属" },
  { value: "broker", label: "券商图标" },
  { value: "group", label: "股票分组" },
] as const;
const emptyAsset = {
  id: "",
  type: "stock",
  market: "",
  code: "",
  name: "",
  imageVersion: "",
  darkImageVersion: "",
};

type Row = {
  id: string;
  state: string;
  error: string | null;
  materialState: { light: string; dark: string };
};
type Preview = {
  sha256: string;
  revision: number;
  entryCount: number;
  entries: Row[];
};
type Receipt = {
  requestId: string;
  state: "completed" | "closed";
  entries?: Row[];
  revision?: number;
  asset?: AssetEntry;
};
type Snapshot = {
  revision: number;
  sources: {
    id: string;
    sourceLabel: string;
    createdAt: string;
    result: Receipt;
  }[];
  availableImages: { id: string; path: string; type: string }[];
  imagesPartial: boolean;
};
const states: Record<string, string> = {
  "metadata-only": "仅清单",
  "unregistered-image": "图片未登记",
  "missing-or-unverified-bytes": "原件缺失或未核验",
  "registered-shared-image": "原件已核对",
  "identity-conflict": "标识冲突",
  "alias-conflict": "别名冲突",
  applied: "已登记",
  ready: "可登记",
  rejected: "未登记",
};

export function AssetLookupCatalogPanel({
  session,
  active = true,
  onChanged,
}: {
  session: Session;
  active?: boolean;
  onChanged?: () => void;
}) {
  if (session.user.role !== "admin") return null;
  const scope = reportScope(session);
  return (
    <CatalogSession
      key={JSON.stringify([scope, session.csrf, session.expires_at])}
      scope={scope}
      session={session}
      active={active}
      onChanged={onChanged}
    />
  );
}
function CatalogSession({
  scope,
  session,
  active,
  onChanged,
}: {
  scope: string;
  session: Session;
  active: boolean;
  onChanged?: () => void;
}) {
  const [opened, setOpened] = useState(false),
    [visible, setVisible] = useState(
      typeof document === "undefined" || !document.hidden,
    ),
    [locked, setLocked] = useState(false);
  const [head, setHead] = useState<Snapshot | null>(null),
    [text, setText] = useState(""),
    [label, setLabel] = useState("");
  const [confirmed, setConfirmed] = useState(false),
    [preview, setPreview] = useState<(Preview & { input: string }) | null>(
      null,
    );
  const [pending, setPending] = useState<string | null>(null),
    [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const storageKey = "alcor.asset-catalog.pending:" + scope;
  const [entries, setEntries] = useState<Entries | null>(null),
    [page, setPage] = useState(1),
    [showDeleted, setShowDeleted] = useState(false);
  const [editor, setEditor] = useState(emptyAsset),
    [editorRevision, setEditorRevision] = useState<number | null>(null),
    [editorConfirmed, setEditorConfirmed] = useState(false);
  const [target, setTarget] = useState<{
    asset: AssetEntry;
    revision: number;
    action: "delete" | "restore";
  } | null>(null);
  const editorGeneration = useRef(0);
  const [sourceView, setSourceView] = useState<{
    sourceLabel: string;
    manifestText: string;
    result: Receipt;
  } | null>(null);
  const working = useRef(false),
    sequence = useRef(0),
    reads = useRef(0);
  const [lifetime] = useState(
    () =>
      new ReportLifetime(
        () => apiSessionSnapshot().csrf === session.csrf,
        () => !document.hidden,
      ),
  );
  const pause = useCallback(() => {
    lifetime.pause();
    ++sequence.current;
    ++reads.current;
    working.current = false;
    setBusy(false);
  }, [lifetime]);
  const retire = useCallback(() => {
    pause();
    setLocked(true);
    setHead(null);
    setEntries(null);
    setEditor(emptyAsset);
    setEditorRevision(null);
    setEditorConfirmed(false);
    setTarget(null);
    setText("");
    setLabel("");
    setPreview(null);
    setReceipt(null);
    setSourceView(null);
    setConfirmed(false);
    setPending(null);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* old contents are already withdrawn */
    }
  }, [pause, storageKey]);
  function failure(reason: unknown) {
    setError(reason instanceof Error ? reason.message : "操作失败");
    if (
      apiSessionSnapshot().csrf !== session.csrf ||
      (reason instanceof ApiError &&
        ([401, 403].includes(reason.status) ||
          reason.code === "session_changed"))
    )
      retire();
  }
  useLayoutEffect(() => {
    lifetime.resume(active && visible && opened && !locked);
    return pause;
  }, [active, visible, opened, locked, lifetime, pause]);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (
        saved &&
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(saved)
      )
        throw Error("原操作编号无效");
      setPending(saved);
    } catch {
      setError("原操作编号无法读取");
      setLocked(true);
    }
  }, [storageKey]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) pause();
      setVisible(!document.hidden);
    };
    const changed = () => {
      retire();
      setError("登录身份已变化，请重新核对");
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("alcor:session-changed", changed);
    window.addEventListener("alcor:session-expired", changed);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("alcor:session-changed", changed);
      window.removeEventListener("alcor:session-expired", changed);
    };
  }, [pause, retire]);
  async function load() {
    const ticket = lifetime.begin();
    if (!ticket) return;
    const current = ++reads.current;
    try {
      const [value, listing] = await Promise.all([
        api<Snapshot>("/admin/asset-catalog", { signal: ticket.signal }),
        api<Entries>(
          `/admin/asset-catalog/entries?page=${page}&pageSize=10${showDeleted ? "&deleted=1" : ""}`,
          { signal: ticket.signal },
        ),
      ]);
      if (ticket.current() && current === reads.current) {
        setHead(value);
        setEntries(listing);
        setEditorRevision((old) => old ?? listing.revision);
      }
    } catch (reason) {
      if (apiSessionSnapshot().csrf !== session.csrf) retire();
      else if (ticket.current()) failure(reason);
    } finally {
      ticket.finish();
    }
  }
  useEffect(() => {
    if (active && visible && opened && !locked) void load();
  }, [active, visible, opened, locked, page, showDeleted]);
  const input = JSON.stringify([text, label, confirmed]);
  function changed() {
    ++sequence.current;
    setPreview(null);
  }
  async function run(kind: "preview" | "import" | "query" | "close") {
    if (working.current || locked) return;
    if (
      ["preview", "import"].includes(kind) &&
      (!confirmed || !label.trim() || !text.trim())
    )
      return;
    if (kind === "import" && (pending || !preview || preview.input !== input))
      return;
    if (["query", "close"].includes(kind) && !pending) return;
    const ticket = lifetime.begin();
    if (!ticket) return;
    const current = ++sequence.current,
      draft = input;
    let id = pending;
    const data = { manifestText: text, sourceLabel: label };
    let payload: unknown = data;
    if (kind === "import" && preview) {
      id = requestId();
      payload = {
        ...data,
        requestId: id,
        expectedRevision: preview.revision,
        expectedSha256: preview.sha256,
      };
      try {
        sessionStorage.setItem(storageKey, id);
        setPending(id);
      } catch {
        setError("原操作编号无法保存");
        ticket.finish();
        return;
      }
    }
    if (
      ["preview", "import"].includes(kind) &&
      (new TextEncoder().encode(text).length > 60000 ||
        new TextEncoder().encode(JSON.stringify(payload)).length > 65536)
    ) {
      if (kind === "import") {
        sessionStorage.removeItem(storageKey);
        setPending(null);
      }
      setError("清单或请求超过单批限制，请分批提交；内容不会截断。");
      ticket.finish();
      return;
    }
    working.current = true;
    setBusy(true);
    setError("");
    try {
      if (kind === "preview") {
        const result = await api<Preview>(
          "/admin/asset-catalog/preview",
          { method: "POST", body: JSON.stringify(data), signal: ticket.signal },
          session.csrf,
        );
        if (ticket.current() && current === sequence.current)
          setPreview({ ...result, input: draft });
      } else {
        const path =
          kind === "import"
            ? "/admin/asset-catalog/imports"
            : `/admin/asset-catalog/operations/${id}${kind === "close" ? "/close" : ""}`;
        const result = await api<Receipt>(
          path,
          {
            method: kind === "query" ? "GET" : "POST",
            ...(kind === "import" ? { body: JSON.stringify(payload) } : {}),
            signal: ticket.signal,
          },
          kind === "query" ? undefined : session.csrf,
        );
        if (!ticket.current() || current !== sequence.current) return;
        if (
          result.requestId !== id ||
          !["completed", "closed"].includes(result.state)
        )
          throw Error("素材操作回执不匹配");
        sessionStorage.removeItem(storageKey);
        setPending(null);
        setReceipt(result);
        if (result.state === "completed") onChanged?.();
        setPreview(null);
        void load();
      }
    } catch (reason) {
      if (apiSessionSnapshot().csrf !== session.csrf) retire();
      else if (ticket.current()) failure(reason);
    } finally {
      if (ticket.current()) {
        working.current = false;
        setBusy(false);
      }
      ticket.finish();
    }
  }
  const rows = preview?.input === input ? preview.entries : receipt?.entries;
  function edit(asset: AssetEntry) {
    ++editorGeneration.current;
    setEditor({
      id: asset.id,
      type: asset.type,
      market: asset.market,
      code: asset.code,
      name: asset.name,
      imageVersion: asset.imageVersion || "",
      darkImageVersion: asset.darkImageVersion || "",
    });
    setEditorRevision(entries?.revision ?? null);
    setEditorConfirmed(false);
  }
  async function manage(
    action: "save" | "delete" | "restore",
    chosen = target,
  ) {
    if (
      working.current ||
      locked ||
      pending ||
      !entries ||
      (action === "save" && (!editorConfirmed || editorRevision === null))
    )
      return;
    if (action !== "save" && !chosen) return;
    const ticket = lifetime.begin();
    if (!ticket) return;
    const id = requestId(),
      generation = editorGeneration.current;
    try {
      sessionStorage.setItem(storageKey, id);
    } catch {
      setError("原操作编号无法保存");
      ticket.finish();
      return;
    }
    setPending(id);
    working.current = true;
    setBusy(true);
    setError("");
    setTarget(null);
    setPreview(null);
    try {
      let value: Receipt;
      if (action === "delete" && chosen)
        value = await api<Receipt>(
          `/admin/asset-catalog/entries/${encodeURIComponent(chosen.asset.id)}?requestId=${id}&expectedRevision=${chosen.revision}`,
          { method: "DELETE", signal: ticket.signal },
          session.csrf,
        );
      else {
        const selected = action === "restore" && chosen ? chosen.asset : editor;
        const asset = {
          type: selected.type,
          market: selected.market,
          code: selected.code,
          name: selected.name,
          imageVersion: selected.imageVersion || null,
          darkImageVersion: selected.darkImageVersion || null,
          ...(selected.id ? { id: selected.id } : {}),
        };
        value = await api<Receipt>(
          "/admin/asset-catalog/entries",
          {
            method: "POST",
            signal: ticket.signal,
            body: JSON.stringify({
              requestId: id,
              expectedRevision:
                action === "restore" && chosen
                  ? chosen.revision
                  : editorRevision,
              publicMetadataConfirmed: true,
              asset,
              restore: action === "restore",
            }),
          },
          session.csrf,
        );
      }
      if (!ticket.current()) return;
      if (value.requestId !== id || value.state !== "completed")
        throw Error("素材操作回执不匹配");
      sessionStorage.removeItem(storageKey);
      setPending(null);
      setReceipt(value);
      onChanged?.();
      if (
        action === "save" &&
        value.asset &&
        generation === editorGeneration.current
      ) {
        setEditor({
          id: value.asset.id,
          type: value.asset.type,
          market: value.asset.market,
          code: value.asset.code,
          name: value.asset.name,
          imageVersion: value.asset.imageVersion || "",
          darkImageVersion: value.asset.darkImageVersion || "",
        });
        setEditorRevision(value.revision ?? null);
      }
      void load();
    } catch (reason) {
      if (apiSessionSnapshot().csrf !== session.csrf) retire();
      else if (ticket.current()) failure(reason);
    } finally {
      if (ticket.current()) {
        working.current = false;
        setBusy(false);
      }
      ticket.finish();
    }
  }
  async function viewSource(id: string) {
    if (working.current || locked) return;
    const ticket = lifetime.begin();
    if (!ticket) return;
    working.current = true;
    setBusy(true);
    try {
      const value = await api<{
        sourceLabel: string;
        manifestText: string;
        result: Receipt;
      }>(`/admin/asset-catalog/sources/${id}`, { signal: ticket.signal });
      if (ticket.current()) {
        setSourceView(value);
        setPreview(null);
        setReceipt(value.result);
      }
    } catch (reason) {
      if (apiSessionSnapshot().csrf !== session.csrf) retire();
      else if (ticket.current()) failure(reason);
    } finally {
      if (ticket.current()) {
        working.current = false;
        setBusy(false);
      }
      ticket.finish();
    }
  }
  return (
    <details
      className="card padded settings-section"
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary>公共素材目录</summary>
      {error && <p role="alert">{error}</p>}
      {opened && active && visible && !locked && (
        <>
          <button onClick={() => void load()} disabled={busy}>
            刷新
          </button>
          <AssetSourceControls session={session} active={opened&&active&&visible&&!locked} revision={entries?.revision??head?.revision??null} blocked={busy||!!pending} onChanged={()=>{setPreview(null);setEditorRevision(null);void load();onChanged?.();}} onDenied={failure}/>
          {entries && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={showDeleted}
                  onChange={(event) => {
                    setShowDeleted(event.target.checked);
                    setPage(1);
                  }}
                />
                已删除
              </label>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>分类</th>
                      <th>市场 / 代码</th>
                      <th>名称</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.assets.map((asset) => (
                      <tr key={asset.id}>
                        <td>
                          {assetTypes.find((type) => type.value === asset.type)
                            ?.label || asset.type}
                        </td>
                        <td>
                          {asset.market} / {asset.code}
                        </td>
                        <td>{asset.name}</td>
                        <td>
                          {showDeleted ? (
                            <button
                              disabled={
                                busy || !!pending || asset.type === "card"
                              }
                              onClick={() =>
                                setTarget({
                                  asset,
                                  action: "restore",
                                  revision: entries.revision,
                                })
                              }
                            >
                              恢复
                            </button>
                          ) : (
                            <>
                              <button
                                disabled={
                                  busy || !!pending || asset.type === "card"
                                }
                                onClick={() => edit(asset)}
                              >
                                编辑
                              </button>
                              <button
                                disabled={
                                  busy || !!pending || asset.type === "card"
                                }
                                onClick={() =>
                                  setTarget({
                                    asset,
                                    action: "delete",
                                    revision: entries.revision,
                                  })
                                }
                              >
                                删除
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!entries.assets.length && <p>暂无当前平台记录，历史覆盖未知</p>}
              <div>
                <button
                  disabled={page <= 1 || busy}
                  onClick={() => setPage(page - 1)}
                >
                  上一页
                </button>
                <span>
                  {page} /{" "}
                  {Math.max(1, Math.ceil(entries.total / entries.pageSize))}
                </span>
                <button
                  disabled={page * entries.pageSize >= entries.total || busy}
                  onClick={() => setPage(page + 1)}
                >
                  下一页
                </button>
              </div>
              <details>
                <summary>{editor.id ? "编辑素材" : "新增素材"}</summary>
                <button
                  disabled={busy || !!pending}
                  onClick={() => {
                    ++editorGeneration.current;
                    setEditor(emptyAsset);
                    setEditorRevision(entries.revision);
                    setEditorConfirmed(false);
                  }}
                >
                  新增
                </button>
                <div className="form-grid">
                  <label>
                    分类
                    <SelectMenu
                      label="目录分类"
                      value={editor.type}
                      options={assetTypes}
                      variant="field"
                      disabled={!!editor.id || busy}
                      onChange={(type) => {
                        ++editorGeneration.current;
                        setEditor({
                          ...editor,
                          type,
                          imageVersion: "",
                          darkImageVersion: "",
                        });
                        setEditorConfirmed(false);
                      }}
                    />
                  </label>
                  {(
                    [
                      ["market", "市场"],
                      ["code", "代码"],
                      ["name", "名称"],
                    ] as const
                  ).map(([field, label]) => (
                    <label key={field}>
                      {label}
                      <input
                        value={editor[field]}
                        maxLength={
                          field === "name" ? 120 : field === "market" ? 16 : 40
                        }
                        disabled={busy || (!!editor.id && field !== "name")}
                        onChange={(event) => {
                          ++editorGeneration.current;
                          setEditor({ ...editor, [field]: event.target.value });
                          setEditorConfirmed(false);
                        }}
                      />
                    </label>
                  ))}
                  {(
                    [
                      ["imageVersion", "浅色图片"],
                      ["darkImageVersion", "深色图片"],
                    ] as const
                  ).map(([field, label]) => (
                    <label key={field}>
                      {label}
                      <SelectMenu
                        label={label}
                        value={editor[field]}
                        options={[
                          { value: "", label: "不设置" },
                          ...(editor[field] &&
                          !head?.availableImages.some(
                            (image) => image.id === editor[field],
                          )
                            ? [{ value: editor[field], label: "当前关联图片" }]
                            : []),
                          ...(head?.availableImages
                            .filter((image) => image.type === editor.type)
                            .map((image) => ({
                              value: image.id,
                              label: image.path,
                            })) || []),
                        ]}
                        variant="field"
                        disabled={busy}
                        onChange={(value) => {
                          ++editorGeneration.current;
                          setEditor({ ...editor, [field]: value });
                          setEditorConfirmed(false);
                        }}
                      />
                    </label>
                  ))}
                </div>
                <label>
                  <input
                    type="checkbox"
                    checked={editorConfirmed}
                    onChange={(event) =>
                      setEditorConfirmed(event.target.checked)
                    }
                  />
                  确认本次素材字段可公开
                </label>
                <button
                  disabled={
                    busy ||
                    !!pending ||
                    !editorConfirmed ||
                    editorRevision === null ||
                    (["stock", "market"].includes(editor.type) &&
                      !editor.market.trim()) ||
                    (!["market", "group"].includes(editor.type) && !editor.code.trim())
                  }
                  onClick={() => void manage("save")}
                >
                  保存素材
                </button>
              </details>
            </>
          )}
          {pending && (
            <div>
              <p>操作结果待核对</p>
              <button disabled={busy} onClick={() => void run("query")}>
                查询原操作
              </button>
              <button disabled={busy} onClick={() => void run("close")}>
                关闭原操作
              </button>
            </div>
          )}
          <label>
            来源名称
            <input
              value={label}
              maxLength={120}
              onChange={(event) => {
                setLabel(event.target.value);
                changed();
              }}
            />
          </label>
          <label>
            素材清单
            <textarea
              rows={8}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                changed();
              }}
            />
          </label>
          <p>
            每批最多200项，清单60KB，请求64KiB；仅登记本批，不删除其他记录。
          </p>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => {
                setConfirmed(event.target.checked);
                changed();
              }}
            />
            确认清单仅包含可公开的素材字段
          </label>
          <button
            disabled={busy || !confirmed || !label.trim() || !text.trim()}
            onClick={() => void run("preview")}
          >
            预览
          </button>
          <button
            disabled={busy || !!pending || !preview || preview.input !== input}
            onClick={() => void run("import")}
          >
            登记
          </button>
          {rows && (
            <table>
              <thead>
                <tr>
                  <th>素材</th>
                  <th>结果</th>
                  <th>浅色原件</th>
                  <th>深色原件</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td>{states[row.error || row.state] || row.state}</td>
                    <td>
                      {states[row.materialState.light] ||
                        row.materialState.light}
                    </td>
                    <td>
                      {states[row.materialState.dark] || row.materialState.dark}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {head && (
            <details>
              <summary>最近20条来源与已登记图片</summary>
              {head.sources.map((source) => (
                <p key={source.id}>
                  {source.sourceLabel} · {source.createdAt} ·{" "}
                  {source.result.entries?.filter(
                    (row) => row.state === "applied",
                  ).length || 0}
                  项
                  <button
                    disabled={busy}
                    onClick={() => void viewSource(source.id)}
                  >
                    查看原清单与结果
                  </button>
                </p>
              ))}
              {head.imagesPartial && <p>当前图片列表为部分结果</p>}
              {head.availableImages.map((image) => (
                <p key={image.id}>
                  {image.path}
                  <br />
                  <code>{image.id}</code>
                </p>
              ))}
            </details>
          )}
          {sourceView && (
            <Dialog
              title={sourceView.sourceLabel}
              onClose={() => setSourceView(null)}
            >
              <textarea
                readOnly
                rows={14}
                value={sourceView.manifestText}
                aria-label="捕获的原清单"
              />
            </Dialog>
          )}
          {target && (
            <Dialog
              title={target.action === "restore" ? "恢复公共素材" : "删除素材"}
              onClose={() => setTarget(null)}
            >
              <p>{target.asset.name || target.asset.code}</p>
              {target.action === "restore" && (
                <p>恢复后将在公共素材目录显示。</p>
              )}
              <div className="dialog-actions">
                <button onClick={() => setTarget(null)}>取消</button>
                <button
                  disabled={busy || !!pending}
                  onClick={() => void manage(target.action, target)}
                >
                  {target.action === "restore" ? "恢复" : "删除"}
                </button>
              </div>
            </Dialog>
          )}
        </>
      )}
    </details>
  );
}
