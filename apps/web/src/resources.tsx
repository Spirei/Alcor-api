import { WorkspaceEmpty } from "./workspace-ui";
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
} from "./resource-state";
import "./resources.css";
import { SelectMenu } from "./select-menu";
import { resourceSize as size } from "./resource-state";

type Folder = {
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
  const [category, setCategory] = useState("components"),
    [folder, setFolder] = useState<string | null>(null),
    [kind, setKind] = useState("");
  const [sort, setSort] = useState("createdAt"),
    [direction, setDirection] = useState("desc"),
    [cursors, setCursors] = useState<string[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]),
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
  } | null>(null);
  const live = useRef(false),
    epoch = useRef(0),
    reads = useRef(0),
    fileInput = useRef<HTMLInputElement>(null),
    operation = useRef<ResourceRequest | null>(null);
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
    if (!live.current) clearFile();
    return () => {
      live.current = false;
      ++epoch.current;
      ++reads.current;
      setBusy(false);
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
  const load = useCallback(async () => {
    if (!live.current) return;
    const generation = epoch.current,
      read = ++reads.current;
    setReady(false);
    setPage(null);
    const current = () =>
      live.current && generation === epoch.current && read === reads.current;
    try {
      const tree = await api<{ items: Folder[] }>(
        base + "/folder-tree?" + new URLSearchParams({ category }),
      );
      if (!current()) return;
      const all = tree.items;
      const q = new URLSearchParams({
        category,
        folderId: folder ?? "root",
        sort,
        direction,
        limit: "30",
      });
      if (kind) q.set("kind", kind);
      if (cursors.length) q.set("cursor", cursors[cursors.length - 1]);
      const files = await api<Page>(base + "/files?" + q);
      if (!current()) return;
      setFolders(all);
      setPage(files);
      setReady(true);
      setError("");
    } catch (reason) {
      if (
        generation === epoch.current &&
        ((reason instanceof ApiError && [401, 403].includes(reason.status)) ||
          read === reads.current)
      )
        fail(reason);
    }
  }, [category, folder, kind, sort, direction, cursors, fail]);
  useEffect(() => {
    if (active && visible && !locked) void load();
  }, [active, visible, locked, load]);
  function changeFolder(id: string | null) {
    ++epoch.current;
    ++reads.current;
    setFolder(id);
    setCursors([]);
    setEdit(null);
    clearFile();
    setPage(null);
  }
  function path(item: Folder): string {
    const names = [item.name];
    let parent = item.parentId;
    const seen = new Set([item.id]);
    while (parent) {
      const p = folders.find((f) => f.id === parent);
      if (!p || seen.has(p.id)) return names.join(" / ");
      seen.add(p.id);
      names.unshift(p.name);
      parent = p.parentId;
    }
    return names.join(" / ");
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
    children = folders.filter((f) => f.parentId === folder),
    blocked = busy || !!pending || !ready || locked;
  return (
    <section className="resource-page">
      <header className="page-heading">
        <h1>资源库</h1>
        <button
          className="button"
          disabled={busy || locked}
          onClick={() => void load()}
        >
          重新读取
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {result && <p role="status">{result}</p>}
      {pending && (
        <div role="status">
          <p>等待原操作结果 · {pending.id}</p>
          <button
            className="button"
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
      )}
      <div className="resource-filters">
        <label>
          分类
          <SelectMenu
            label="分类"
            variant="field"
            value={category}
            disabled={busy}
            onChange={(value) => {
              ++epoch.current;
              setCategory(value);
              changeFolder(null);
            }}
            options={[
              { value: "components", label: "构建" },
              { value: "media", label: "影音内容" },
            ]}
          />
        </label>
        <label>
          类型
          <SelectMenu
            label="类型"
            variant="field"
            value={kind}
            onChange={(value) => {
              ++epoch.current;
              setKind(value);
              setCursors([]);
            }}
            options={[
              { value: "", label: "全部" },
              ...Object.entries(types).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
          />
        </label>
        <label>
          排序
          <SelectMenu
            label="排序"
            variant="field"
            value={sort}
            onChange={(value) => {
              ++epoch.current;
              setSort(value);
              setCursors([]);
            }}
            options={[
              { value: "createdAt", label: "上传时间" },
              { value: "name", label: "名称" },
            ]}
          />
        </label>
        <label>
          顺序
          <SelectMenu
            label="顺序"
            variant="field"
            value={direction}
            onChange={(value) => {
              ++epoch.current;
              setDirection(value);
              setCursors([]);
            }}
            options={[
              { value: "desc", label: "降序" },
              { value: "asc", label: "升序" },
            ]}
          />
        </label>
      </div>
      <nav aria-label="资源目录">
        <button className="button secondary" onClick={() => changeFolder(null)}>
          根目录
        </button>
        {parent && (
          <>
            <button
              className="button secondary"
              onClick={() => changeFolder(parent.parentId)}
            >
              上一级
            </button>
            <span>{path(parent)}</span>
          </>
        )}
      </nav>
      {page && (
        <p>
          总用量 {size(page.usage.usedBytes)} / {size(page.usage.quotaBytes)} ·{" "}
          {page.usage.fileCount} 个文件
        </p>
      )}
      {!ready && !error && <p role="status">正在读取…</p>}
      <details className="workspace-tools">
        <summary>上传文件与新建文件夹</summary>
        <div className="resource-upload">
          <label>
            上传文件
            <input
              ref={fileInput}
              type="file"
              disabled={blocked}
              onChange={(e) => {
                const value = e.target.files?.[0] ?? null;
                if (value && (!value.size || value.size > 50 * 1024 * 1024)) {
                  clearFile();
                  setError("文件须为1字节至50MiB");
                  return;
                }
                setFile(value);
              }}
            />
          </label>
          <button
            className="button"
            disabled={blocked || !file}
            onClick={() => {
              if (!file) return;
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
            上传
          </button>
        </div>
        <form
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
          className="resource-upload"
        >
          <label>
            新建目录
            <input
              value={newFolder}
              disabled={blocked}
              onChange={(e) => setNewFolder(e.target.value)}
            />
          </label>
          <button className="button" disabled={blocked || !newFolder}>
            创建
          </button>
        </form>
      </details>
      {ready &&
        children.map((item) => (
          <article className="resource-row" key={item.id}>
            <button
              className="button secondary"
              onClick={() => changeFolder(item.id)}
            >
              {item.name}
            </button>
            <span>目录</span>
            <button
              className="button secondary"
              disabled={blocked}
              onClick={() =>
                setEdit({
                  id: item.id,
                  revision: item.revision,
                  name: item.name,
                  target: item.parentId ?? "",
                  folder: true,
                })
              }
            >
              管理
            </button>
          </article>
        ))}
      {ready &&
        page?.items.map((item) => (
          <article className="resource-row" key={item.id}>
            <a href={item.downloadPath} download={item.name}>
              {item.name}
            </a>
            <span>
              {types[item.kind] ?? "其他"} · {size(item.sizeBytes)}
            </span>
            <button
              className="button secondary"
              disabled={blocked}
              onClick={() =>
                setEdit({
                  id: item.id,
                  revision: item.revision,
                  name: item.name,
                  target: item.folderId ?? "",
                  folder: false,
                })
              }
            >
              管理
            </button>
          </article>
        ))}
      {ready && page?.items.length === 0 && children.length === 0 && (
        <WorkspaceEmpty
          title="此目录为空"
          description="上传文件或新建文件夹，整理你的资源。"
        />
      )}
      {edit && (
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
          <h2>{edit.folder ? "目录" : "文件"}</h2>
          <label>
            名称
            <input
              value={edit.name}
              disabled={blocked}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            />
          </label>
          <label>
            目标目录
            <SelectMenu
              label="目标目录"
              variant="field"
              value={edit.target}
              disabled={blocked}
              onChange={(value) => setEdit({ ...edit, target: value })}
              options={[
                { value: "", label: "根目录" },
                ...folders
                  .filter((f) => f.id !== edit.id)
                  .map((f) => ({ value: f.id, label: path(f) })),
              ]}
            />
          </label>
          <div>
            <button className="button" disabled={blocked || !edit.name}>
              保存
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => setEdit(null)}
            >
              取消
            </button>
          </div>
          <details>
            <summary>删除</summary>
            <p>
              {edit.folder
                ? "仅可删除空目录。"
                : "删除后将不可下载，历史操作记录继续保留。"}
            </p>
            <button
              className="button danger"
              type="button"
              disabled={blocked}
              onClick={() =>
                void mutate(
                  `/${edit.folder ? "folders" : "files"}/${edit.id}`,
                  "DELETE",
                  { revision: edit.revision },
                )
              }
            >
              确认删除{edit.folder ? "目录" : "文件"}
            </button>
          </details>
        </form>
      )}
      <div className="resource-pages">
        <button
          className="button secondary"
          disabled={busy || !cursors.length}
          onClick={() => {
            ++epoch.current;
            setCursors((v) => v.slice(0, -1));
          }}
        >
          上一页
        </button>
        <span>第 {cursors.length + 1} 页</span>
        <button
          className="button secondary"
          disabled={busy || !ready || !page?.nextCursor}
          onClick={() => {
            if (page?.nextCursor) {
              ++epoch.current;
              setCursors((v) => [...v, page.nextCursor!]);
            }
          }}
        >
          下一页
        </button>
      </div>
    </section>
  );
}
