import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { Session } from "./api";
import { requestId } from "./request-id";
import { apiSessionSnapshot } from "./api-session";

type Template = {
  id: string;
  name: string;
  kind: string;
  subject: string;
  title: string;
  greeting: string;
  body: string;
  valueLabel: string;
  closing: string;
  signature: string;
};
type Head = { revision: number; templates: Template[] };
type Receipt = {
  requestId: string;
  state: string;
  message?: string;
  revision: number;
};
type Preview = { subject: string; html: string; text: string };
const fields = [
  ["subject", "主题"],
  ["title", "标题"],
  ["greeting", "称呼"],
  ["body", "正文"],
  ["valueLabel", "凭证标签"],
  ["closing", "结束语"],
  ["signature", "落款"],
] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function MailTemplateSettings({ session }: { session: Session }) {
  const scope = JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  return <TemplateSession key={JSON.stringify([scope, session.csrf, session.expires_at])} session={session} scope={scope} />;
}
function TemplateSession({
  session,
  scope,
}: {
  session: Session;
  scope: string;
}) {
  const [opened, setOpened] = useState(false),
    [head, setHead] = useState<Head | null>(null),
    [draft, setDraft] = useState<Template | null>(null);
  const [unresolved, setUnresolved] = useState(false);
  const [preview, setPreview] = useState<(Preview & { draft: string }) | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const previewSequence = useRef(0);
  const previewController = useRef<AbortController | null>(null);
  const displayed = () => apiSessionSnapshot().csrf === session.csrf;
  const [visible, setVisible] = useState(!document.hidden);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [locked, setLocked] = useState(false),
    [identifier, setIdentifier] = useState(""),
    [receipt, setReceipt] = useState<Receipt | null>(null);
  const live = useRef(false),
    epoch = useRef(0),
    sequence = useRef(0);
  const storageKey = "alcor.mail-template.pending:" + scope;
  useLayoutEffect(() => {
    live.current = visible && !locked && displayed();
    setBusy(false);
    setPreview(null);
    setPreviewBusy(false);
    ++previewSequence.current;
    ++epoch.current;
    return () => {
      live.current = false;
      ++epoch.current;
      previewController.current?.abort();
      previewController.current = null;
      setReceipt(null);
      setPreview(null);
      ++previewSequence.current;
    };
  }, [visible, locked]);
  useEffect(() => {
    const change = () => {
      if (document.hidden) {
        live.current = false;
        ++epoch.current;
        ++sequence.current;
        ++previewSequence.current;
        previewController.current?.abort();
        previewController.current = null;
        setPreview(null);
        setPreviewBusy(false);
      }
      setVisible(!document.hidden);
    };
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        if (!uuid.test(saved)) throw new Error("原操作编号无法读取");
        setIdentifier(saved);
        setUnresolved(true);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "原操作编号无法读取");
    }
  }, [storageKey]);
  function failure(reason: unknown) {
    setError(reason instanceof Error ? reason.message : "操作失败");
    if (!displayed() || (reason instanceof ApiError && ([401, 403].includes(reason.status) || reason.code === "session_changed"))) {
      ++epoch.current;
      live.current = false;
      setLocked(true);
      setHead(null);
      setDraft(null);
      setReceipt(null);
      setIdentifier("");
      setPreview(null);
      ++previewSequence.current;
      previewController.current?.abort();
      previewController.current = null;
      setUnresolved(false);
      try { sessionStorage.removeItem(storageKey); } catch { /* Retired UI never exposes a retained identifier. */ }
    }
  }
  async function load(preserveDraft = false) {
    if (!live.current || locked || !displayed()) return;
    const current = epoch.current,
      read = ++sequence.current;
    try {
      const value = await api<Head>("/system/mail-templates");
      if (
        !live.current ||
        !displayed() ||
        current !== epoch.current ||
        read !== sequence.current
      )
        return;
      setHead((current) => (preserveDraft && current ? current : value));
      setDraft((current) =>
        preserveDraft && current
          ? current
          : value.templates.find((t) => t.id === current?.id) ||
            value.templates[0] ||
            null,
      );
      setError("");
    } catch (reason) {
      if (current === epoch.current) failure(reason);
    }
  }
  useEffect(() => {
    if (opened && !locked) void load(true);
  }, [opened, locked, visible]);
  async function query() {
    if (!uuid.test(identifier) || !live.current || busy || locked || !displayed()) return;
    const current = epoch.current;
    setBusy(true);
    setReceipt(null);
    try {
      const value = await api<Receipt>(
        `/system/mail-templates/operations/${identifier}`,
      );
      if (!live.current || !displayed() || current !== epoch.current) return;
      setReceipt(value);
      if (["completed", "failed"].includes(value.state)) {
        sessionStorage.removeItem(storageKey);
        setUnresolved(false);
        await load();
      }
      setError("");
    } catch (reason) {
      if (current === epoch.current) failure(reason);
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  }
  async function closeUnknown() {
    if (
      !unresolved ||
      !uuid.test(identifier) ||
      !live.current ||
      busy ||
      locked
      || !displayed()
    )
      return;
    const current = epoch.current;
    setBusy(true);
    setReceipt(null);
    try {
      const value = await api<Receipt>(
        `/system/mail-templates/operations/${identifier}/close`,
        { method: "POST", body: "{}" },
        session.csrf,
      );
      if (!live.current || !displayed() || current !== epoch.current) return;
      setReceipt(value);
      if (["completed", "failed"].includes(value.state)) {
        sessionStorage.removeItem(storageKey);
        setUnresolved(false);
        await load();
      }
      setError("");
    } catch (reason) {
      if (current === epoch.current) failure(reason);
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  }
  async function save() {
    if (!head || !draft || !live.current || busy || locked || unresolved || !displayed())
      return;
    const current = epoch.current,
      id = requestId();
    try {
      sessionStorage.setItem(storageKey, id);
    } catch {
      setError("无法保存原操作编号，请核对浏览器存储");
      return;
    }
    setIdentifier(id);
    setUnresolved(true);
    setReceipt(null);
    setBusy(true);
    try {
      const value = await api<Receipt>(
        "/system/mail-templates/operations",
        {
          method: "POST",
          body: JSON.stringify({
            requestId: id,
            expectedRevision: head.revision,
            template: draft,
          }),
        },
        session.csrf,
      );
      if (!live.current || !displayed() || current !== epoch.current) return;
      setReceipt(value);
      if (["completed", "failed"].includes(value.state)) {
        sessionStorage.removeItem(storageKey);
        setUnresolved(false);
        await load();
      }
      setError("");
    } catch (reason) {
      if (current === epoch.current) failure(reason);
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  }
  async function previewDraft() {
    if (!draft || !live.current || locked || busy || previewBusy || !displayed()) return;
    const current = epoch.current,
      sequence = ++previewSequence.current,
      input = JSON.stringify(draft);
    const controller = new AbortController();
    previewController.current?.abort();
    previewController.current = controller;
    setPreviewBusy(true);
    setPreview(null);
    try {
      const value = await api<Preview>(
        "/system/mail-templates/preview",
        { method: "POST", body: input, signal: controller.signal },
        session.csrf,
      );
      if (!live.current || !displayed() || current !== epoch.current || sequence !== previewSequence.current) return;
      setPreview({ ...value, draft: input });
      setError("");
    } catch (reason) {
      if (current === epoch.current && sequence === previewSequence.current) failure(reason);
    } finally {
      if (current === epoch.current && sequence === previewSequence.current) setPreviewBusy(false);
      if (previewController.current === controller) previewController.current = null;
    }
  }
  return (
    <details
      className="card padded settings-section"
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary>邮件模板</summary>
      {error && <p role="alert">{error}</p>}
      <button
        className="button"
        disabled={busy || locked}
        onClick={() => void load()}
      >
        重新读取模板
      </button>
      {head && draft && (
        <>
          <label>
            模板
            <select
              value={draft.id}
              disabled={busy || locked}
              onChange={(event) => {
                setDraft(
                  head.templates.find((t) => t.id === event.target.value) ||
                    null,
                );
                setReceipt(null);
              }}
            >
              {head.templates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {fields.map(([key, label]) => (
            <label key={key}>
              {label}
              {key === "body" ? (
                <textarea
                  value={draft[key]}
                  maxLength={1600}
                  disabled={busy || locked}
                  onChange={(event) =>
                    setDraft({ ...draft, [key]: event.target.value })
                  }
                />
              ) : (
                <input
                  value={draft[key]}
                  maxLength={160}
                  disabled={busy || locked}
                  onChange={(event) =>
                    setDraft({ ...draft, [key]: event.target.value })
                  }
                />
              )}
            </label>
          ))}
          <button
            className="button"
            disabled={busy || locked || unresolved || !visible}
            onClick={() => void save()}
          >
            保存模板
          </button>
          <button
            className="button"
            disabled={busy || previewBusy || locked || !visible}
            onClick={() => void previewDraft()}
          >
            预览
          </button>
          {visible && !locked && preview && preview.draft === JSON.stringify(draft) && (
            <>
              <p>{preview.subject}</p>
              <iframe
                title="邮件预览"
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={preview.html.replace(
                  "<head>",
                  '<head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; form-action \'none\'; base-uri \'none\'">',
                )}
                style={{ width: "100%", height: 640, border: 0 }}
              />
            </>
          )}
        </>
      )}
      <label>
        模板操作编号
        <input
          value={identifier}
          maxLength={36}
          disabled={busy || locked || unresolved}
          onChange={(event) => {
            setIdentifier(event.target.value.trim());
            setReceipt(null);
          }}
        />
      </label>
      <button
        className="button"
        disabled={busy || locked || !uuid.test(identifier)}
        onClick={() => void query()}
      >
        查询模板回执
      </button>
      {unresolved && (
        <button
          className="button"
          disabled={busy || locked || !visible}
          onClick={() => void closeUnknown()}
        >
          关闭待核对请求
        </button>
      )}
      {receipt && (
        <p role="status">
          {receipt.requestId} ·{" "}
          {receipt.state === "completed"
            ? "已保存"
            : receipt.state === "failed"
              ? "未保存"
              : "结果待核对"}
          {receipt.message ? ` · ${receipt.message}` : ""}
        </p>
      )}
    </details>
  );
}
