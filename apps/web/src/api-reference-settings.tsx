import { useEffect, useState } from "react";
import { api, type Session } from "./api";
import {
  referenceReceipt,
  retainReferenceOperation,
  type Reference,
  type ReferenceReceipt,
} from "./api-reference-state";

export function ApiReferenceSettings({
  session,
  expanded = false,
}: {
  session: Session;
  expanded?: boolean;
}) {
  const [version, setVersion] = useState<1 | 2>(1);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  return (
    <details open={expanded}>
      <summary>接口文档</summary>
      <select
        aria-label="文档版本"
        value={version}
        onChange={(event) => setVersion(Number(event.target.value) as 1 | 2)}
      >
        <option value={1}>Web 与兼容接口</option>
        <option value={2}>App 接口</option>
      </select>
      <ReferenceEditor
        key={version}
        version={version}
        session={session}
        draft={drafts[version]}
        change={(value) => setDrafts((old) => ({ ...old, [version]: value }))}
      />
    </details>
  );
}

function ReferenceEditor({
  version,
  session,
  draft,
  change,
}: {
  version: 1 | 2;
  session: Session;
  draft?: string;
  change: (value: string) => void;
}) {
  const key = `alcor.api-reference.${session.instance_id}.${session.user.id}.${version}`;
  const [current, setCurrent] = useState<Reference | null>(null);
  const [pending, setPending] = useState(() => {
    try {
      return sessionStorage.getItem(key) || "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function read() {
    const value = await api<Reference>(`/system/api-docs?version=${version}`);
    setCurrent(value);
    change(value.content || "");
  }
  useEffect(() => {
    let valid = true;
    const controller = new AbortController();
    api<Reference>(`/system/api-docs?version=${version}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (valid) {
          setCurrent(value);
          if (draft === undefined) change(value.content || "");
        }
      })
      .catch((error) => {
        if (valid) setMessage(error.message);
      });
    return () => {
      valid = false;
      controller.abort();
    };
  }, []);
  async function accept(value: unknown, id: string) {
    const receipt = referenceReceipt(value, id);
    sessionStorage.removeItem(key);
    setPending("");
    setMessage(
      receipt.state === "completed"
        ? "文档已保存"
        : receipt.message || "原操作已关闭",
    );
    if (receipt.state === "completed") await read();
  }
  async function save() {
    if (!current || pending || busy) return;
    const id = crypto.randomUUID();
    try {
      retainReferenceOperation(sessionStorage, key, id);
    } catch (error) {
      setMessage((error as Error).message);
      return;
    }
    setPending(id);
    setBusy(true);
    setMessage("");
    try {
      const result = await api<{ data: ReferenceReceipt }>(
        `/api-docs?version=${version}`,
        {
          method: "POST",
          body: JSON.stringify({
            requestId: id,
            expectedRevision: current.revision,
            content: draft || "",
          }),
        },
        session.csrf,
      );
      await accept(result.data, id);
    } catch (error) {
      setMessage(`${(error as Error).message}；请查询原操作`);
    } finally {
      setBusy(false);
    }
  }
  async function recover(close = false) {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const value = await api<ReferenceReceipt>(
        `/system/api-docs/operations/${pending}${close ? "/close" : ""}`,
        close ? { method: "POST", body: "{}" } : {},
        session.csrf,
      );
      await accept(value, pending);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="connection-fields">
      {current?.revision === null && <p role="status">文档尚未配置</p>}
      <textarea
        aria-label="Markdown 文档"
        rows={14}
        value={draft || ""}
        onChange={(event) => change(event.target.value)}
        disabled={busy || Boolean(pending)}
      />
      <div className="module-actions">
        <button
          className="button primary"
          disabled={
            !current ||
            busy ||
            Boolean(pending) ||
            new TextEncoder().encode(draft || "").length > 524288
          }
          onClick={() => void save()}
        >
          保存文档
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() =>
            void read().catch((error) => setMessage(error.message))
          }
        >
          重新读取
        </button>
        {pending && (
          <>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void recover()}
            >
              查询原操作
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void recover(true)}
            >
              关闭原操作
            </button>
            <code>{pending}</code>
          </>
        )}
      </div>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
