import { WorkspaceEmpty, WorkspaceTabs, usePageReveal } from "./workspace-ui";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Folder,
  FolderPlus,
  Upload,
  RefreshCw,
  Pencil,
  Trash2,
  ChevronRight,
  Download,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  File,
  Search,
  X,
} from "lucide-react";
import { Dialog } from "./dialog";
import { useConfirmationDialog } from "./confirm-dialog";
import { FormActions } from "./workspace-forms";
import { feedDateTime } from "./feed-display";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, ApiError, type Session } from "./api";
import { requestId } from "./request-id";
import { submissionDisposition } from "./portfolio-operation";
import {
  type ResourceRequest,
  type ResourceKind,
  readResourceRequest,
  retainResourceRequest,
  releaseResourceRequest,
  resourceCursorHistory,
  resourceSelection,
  resourceSearch,
  resourceAncestors,
  type ResourceSelection,
} from "./resource-state";
import "./resources.css";
import { SelectMenu } from "./select-menu";
import { resourceSize as size } from "./resource-state";

type ResourceFolder = {
  id: string;
  name: string;
  category: string;
  parentId: string | null;
  revision: number;
};
type Resource = {
  id: string;
  name: string;
  kind: string;
  category: string;
  folderId: string | null;
  revision: number;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  downloadPath: string;
};
type Usage = { usedBytes: number; fileCount: number; quotaBytes: number };
type Page = { items: Resource[]; nextCursor: string | null; usage: Usage };
type Receipt = {
  requestId: string;
  kind: ResourceKind;
  state: "completed" | "failed";
  message?: string;
};
const base = "/resource-library";
const types: Record<string, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  document: "文档",
  archive: "压缩文件",
  other: "其他",
};
export function ResourcesPage({
  session,
  active = true,
}: {
  session: Session;
  active?: boolean;
}) {
  const scope = JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  return <ResourceSession key={scope} {...{ session, active, scope }} />;
}
function ResourceSession({
  session,
  active,
  scope,
}: {
  session: Session;
  active: boolean;
  scope: string;
}) {
  const [visible, setVisible] = useState(!document.hidden),
    [locked, setLocked] = useState(false);
  const location = useLocation(),
    navigate = useNavigate();
  const routeSelection = resourceSelection(location.search);
  const selection = {
    ...routeSelection,
    cursors: resourceCursorHistory(
      location.state?.resourceCursors,
      routeSelection.cursors.at(-1),
    ),
  };
  const {
    category,
    folder,
    kind,
    sort,
    direction,
    cursors,
    system,
    search = "",
  } = selection;
  const [searchDraft, setSearchDraft] = useState(search);
  useEffect(() => setSearchDraft(search), [search]);
  const selectionKey = JSON.stringify(selection);
  const reveal = usePageReveal(selection.page);
  const changeView = (patch: Partial<ResourceSelection>) => {
    if (patch.page !== undefined && patch.page !== selection.page)
      reveal.request();
    navigate(
      {
        pathname: location.pathname,
        search: resourceSearch(location.search, {
          ...selection,
          cursors: [],
          page: 1,
          ...patch,
        }),
      },
      { state: { resourceCursors: patch.cursors || [] } },
    );
  };
  const [uploadOpen, setUploadOpen] = useState(false),
    [folderOpen, setFolderOpen] = useState(false),
    [refreshing, setRefreshing] = useState(false);
  const confirmation = useConfirmationDialog(
    JSON.stringify([scope, active, visible, locked, selectionKey]),
  );
  const [folders, setFolders] = useState<ResourceFolder[]>([]),
    [page, setPage] = useState<Page | null>(null),
    [ready, setReady] = useState(false);
  const [error, setError] = useState(""),
    [result, setResult] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<ResourceRequest | null>(null);
  const [file, setFile] = useState<File | null>(null),
    [newFolder, setNewFolder] = useState("");
  const [edit, setEdit] = useState<{
    id: string;
    revision: number;
    name: string;
    target: string;
    folder: boolean;
    category: string;
  } | null>(null);
  const live = useRef(false),
    epoch = useRef(0),
    reads = useRef(0),
    fileInput = useRef<HTMLInputElement>(null),
    operation = useRef<ResourceRequest | null>(null),
    readController = useRef<AbortController | null>(null);
  const request = useRef<{ id: string; controller: AbortController } | null>(
      null,
    ),
    cancelInFlight = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  const clearFile = useCallback(() => {
    setFile(null);
    if (fileInput.current) fileInput.current.value = "";
  }, []);
  const fail = useCallback(
    (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "读取失败");
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
        live.current = false;
        ++epoch.current;
        setBusy(false);
        setLocked(true);
        setFolders([]);
        setPage(null);
        setEdit(null);
        setUploadOpen(false);
        setFolderOpen(false);
        setNewFolder("");
        clearFile();
      }
    },
    [clearFile],
  );
  useEffect(() => {
    const change = () => {
      if (document.hidden) clearFile();
      setVisible(!document.hidden);
    };
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, [clearFile]);
  useLayoutEffect(() => {
    live.current = active && visible && !locked;
    ++epoch.current;
    if (!live.current) {
      clearFile();
      setEdit(null);
      setUploadOpen(false);
      setFolderOpen(false);
      setPage(null);
      setFolders([]);
      setReady(false);
      setRefreshing(false);
    }
    return () => {
      live.current = false;
      ++epoch.current;
      ++reads.current;
      readController.current?.abort();
      setBusy(false);
      setRefreshing(false);
      setPage(null);
      setFolders([]);
      setReady(false);
      setEdit(null);
      setUploadOpen(false);
      setFolderOpen(false);
      clearFile();
    };
  }, [active, visible, locked, clearFile]);
  useEffect(() => {
    try {
      const value = readResourceRequest(sessionStorage, scope);
      operation.current = value;
      setPending(value);
    } catch (reason) {
      setLocked(true);
      fail(reason);
    }
  }, [scope, fail]);
  useLayoutEffect(() => {
    ++epoch.current;
    ++reads.current;
    readController.current?.abort();
    setPage(null);
    setBusy(false);
    setReady(false);
    setEdit(null);
    setUploadOpen(false);
    setFolderOpen(false);
    setResult("");
    clearFile();
  }, [selectionKey, clearFile]);
  const load = useCallback(async () => {
    if (!live.current) return;
    const generation = epoch.current,
      read = ++reads.current;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    setReady(false);
    setRefreshing(true);
    setError("");
    const current = () =>
      live.current &&
      !controller.signal.aborted &&
      generation === epoch.current &&
      read === reads.current;
    try {
      const q = new URLSearchParams({
        ...(system ? {} : { category }),
        ...(search && !folder ? {} : { folderId: folder ?? "root" }),
        sort,
        direction,
        limit: "30",
      });
      if (kind) q.set("kind", kind);
      if (search) q.set("q", search);
      if (cursors.length) q.set("cursor", cursors[cursors.length - 1]);
      const [tree, files] = await Promise.all([
        Promise.all(
          (system ? ["components", "media"] : [category]).map((value) =>
            api<{ items: ResourceFolder[] }>(
              base + "/folder-tree?" + new URLSearchParams({ category: value }),
              { signal: controller.signal },
            ),
          ),
        ).then((trees) => ({ items: trees.flatMap((tree) => tree.items) })),
        api<Page>(base + "/files?" + q, { signal: controller.signal }),
      ]);
      if (!current()) return;
      setFolders(tree.items);
      setPage(files);
      setReady(true);
    } catch (reason) {
      if (current()) fail(reason);
    } finally {
      if (current()) setRefreshing(false);
    }
  }, [selectionKey, fail]);
  useEffect(() => {
    if (active && visible && !locked) void load();
    return () => readController.current?.abort();
  }, [active, visible, locked, load]);
  function changeFolder(id: string | null) {
    changeView({
      folder: id,
      search: "",
      category: (folders.find((row) => row.id === id)?.category ??
        "components") as ResourceSelection["category"],
    });
  }
  function path(item: ResourceFolder): string {
    return resourceAncestors(folders, item.id)
      .map((row) => row.name)
      .join(" / ");
  }
  function known(receipt: Receipt, id: string) {
    if (
      receipt.requestId !== id ||
      (operation.current?.id === id &&
        operation.current.kind &&
        receipt.kind !== operation.current.kind)
    )
      throw new Error("原回执编号或操作类型不符，请继续核对原请求");
    if (!["completed", "failed"].includes(receipt.state))
      throw new Error("原操作状态尚未确定");
    ++epoch.current;
    if (request.current?.id === id) request.current.controller.abort();
    setBusy(false);
    releaseResourceRequest(sessionStorage, scope, id);
    operation.current = null;
    setPending(null);
    setError("");
    setResult(
      receipt.state === "completed"
        ? "已完成"
        : (receipt.message ?? "操作未完成"),
    );
    clearFile();
    setEdit(null);
    setUploadOpen(false);
    setFolderOpen(false);
    setNewFolder("");
    void load();
  }
  async function check() {
    if (!operation.current || busy || !live.current) return;
    const id = operation.current.id,
      current = epoch.current;
    setBusy(true);
    try {
      const receipt = await api<Receipt>(base + "/operations/" + id);
      if (live.current && current === epoch.current) known(receipt, id);
    } catch (reason) {
      if (current === epoch.current) fail(reason);
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  }
  async function mutate(
    route: string,
    method: string,
    data: Record<string, unknown> | FormData,
  ) {
    if (busy || operation.current || !live.current || !ready) return;
    const id = requestId(),
      current = epoch.current;
    const kind: ResourceKind =
      route === "/files" && method === "POST"
        ? "upload"
        : route === "/folders"
          ? "folder_create"
          : route.startsWith("/folders/")
            ? method === "DELETE"
              ? "folder_delete"
              : "folder_update"
            : method === "DELETE"
              ? "delete"
              : "file_update";
    const locator = { id, kind };
    const controller = new AbortController();
    try {
      retainResourceRequest(sessionStorage, scope, locator);
    } catch (reason) {
      fail(reason);
      return;
    }
    request.current = { id, controller };
    operation.current = locator;
    setPending(locator);
    setBusy(true);
    setError("");
    setResult("");
    const form = data instanceof FormData;
    if (form) data.set("requestId", id);
    try {
      const receipt = await api<Receipt>(
        base + route,
        {
          method,
          signal: controller.signal,
          body: form ? data : JSON.stringify({ ...data, requestId: id }),
        },
        session.csrf,
        form ? 300000 : 10000,
      );
      if (live.current && current === epoch.current) known(receipt, id);
    } catch (reason) {
      if (current !== epoch.current) return;
      if (
        reason instanceof ApiError &&
        submissionDisposition(reason.status) === "rejected"
      ) {
        releaseResourceRequest(sessionStorage, scope, id);
        operation.current = null;
        setPending(null);
      }
      fail(reason);
    } finally {
      if (request.current?.id === id) request.current = null;
      if (current === epoch.current) setBusy(false);
    }
  }
  async function cancelOriginal() {
    const pending = operation.current;
    if (!pending?.kind || cancelInFlight.current || !live.current) return;
    const current = epoch.current;
    cancelInFlight.current = true;
    setCancelling(true);
    setError("");
    try {
      const receipt = await api<Receipt>(
        `${base}/operations/${pending.id}/cancel`,
        {
          method: "POST",
          body: JSON.stringify({ expectedKind: pending.kind }),
        },
        session.csrf,
      );
      if (
        live.current &&
        current === epoch.current &&
        operation.current?.id === pending.id
      )
        known(receipt, pending.id);
    } catch (reason) {
      if (current === epoch.current) fail(reason);
    } finally {
      cancelInFlight.current = false;
      setCancelling(false);
    }
  }
  const parent = folders.find((f) => f.id === folder),
    children = folders
      .filter(
        (f) =>
          (search && !folder ? true : f.parentId === folder) &&
          (!search ||
            f.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())),
      )
      .sort(
        (a, b) =>
          (direction === "asc" ? 1 : -1) *
          (a.name.localeCompare(b.name, "zh-CN", { numeric: true }) ||
            a.id.localeCompare(b.id)),
      ),
    blocked = busy || !!pending || !ready || locked;
  function manage(item: Resource | ResourceFolder, isFolder: boolean) {
    setEdit({
      id: item.id,
      revision: item.revision,
      name: item.name,
      target:
        (isFolder
          ? (item as ResourceFolder).parentId
          : (item as Resource).folderId) ?? "",
      folder: isFolder,
      category: item.category,
    });
  }
  async function remove(item: Resource | ResourceFolder, isFolder: boolean) {
    if (blocked || !live.current) return;
    const current = epoch.current;
    if (
      !(await confirmation.ask(
        isFolder
          ? `删除空文件夹「${item.name}」？有文件或子目录时不会删除。`
          : `永久删除「${item.name}」？删除后不能从资源库恢复，历史操作记录继续保留。`,
        {
          title: isFolder ? "删除空文件夹" : "永久删除文件",
          confirmLabel: "删除",
        },
      ))
    )
      return;
    if (current === epoch.current && live.current)
      void mutate(`/${isFolder ? "folders" : "files"}/${item.id}`, "DELETE", {
        revision: item.revision,
      });
  }
  return (
    <section className="resource-page" ref={reveal.ref} tabIndex={-1}>
      <header className="page-heading">
        <h1>资源库</h1>
        <div className="resource-heading-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="新建文件夹"
            disabled={blocked}
            onClick={() => {
              setNewFolder("");
              setFolderOpen(true);
            }}
          >
            <FolderPlus size={19} />
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={blocked}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={17} />
            上传文件
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="刷新资源库"
            disabled={busy || refreshing || locked}
            onClick={() => void load()}
          >
            <RefreshCw size={19} />
          </button>
        </div>
      </header>
      <input
        ref={fileInput}
        type="file"
        className="resource-file-input"
        aria-label="选择个人资源文件"
        disabled={blocked}
        onChange={(e) => {
          const value = e.target.files?.[0] ?? null;
          if (value && (!value.size || value.size > 50 * 1024 * 1024)) {
            clearFile();
            setError("文件须为1字节至50MiB");
            return;
          }
          setFile(value);
          setUploadOpen(Boolean(value));
        }}
      />
      <WorkspaceTabs
        label="资源分类"
        value={system ? "system" : category}
        disabled={busy}
        onChange={(value) =>
          changeView({
            category: value === "media" ? "media" : "components",
            system: value === "system",
            folder: null,
            kind: "",
            search: "",
          })
        }
        items={[
          { value: "system", label: "系统文件" },
          { value: "components", label: "构建" },
          { value: "media", label: "影音内容" },
        ]}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && <p role="status">{result}</p>}
      {pending && (
        <div className="resource-pending" role="status">
          <div>
            <strong>原操作待核对</strong>
            <code>{pending.id}</code>
          </div>
          <div>
            <button
              className="button secondary"
              disabled={busy || locked}
              onClick={() => void check()}
            >
              查询原回执
            </button>
            {pending.kind && (
              <button
                className="button secondary"
                disabled={locked || cancelling}
                onClick={() => void cancelOriginal()}
              >
                {cancelling ? "正在核对…" : "取消原操作"}
              </button>
            )}
          </div>
        </div>
      )}
      <div className="resource-toolbar">
        <nav className="resource-breadcrumbs" aria-label="资源目录">
          <button
            type="button"
            disabled={!folder || busy}
            onClick={() => changeFolder(null)}
          >
            {system ? "系统文件" : category === "media" ? "影音内容" : "构建"}
          </button>
          {resourceAncestors(folders, folder).map((item, index, rows) => (
            <span key={item.id}>
              <ChevronRight size={14} aria-hidden="true" />
              <button
                type="button"
                aria-current={
                  index === rows.length - 1 ? "location" : undefined
                }
                disabled={busy}
                onClick={() => changeFolder(item.id)}
              >
                {item.name}
              </button>
            </span>
          ))}
        </nav>
        <div className="resource-filters">
          <SelectMenu
            label="文件类型"
            value={kind}
            disabled={busy}
            onChange={(value) => changeView({ kind: value })}
            options={[
              { value: "", label: "全部类型" },
              ...Object.entries(types).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
          />
          <SelectMenu
            label="文件排序"
            value={sort + ":" + direction}
            disabled={busy}
            onChange={(value) => {
              const [sort, direction] = value.split(":") as [
                ResourceSelection["sort"],
                ResourceSelection["direction"],
              ];
              changeView({ sort, direction });
            }}
            options={[
              { value: "createdAt:desc", label: "最新上传" },
              { value: "createdAt:asc", label: "最早上传" },
              { value: "name:asc", label: "名称升序" },
              { value: "name:desc", label: "名称降序" },
            ]}
          />
        </div>
      </div>
      <form
        className="resource-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          changeView({ search: searchDraft.trim() });
        }}
      >
        <Search size={18} aria-hidden="true" />
        <input
          aria-label="搜索文件和文件夹名称"
          placeholder={folder ? "搜索此文件夹" : "搜索所有目录中的名称"}
          value={searchDraft}
          maxLength={120}
          disabled={busy}
          onChange={(event) => setSearchDraft(event.target.value)}
        />
        {(searchDraft || search) && (
          <button
            type="button"
            className="icon-button"
            aria-label="清除文件搜索"
            disabled={busy}
            onClick={() => {
              setSearchDraft("");
              changeView({ search: "" });
            }}
          >
            <X size={17} />
          </button>
        )}
        <button type="submit" className="button secondary" disabled={busy}>
          搜索
        </button>
      </form>
      {!page && !error && (
        <p className="resource-loading" role="status">
          正在读取…
        </p>
      )}
      {page && (
        <>
          <ResourceRows
            folders={children}
            items={page.items}
            blocked={blocked}
            onFolder={changeFolder}
            onManage={manage}
            onDelete={(item, isFolder) => void remove(item, isFolder)}
          />
          {!page.items.length && !children.length && (
            <WorkspaceEmpty
              title={
                search
                  ? "没有匹配的文件或文件夹"
                  : kind
                    ? "当前类型没有文件"
                    : "此文件夹为空"
              }
              description={
                search
                  ? "试试其他名称，或清除搜索。"
                  : kind
                    ? "切换类型查看其他文件。"
                    : "上传文件或新建文件夹，整理你的个人资源。"
              }
            />
          )}
          <footer className="resource-footer">
            <p>
              {page.usage.fileCount} 个文件 · 已用 {size(page.usage.usedBytes)}{" "}
              / {size(page.usage.quotaBytes)}
            </p>
            <div className="workspace-pagination">
              <button
                disabled={busy || !cursors.length}
                onClick={() =>
                  changeView(
                    cursors.length === 1 && selection.page > 2
                      ? {}
                      : {
                          cursors: cursors.slice(0, -1),
                          page: selection.page - 1,
                        },
                  )
                }
              >
                {cursors.length === 1 && selection.page > 2
                  ? "回到第一页"
                  : "上一页"}
              </button>
              <span>第 {selection.page} 页</span>
              <button
                disabled={blocked || !page.nextCursor}
                onClick={() => {
                  if (page.nextCursor)
                    changeView({
                      cursors: [...cursors, page.nextCursor],
                      page: selection.page + 1,
                    });
                }}
              >
                下一页
              </button>
            </div>
          </footer>
        </>
      )}
      {uploadOpen && file && (
        <Dialog
          title="上传个人文件"
          className="resource-dialog"
          onClose={() => {
            setUploadOpen(false);
            clearFile();
          }}
        >
          <div className="resource-upload-summary">
            <File size={28} aria-hidden="true" />
            <div>
              <strong>{file.name}</strong>
              <span>
                {size(file.size)} ·{" "}
                {parent
                  ? path(parent)
                  : system
                    ? "系统文件"
                    : category === "media"
                      ? "影音内容"
                      : "构建"}
              </span>
            </div>
          </div>
          <p className="resource-muted">
            保留原始文件与名称，单个文件最大50MiB。
          </p>
          <FormActions>
            <button
              className="button secondary"
              onClick={() => {
                setUploadOpen(false);
                clearFile();
              }}
            >
              取消
            </button>
            <button
              className="button"
              disabled={blocked}
              onClick={() => {
                const data = new FormData();
                data.set("file", file);
                data.set("name", file.name);
                data.set("category", category);
                if (parent) {
                  data.set("folderId", parent.id);
                  data.set("folderRevision", String(parent.revision));
                }
                void mutate("/files", "POST", data);
              }}
            >
              {busy ? "正在上传…" : "上传"}
            </button>
          </FormActions>
        </Dialog>
      )}
      {folderOpen && (
        <Dialog
          title="新建文件夹"
          className="resource-dialog"
          onClose={() => setFolderOpen(false)}
        >
          <form
            className="resource-editor"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate("/folders", "POST", {
                category,
                name: newFolder,
                ...(parent
                  ? { parentId: parent.id, parentRevision: parent.revision }
                  : {}),
              });
            }}
          >
            <label>
              文件夹名称
              <input
                data-dialog-autofocus
                value={newFolder}
                maxLength={120}
                disabled={blocked}
                onChange={(e) => setNewFolder(e.target.value)}
              />
            </label>
            <FormActions>
              <button
                className="button secondary"
                type="button"
                onClick={() => setFolderOpen(false)}
              >
                取消
              </button>
              <button
                className="button"
                disabled={blocked || !newFolder.trim()}
              >
                创建
              </button>
            </FormActions>
          </form>
        </Dialog>
      )}
      {edit && (
        <Dialog
          title={edit.folder ? "文件夹管理" : "文件管理"}
          className="resource-dialog"
          onClose={() => setEdit(null)}
        >
          <form
            className="resource-editor"
            onSubmit={(e) => {
              e.preventDefault();
              const target = folders.find((f) => f.id === edit.target);
              void mutate(
                `/${edit.folder ? "folders" : "files"}/${edit.id}`,
                "PATCH",
                {
                  revision: edit.revision,
                  name: edit.name,
                  [edit.folder ? "parentId" : "folderId"]: edit.target || null,
                  ...(target
                    ? {
                        [edit.folder ? "parentRevision" : "folderRevision"]:
                          target.revision,
                      }
                    : {}),
                },
              );
            }}
          >
            <label>
              名称
              <input
                data-dialog-autofocus
                value={edit.name}
                maxLength={120}
                disabled={blocked}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </label>
            <label>
              所在文件夹
              <SelectMenu
                label="所在文件夹"
                variant="field"
                value={edit.target}
                disabled={blocked}
                onChange={(value) => setEdit({ ...edit, target: value })}
                options={[
                  { value: "", label: "根目录" },
                  ...folders
                    .filter(
                      (f) =>
                        f.category === edit.category &&
                        f.id !== edit.id &&
                        (!edit.folder ||
                          !resourceAncestors(folders, f.id).some(
                            (ancestor) => ancestor.id === edit.id,
                          )),
                    )
                    .map((f) => ({ value: f.id, label: path(f) })),
                ]}
              />
            </label>
            {!edit.folder && (
              <details className="resource-original">
                <summary>原件信息</summary>
                {page?.items
                  .filter((row) => row.id === edit.id)
                  .map((row) => (
                    <dl key={row.id}>
                      <dt>类型</dt>
                      <dd>{types[row.kind] ?? "其他"}</dd>
                      <dt>文件大小</dt>
                      <dd>{size(row.sizeBytes)}</dd>
                      <dt>上传时间</dt>
                      <dd>{feedDateTime(row.createdAt)}</dd>
                      <dt>SHA-256</dt>
                      <dd>
                        <code>{row.sha256}</code>
                      </dd>
                    </dl>
                  ))}
              </details>
            )}
            <FormActions>
              <button
                className="button secondary"
                type="button"
                onClick={() => setEdit(null)}
              >
                取消
              </button>
              <button
                className="button"
                disabled={blocked || !edit.name.trim()}
              >
                保存
              </button>
            </FormActions>
          </form>
        </Dialog>
      )}
      {confirmation.dialog}
    </section>
  );
}

