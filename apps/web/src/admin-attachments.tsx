import { AttachmentImportPanel } from "./attachment-import";
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
import { attachmentOriginal } from "./admin-attachment-original";
import {
  attachmentCommand,
  attachmentReceipt,
  clearAttachmentRequests,
  readAttachmentRequest,
  retainAttachmentRequest,
  releaseAttachmentRequest,
  validAttachmentId,
  type AttachmentReceipt,
} from "./admin-attachments-state";
import "./admin-attachments.css";

type Entry = {
  name: string;
  rel: string;
  isDir: boolean;
  size: number;
  mtime: string;
  ext: string;
};
type Listing = {
  namespace: "admin_shared";
  revision: number;
  path: string;
  dirs: Entry[];
  files: Entry[];
  legacySourceImported: boolean;
};
type Directories = {
  namespace: "admin_shared";
  revision: number;
  directories: string[];
};
type Action = "rename" | "move" | "copy" | "delete";
type Conflict = "error" | "replace" | "keep-both";
const base = "/admin/attachments";
const conflicts = [
  { value: "error", label: "同名时停止" },
  { value: "keep-both", label: "保留两份" },
  { value: "replace", label: "替换同名目标" },
] as const;

export function AdminAttachmentsPage({
  session,
  active = true,
}: {
  session: Session;
  active?: boolean;
}) {
  if (session.user.role !== "admin")
    return (
      <section>
        <h1>共享附件</h1>
        <p role="alert">需要管理员权限</p>
      </section>
    );
  const scope = JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  return (
    <AttachmentSession
      key={JSON.stringify([scope, session.csrf, session.expires_at])}
      session={session}
      active={active}
      scope={scope}
    />
  );
}
function AttachmentSession({
  session,
  active,
  scope,
}: {
  session: Session;
  active: boolean;
  scope: string;
}) {
  const [visible, setVisible] = useState(
    typeof document === "undefined" || !document.hidden,
  );
  const [sourceBlocked, setSourceBlocked] = useState(true);
  const sourceBlocking = useRef(true);
  const [locked, setLocked] = useState(false),
    [ready, setReady] = useState(false),
    [journalReady, setJournalReady] = useState(false);
  const [directory, setDirectory] = useState(""),
    [filter, setFilter] = useState(""),
    [folderName, setFolderName] = useState("");
  const [listing, setListing] = useState<Listing | null>(null),
    [directories, setDirectories] = useState<string[]>([""]);
  const [file, setFile] = useState<File | null>(null),
    [conflict, setConflict] = useState<Conflict>("error");
  const [edit, setEdit] = useState<{
    row: Entry;
    action: Action;
    name: string;
    target: string;
    conflict: Conflict;
    force: boolean;
  } | null>(null);
  const [pending, setPending] = useState<string | null>(null),
    [lookup, setLookup] = useState(""),
    [observed, setObserved] = useState<AttachmentReceipt | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const live = useRef(false),
    epoch = useRef(0),
    reads = useRef(0),
    original = useRef<string | null>(null);
  const input = useRef<HTMLInputElement>(null),
    work = useRef<AbortController | null>(null),
    reading = useRef<AbortController | null>(null),
    objectUrl = useRef<string | null>(null);
  const displayed = useCallback(
    () => apiSessionSnapshot().csrf === session.csrf,
    [session.csrf],
  );
  const clearFile = useCallback(() => {
    setFile(null);
    if (input.current) input.current.value = "";
  }, []);
  const changeSourceBlocked = useCallback(
    (value: boolean) => {
      sourceBlocking.current = value;
      setSourceBlocked(value);
      if (value) clearFile();
    },
    [clearFile],
  );
  const pause = useCallback(() => {
    live.current = false;
    ++epoch.current;
    ++reads.current;
    work.current?.abort();
    work.current = null;
    reading.current?.abort();
    reading.current = null;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
    setBusy(false);
    setReady(false);
    clearFile();
  }, [clearFile]);
  const fail = useCallback(
    (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "读取失败");
      if (
        !displayed() ||
        (reason instanceof ApiError &&
          ([401, 403].includes(reason.status) ||
            reason.code === "session_changed"))
      ) {
        pause();
        setLocked(true);
        setListing(null);
        setDirectories([""]);
        setEdit(null);
        setFolderName("");
        setFilter("");
        setLookup("");
        setObserved(null);
        original.current = null;
        setPending(null);
        try {
          clearAttachmentRequests(sessionStorage);
        } catch {
          /* Identity boundary clears in-memory contents regardless of storage availability. */
        }
      }
    },
    [displayed, pause],
  );
  useLayoutEffect(() => {
    live.current = active && visible && !locked && displayed();
    ++epoch.current;
    setReady(false);
    if (!live.current) clearFile();
    return pause;
  }, [active, visible, locked, displayed, clearFile, pause]);
  useEffect(() => {
    const change = () => {
      if (document.hidden) pause();
      setVisible(!document.hidden);
    };
    change();
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, [pause]);
  useEffect(() => {
    if (!live.current || !displayed()) return;
    try {
      const id = readAttachmentRequest(sessionStorage, scope);
      original.current = id;
      setPending(id);
      setJournalReady(true);
    } catch (reason) {
      setLocked(true);
      fail(reason);
    }
  }, [scope, active, visible, displayed, fail]);
  const load = useCallback(async () => {
    if (!live.current || !displayed()) return;
    const generation = epoch.current,
      read = ++reads.current,
      controller = new AbortController();
    reading.current?.abort();
    reading.current = controller;
    setReady(false);
    const current = () =>
      live.current &&
      displayed() &&
      generation === epoch.current &&
      read === reads.current;
    try {
      const [page, tree] = await Promise.all([
        api<Listing>(base + "?" + new URLSearchParams({ path: directory }), {
          signal: controller.signal,
        }),
        api<Directories>(base + "?action=directories", {
          signal: controller.signal,
        }),
      ]);
      if (!current()) return;
      if (
        page.namespace !== "admin_shared" ||
        tree.namespace !== "admin_shared" ||
        page.revision !== tree.revision ||
        !Number.isSafeInteger(page.revision) ||
        page.revision < 1
      )
        throw new Error("目录已变化，请重新读取");
      setListing(page);
      setDirectories(tree.directories);
      setReady(true);
      setError("");
    } catch (reason) {
      if (
        live.current &&
        generation === epoch.current &&
        read === reads.current &&
        !controller.signal.aborted
      ) {
        setListing(null);
        fail(reason);
      }
    } finally {
      if (reading.current === controller) reading.current = null;
    }
  }, [directory, displayed, fail]);
  useEffect(() => {
    if (active && visible && !locked) void load();
  }, [active, visible, locked, load]);
  function known(value: unknown, id: string) {
    const receipt = attachmentReceipt(value, id);
    if (original.current === id) {
      releaseAttachmentRequest(sessionStorage, scope, id);
      original.current = null;
      setPending(null);
    }
    setObserved(receipt);
    setLookup(id);
    setError("");
    clearFile();
    if (receipt.state === "completed") {
      setEdit(null);
      setFolderName("");
    }
    void load();
  }
  async function check(id = original.current ?? lookup.trim()) {
    if (
      !live.current ||
      !displayed() ||
      work.current ||
      !validAttachmentId(id)
    ) {
      if (!validAttachmentId(id)) setError("请输入有效操作编号");
      return;
    }
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    setError("");
    try {
      const value = await api<unknown>(base + "/operations/" + id, {
        signal: controller.signal,
      });
      if (live.current && displayed() && generation === epoch.current)
        known(value, id);
    } catch (reason) {
      if (live.current && generation === epoch.current) fail(reason);
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (generation === epoch.current) setBusy(false);
      }
    }
  }
  async function mutate(
    action: string,
    fields: Record<string, unknown> = {},
    selected?: File,
  ) {
    if (
      !live.current ||
      !displayed() ||
      !ready ||
      !journalReady ||
      work.current ||
      original.current ||
      sourceBlocking.current ||
      !listing
    )
      return;
    if (selected && selected.size > 50 * 1024 * 1024) {
      setError("单个文件最大 50MiB");
      return;
    }
    const id = requestId(),
      generation = epoch.current,
      controller = new AbortController();
    const command = attachmentCommand(action, fields, listing.revision, id);
    try {
      retainAttachmentRequest(sessionStorage, scope, id);
    } catch (reason) {
      fail(reason);
      return;
    }
    original.current = id;
    setPending(id);
    setObserved(null);
    work.current = controller;
    setBusy(true);
    setError("");
    let body: string | FormData;
    if (selected) {
      const form = new FormData();
      form.set("file", selected);
      form.set("action", "upload");
      form.set("dir", directory);
      form.set("conflict", conflict);
      form.set("expectedRevision", String(listing.revision));
      form.set("requestId", id);
      body = form;
    } else body = command.body;
    clearFile();
    try {
      const value = await api<unknown>(
        command.path,
        { method: command.method, body, signal: controller.signal },
        session.csrf,
        selected ? 300000 : 10000,
      );
      if (live.current && displayed() && generation === epoch.current)
        known(value, id);
    } catch (reason) {
      if (live.current && generation === epoch.current) {
        fail(reason);
        if (
          reason instanceof ApiError &&
          ![401, 403].includes(reason.status) &&
          reason.status >= 400 &&
          reason.status < 500
        ) {
          try {
            const receipt = await api<unknown>(base + "/operations/" + id, {
              signal: controller.signal,
            });
            if (live.current && displayed() && generation === epoch.current)
              known(receipt, id);
          } catch (lookupError) {
            if (live.current && generation === epoch.current) fail(lookupError);
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
  async function download(row: Entry) {
    if (!live.current || !displayed() || work.current || !ready) return;
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    setError("");
    const current = () =>
      live.current && displayed() && generation === epoch.current;
    try {
      const blob = await attachmentOriginal(
        row,
        { csrf: session.csrf, current },
        controller.signal,
      );
      if (!current()) return;
      const url = URL.createObjectURL(blob);
      objectUrl.current = url;
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = row.name;
      anchor.click();
      URL.revokeObjectURL(url);
      objectUrl.current = null;
    } catch (reason) {
      if (live.current && generation === epoch.current) fail(reason);
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (generation === epoch.current) setBusy(false);
      }
    }
  }
  function navigate(path: string) {
    ++reads.current;
    reading.current?.abort();
    setDirectory(path);
    setListing(null);
    setReady(false);
    setEdit(null);
    clearFile();
  }
  const blocked =
    busy || !!pending || !ready || !journalReady || locked || sourceBlocked;
  const rows = [...(listing?.dirs ?? []), ...(listing?.files ?? [])].filter(
    (row) => row.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
  );
  return (
    <section className="admin-attachments-page">
      <header className="page-heading">
        <h1>共享附件</h1>
        <button
          className="button"
          disabled={busy || locked}
          onClick={() => void load()}
        >
          重新读取
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {pending && (
        <div className="attachment-receipt" role="status">
          <p>等待原操作结果</p>
          <p className="attachment-id">{pending}</p>
          <button
            className="button"
            disabled={busy || locked}
            onClick={() => void check()}
          >
            查询原回执
          </button>
        </div>
      )}
      {observed && (
        <div className="attachment-receipt" role="status">
          <p>{observed.state === "completed" ? "已完成" : observed.message}</p>
          {observed.result?.path && <p>{observed.result.path}</p>}
          <p className="attachment-id">{observed.requestId}</p>
        </div>
      )}
      <div className="attachment-location">
        <label>
          目录
          <SelectMenu
            label="目录"
            value={directory}
            variant="field"
            options={(directories.includes(directory)
              ? directories
              : [directory, ...directories]
            ).map((value) => ({ value, label: value || "全部附件" }))}
            disabled={busy || locked}
            onChange={navigate}
          />
        </label>
        <label>
          查找名称
          <input
            value={filter}
            disabled={locked}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
      </div>
      <details className="workspace-tools"><summary>上传附件与新建目录</summary><form
        className="attachment-create"
        onSubmit={(event) => {
          event.preventDefault();
          if (folderName.trim())
            void mutate("mkdir", { name: folderName, dir: directory });
        }}
      >
        <label>
          新建文件夹
          <input
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            disabled={blocked}
            required
          />
        </label>
        <button
          className="button secondary"
          disabled={blocked || !folderName.trim()}
        >
          创建
        </button>
      </form>
      <form
        className="attachment-upload"
        onSubmit={(event) => {
          event.preventDefault();
          if (file) void mutate("upload", {}, file);
        }}
      >
        <label>
          文件
          <input
            ref={input}
            type="file"
            disabled={blocked}
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              if (selected && selected.size > 50 * 1024 * 1024) {
                clearFile();
                setError("单个文件最大 50MiB");
              } else {
                setFile(selected);
                setError("");
              }
            }}
          />
        </label>
        <label>
          同名处理
          <SelectMenu
            label="上传同名处理"
            value={conflict}
            options={conflicts}
            variant="field"
            disabled={blocked}
            onChange={(value) => setConflict(value as Conflict)}
          />
        </label>
        <button className="button" disabled={blocked || !file}>
          {conflict === "replace" ? "上传并替换" : "上传"}
        </button>
      </form></details>
      <div
        className="attachment-list"
        aria-label="共享附件列表"
        aria-busy={!ready && !locked}
      >
        {rows.map((row) => (
          <div className="attachment-row" key={row.rel}>
            <div>
              {row.isDir ? (
                <button
                  className="attachment-folder"
                  disabled={busy || locked}
                  onClick={() => navigate(row.rel)}
                >
                  {row.name}
                </button>
              ) : (
                <span>{row.name}</span>
              )}
              <small>
                {row.isDir ? "文件夹" : resourceSize(row.size)} ·{" "}
                {new Date(row.mtime).toLocaleString()}
              </small>
            </div>
            {!row.isDir && (
              <button
                className="button secondary"
                disabled={busy || locked || !ready}
                onClick={() => void download(row)}
                aria-label={"下载 " + row.name}
              >
                下载
              </button>
            )}
            <button
              className="button secondary"
              disabled={blocked}
              aria-label={"管理 " + row.name}
              onClick={() =>
                setEdit({
                  row,
                  action: "rename",
                  name: row.name,
                  target: directory,
                  conflict: "error",
                  force: false,
                })
              }
            >
              管理
            </button>
          </div>
        ))}
        {ready && rows.length === 0 && <p>暂无附件</p>}
      </div>
      {edit && (
        <form
          className="attachment-editor"
          onSubmit={(event) => {
            event.preventDefault();
            if (edit.action === "delete")
              void mutate("delete", { path: edit.row.rel, force: edit.force });
            else if (edit.action !== "rename" || edit.name.trim())
              void mutate(edit.action, {
                source: edit.row.rel,
                name: edit.name,
                targetDir: edit.target,
                conflict: edit.conflict,
              });
          }}
        >
          <h2>{edit.row.name}</h2>
          <label>
            操作
            <SelectMenu
              label="附件操作"
              value={edit.action}
              variant="field"
              disabled={blocked}
              onChange={(value) =>
                setEdit({ ...edit, action: value as Action })
              }
              options={[
                { value: "rename", label: "重命名" },
                { value: "move", label: "移动" },
                { value: "copy", label: "复制" },
                { value: "delete", label: "删除" },
              ]}
            />
          </label>
          {edit.action === "rename" && (
            <label>
              新名称
              <input
                value={edit.name}
                required
                disabled={blocked}
                onChange={(event) =>
                  setEdit({ ...edit, name: event.target.value })
                }
              />
            </label>
          )}
          {(edit.action === "move" || edit.action === "copy") && (
            <label>
              目标目录
              <SelectMenu
                label="目标目录"
                value={edit.target}
                variant="field"
                disabled={blocked}
                onChange={(value) => setEdit({ ...edit, target: value })}
                options={directories
                  .filter(
                    (value) =>
                      !edit.row.isDir ||
                      (value !== edit.row.rel &&
                        !value.startsWith(edit.row.rel + "/")),
                  )
                  .map((value) => ({ value, label: value || "全部附件" }))}
              />
            </label>
          )}
          {edit.action !== "delete" && (
            <label>
              同名处理
              <SelectMenu
                label="管理同名处理"
                value={edit.conflict}
                options={conflicts}
                variant="field"
                disabled={blocked}
                onChange={(value) =>
                  setEdit({ ...edit, conflict: value as Conflict })
                }
              />
            </label>
          )}
          {edit.action === "delete" && (
            <>
              <p>确认删除“{edit.row.rel}”？</p>
              {edit.row.isDir && (
                <label className="attachment-check">
                  <input
                    type="checkbox"
                    checked={edit.force}
                    disabled={blocked}
                    onChange={(event) =>
                      setEdit({ ...edit, force: event.target.checked })
                    }
                  />
                  包含子目录和文件
                </label>
              )}
            </>
          )}
          <div className="attachment-actions">
            <button
              className="button"
              disabled={
                blocked || (edit.action === "rename" && !edit.name.trim())
              }
            >
              {edit.action === "delete"
                ? "确认删除"
                : edit.conflict === "replace"
                  ? "确认替换"
                  : "保存"}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => setEdit(null)}
            >
              关闭
            </button>
          </div>
        </form>
      )}
      <details className="workspace-tools"><summary>查询操作回执</summary><form
        className="attachment-lookup"
        onSubmit={(event) => {
          event.preventDefault();
          void check(lookup.trim());
        }}
      >
        <label>
          操作编号
          <input
            value={lookup}
            disabled={locked}
            onChange={(event) => setLookup(event.target.value)}
          />
        </label>
        <button
          className="button secondary"
          disabled={busy || locked || !validAttachmentId(lookup.trim())}
        >
          查询回执
        </button>
      </form></details>
      <details className="workspace-tools"><summary>导入旧附件登记</summary><AttachmentImportPanel
        session={session}
        active={active && visible && !locked}
        blocked={busy || !!pending || locked || !journalReady}
        onBlocked={changeSourceBlocked}
        onChanged={load}
        onDenied={fail}
      /></details>
    </section>
  );
}