const resourceIcons = {
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  document: FileText,
  archive: FileArchive,
};
export function ResourceRows({
  folders,
  items,
  blocked,
  onFolder,
  onManage,
  onDelete,
}: {
  folders: ResourceFolder[];
  items: Resource[];
  blocked: boolean;
  onFolder: (id: string) => void;
  onManage: (item: Resource | ResourceFolder, isFolder: boolean) => void;
  onDelete: (item: Resource | ResourceFolder, isFolder: boolean) => void;
}) {
  if (!folders.length && !items.length) return null;
  return (
    <div className="resource-list" aria-label="个人资源文件">
      <div className="resource-list-heading">
        <span>名称</span>
        <span>类型 / 大小</span>
        <span className="resource-date">上传时间</span>
        <span className="sr-only">操作</span>
      </div>
      {folders.map((item) => (
        <article className="resource-row" key={item.id}>
          <button
            className="resource-name resource-folder"
            type="button"
            onClick={() => onFolder(item.id)}
          >
            <span className="resource-file-icon">
              <Folder size={21} />
            </span>
            <strong>{item.name}</strong>
          </button>
          <span className="resource-file-meta">文件夹</span>
          <span className="resource-date">—</span>
          <div className="resource-row-actions">
            <button
              className="icon-button"
              aria-label={`管理文件夹 ${item.name}`}
              disabled={blocked}
              onClick={() => onManage(item, true)}
            >
              <Pencil size={16} />
            </button>
            <button
              className="icon-button resource-delete"
              aria-label={`删除文件夹 ${item.name}`}
              disabled={blocked}
              onClick={() => onDelete(item, true)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </article>
      ))}
      {items.map((item) => {
        const Icon =
          resourceIcons[item.kind as keyof typeof resourceIcons] || File;
        return (
          <article className="resource-row" key={item.id}>
            <a
              className="resource-name"
              href={item.downloadPath}
              download={item.name}
            >
              <span className="resource-file-icon">
                <Icon size={21} />
              </span>
              <strong>{item.name}</strong>
            </a>
            <span className="resource-file-meta">
              {types[item.kind] ?? "其他"} · {size(item.sizeBytes)}
            </span>
            <time className="resource-date">
              {feedDateTime(item.createdAt)}
            </time>
            <div className="resource-row-actions">
              <a
                className="icon-button"
                href={item.downloadPath}
                download={item.name}
                aria-label={`下载 ${item.name}`}
              >
                <Download size={16} />
              </a>
              <button
                className="icon-button"
                aria-label={`管理文件 ${item.name}`}
                disabled={blocked}
                onClick={() => onManage(item, false)}
              >
                <Pencil size={16} />
              </button>
              <button
                className="icon-button resource-delete"
                aria-label={`删除文件 ${item.name}`}
                disabled={blocked}
                onClick={() => onDelete(item, false)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
