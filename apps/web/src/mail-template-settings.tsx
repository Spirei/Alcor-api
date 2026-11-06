import { LoadingPlaceholder } from "./loading-placeholder";
import { FormActions, SettingsSurface } from "./workspace-forms";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Mail, Monitor, RefreshCw, Smartphone } from "lucide-react";
import { SelectMenu } from "./select-menu";
import { mailPreviewDocument } from "./mail-preview-document";
import "./mail-template-settings.css";
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
type Head = {
  revision: number;
  templates: Template[];
  defaults?: Template[];
  variables?: Record<string, string[]>;
};
type Receipt = {
  requestId: string;
  state: string;
  message?: string;
  revision: number;
};
type Preview = { subject: string; html: string; text: string };
const fields = [
  ["subject", "邮件主题"],
  ["title", "标题"],
  ["greeting", "称呼"],
  ["body", "正文"],
  ["valueLabel", "验证码 / 操作名称"],
  ["closing", "结束语"],
  ["signature", "落款"],
] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function MailTemplateSettings({
  session,
  expanded = false,
}: {
  session: Session;
  expanded?: boolean;
}) {
  const scope = JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  return (
    <TemplateSession
      key={JSON.stringify([scope, session.csrf, session.expires_at])}
      session={session}
      scope={scope}
      expanded={expanded}
    />
  );
}
function TemplateSession({
  session,
  scope,
  expanded,
}: {
  session: Session;
  scope: string;
  expanded: boolean;
}) {
  const [opened, setOpened] = useState(expanded),
    [head, setHead] = useState<Head | null>(null),
    [draft, setDraft] = useState<Template | null>(null);
  const [unresolved, setUnresolved] = useState(false);
  const [preview, setPreview] = useState<(Preview & { draft: string }) | null>(
    null,
  );
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewRevision, setPreviewRevision] = useState(0);
  const [mobile, setMobile] = useState(true);
  const drafts = useRef<Record<string, Template>>({});
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
    if (
      !displayed() ||
      (reason instanceof ApiError &&
        ([401, 403].includes(reason.status) ||
          reason.code === "session_changed"))
    ) {
      ++epoch.current;
      live.current = false;
      setLocked(true);
      setHead(null);
      setDraft(null);
      drafts.current = {};
      setReceipt(null);
      setIdentifier("");
      setPreview(null);
      ++previewSequence.current;
      previewController.current?.abort();
      previewController.current = null;
      setUnresolved(false);
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Retired UI never exposes a retained identifier. */
      }
    }
  }
  async function load(preserveDraft = false) {
    if (!live.current || locked || !displayed()) return;
    const replacing = draft?.id;
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
      if (!preserveDraft && replacing) delete drafts.current[replacing];
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
    if (
      !uuid.test(identifier) ||
      !live.current ||
      busy ||
      locked ||
      !displayed()
    )
      return;
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
      locked ||
      !displayed()
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
    if (
      !head ||
      !draft ||
      !live.current ||
      busy ||
      locked ||
      unresolved ||
      !displayed()
    )
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
  useEffect(() => {
    if (
      !draft ||
      !opened ||
      !visible ||
      locked ||
      busy ||
      !live.current ||
      !displayed()
    )
      return;
    const current = epoch.current,
      sequence = ++previewSequence.current,
      input = JSON.stringify(draft);
    const controller = new AbortController();
    previewController.current?.abort();
    previewController.current = controller;
    setPreviewBusy(true);
    setPreviewError("");
    const timer = window.setTimeout(() => {
      void api<Preview>(
        "/system/mail-templates/preview",
        { method: "POST", body: input, signal: controller.signal },
        session.csrf,
      )
        .then((value) => {
          if (
            !controller.signal.aborted &&
            live.current &&
            displayed() &&
            current === epoch.current &&
            sequence === previewSequence.current
          )
            setPreview({ ...value, draft: input });
        })
        .catch((reason: unknown) => {
          if (
            controller.signal.aborted ||
            current !== epoch.current ||
            sequence !== previewSequence.current
          )
            return;
          setPreview(null);
          setPreviewError(
            reason instanceof Error ? reason.message : "预览生成失败",
          );
          if (
            !displayed() ||
            (reason instanceof ApiError &&
              ([401, 403].includes(reason.status) ||
                reason.code === "session_changed"))
          )
            failure(reason);
        })
        .finally(() => {
          if (current === epoch.current && sequence === previewSequence.current)
            setPreviewBusy(false);
          if (previewController.current === controller)
            previewController.current = null;
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      ++previewSequence.current;
    };
  }, [draft, opened, visible, locked, busy, previewRevision]);
  const dirty =
    !!draft &&
    JSON.stringify(draft) !==
      JSON.stringify(head?.templates.find((item) => item.id === draft.id));
  const disabled = busy || locked || unresolved || !visible;
  const currentPreview =
    preview && draft && preview.draft === JSON.stringify(draft);
  const previewPending =
    previewBusy || (!!draft && !currentPreview && !previewError);
  return (
    <SettingsSurface
      title="邮件模板"
      expanded={expanded}
      open={opened}
      onOpenChange={setOpened}
    >
      <div
        className="mail-template-settings"
        data-preview={mobile ? "mobile" : "desktop"}
      >
        {error && <p role="alert">{error}</p>}
        <div className="mail-template-toolbar">
          <div
            className="mail-template-preview-switch"
            role="group"
            aria-label="预览尺寸"
          >
            <button
              type="button"
              aria-pressed={mobile}
              onClick={() => setMobile(true)}
            >
              <Smartphone size={15} aria-hidden="true" />
              手机
            </button>
            <button
              type="button"
              aria-pressed={!mobile}
              onClick={() => setMobile(false)}
            >
              <Monitor size={15} aria-hidden="true" />
              桌面
            </button>
          </div>
          <div className="mail-template-selection">
            {head && draft && (
              <SelectMenu
                label="邮件模板"
                value={draft.id}
                options={head.templates.map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
                disabled={disabled}
                onChange={(id) => {
                  drafts.current[draft.id] = draft;
                  setDraft(
                    drafts.current[id] ||
                      head.templates.find((item) => item.id === id) ||
                      null,
                  );
                  setPreview(null);
                  setReceipt(null);
                  setError("");
                }}
              />
            )}
            <button
              type="button"
              className="icon-button"
              title={dirty ? "请先保存或放弃当前修改" : "重新读取模板"}
              aria-label="重新读取模板"
              disabled={disabled || dirty}
              onClick={() => void load()}
            >
              <RefreshCw size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
        {head && draft ? (
          <div className="mail-template-grid">
            <form
              className="mail-template-editor"
              onSubmit={(event) => {
                event.preventDefault();
                if (dirty) void save();
              }}
            >
              <fieldset disabled={disabled}>
                {fields
                  .filter(
                    ([key]) =>
                      draft.id !== "price_alert" ||
                      (key !== "greeting" && key !== "closing"),
                  )
                  .map(([key, label]) => (
                    <label className="workspace-form-field" key={key}>
                      <span>
                        {key === "valueLabel" && draft.id === "price_alert"
                          ? "价格区标题"
                          : label}
                      </span>
                      {key === "body" ? (
                        <textarea
                          value={draft[key]}
                          rows={5}
                          maxLength={1600}
                          required
                          onChange={(event) =>
                            setDraft({ ...draft, [key]: event.target.value })
                          }
                        />
                      ) : (
                        <input
                          value={draft[key]}
                          maxLength={160}
                          required={key !== "signature"}
                          onChange={(event) =>
                            setDraft({ ...draft, [key]: event.target.value })
                          }
                        />
                      )}
                    </label>
                  ))}
              </fieldset>
              {!!head.variables?.[draft.id]?.length && (
                <p className="mail-template-variables">
                  变量：
                  {head.variables[draft.id]
                    .map((item) => `{{${item}}}`)
                    .join("、")}
                </p>
              )}
              <FormActions>
                {dirty && (
                  <button
                    type="button"
                    className="button"
                    disabled={disabled}
                    onClick={() => {
                      delete drafts.current[draft.id];
                      setDraft(
                        head.templates.find((item) => item.id === draft.id) ||
                          null,
                      );
                    }}
                  >
                    放弃修改
                  </button>
                )}
                <button
                  type="button"
                  className="button"
                  disabled={
                    disabled ||
                    !head.defaults?.some((item) => item.id === draft.id)
                  }
                  onClick={() =>
                    setDraft(
                      head.defaults?.find((item) => item.id === draft.id) ||
                        draft,
                    )
                  }
                >
                  恢复默认
                </button>
                <button
                  type="submit"
                  className="button primary"
                  disabled={disabled || !dirty}
                >
                  {busy ? "保存中…" : "保存模板"}
                </button>
              </FormActions>
              {receipt && (
                <p role="status">
                  {receipt.state === "completed"
                    ? "模板已保存"
                    : receipt.state === "failed"
                      ? "未保存"
                      : "结果待核对"}
                  {receipt.message ? ` · ${receipt.message}` : ""}
                </p>
              )}
            </form>
            {visible && !locked && (
              <MailPreviewPanel
                preview={preview}
                mobile={mobile}
                pending={previewPending}
                error={previewError}
                onRetry={() => setPreviewRevision((value) => value + 1)}
              />
            )}
          </div>
        ) : (
          !locked &&
          !error && <LoadingPlaceholder label="正在读取模板" compact />
        )}
        <details
          className="mail-template-receipts"
          open={unresolved || undefined}
        >
          <summary>操作核对{unresolved ? " · 上次保存结果待核对" : ""}</summary>
          <div className="mail-template-receipt-controls">
            <label className="workspace-form-field">
              <span>模板操作编号</span>
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
            <FormActions>
              <button
                type="button"
                className="button"
                disabled={busy || locked || !visible || !uuid.test(identifier)}
                onClick={() => void query()}
              >
                查询模板回执
              </button>
              {unresolved && (
                <button
                  type="button"
                  className="button"
                  disabled={busy || locked || !visible}
                  onClick={() => void closeUnknown()}
                >
                  关闭待核对请求
                </button>
              )}
            </FormActions>
            {receipt && (
              <p>
                {receipt.requestId} ·{" "}
                {receipt.state === "completed"
                  ? "已保存"
                  : receipt.state === "failed"
                    ? "未保存"
                    : "结果待核对"}
              </p>
            )}
          </div>
        </details>
      </div>
    </SettingsSurface>
  );
}

function MailPreviewPanel({
  preview,
  mobile,
  pending,
  error,
  onRetry,
}: {
  preview: Preview | null;
  mobile: boolean;
  pending: boolean;
  error: string;
  onRetry: () => void;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [mode, setMode] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      setWidth(
        Math.max(
          1,
          element.clientWidth -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight),
        ),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    const read = () =>
      setMode(root.dataset.theme === "dark" ? "dark" : "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  const frameWidth = mobile ? Math.min(390, width || 390) : 640;
  const scale = Math.min(1, (width || frameWidth) / frameWidth);
  const html = preview
    ? mailPreviewDocument(preview.html, mode, location.origin)
    : null;
  return (
    <section
      className="mail-template-preview"
      aria-label="邮件预览"
      aria-busy={pending}
    >
      <div className="mail-template-subject">
        <span>
          {pending
            ? "正在生成预览…"
            : error
              ? "预览暂不可用"
              : preview?.subject || "邮件预览"}
        </span>
        {error && (
          <button
            type="button"
            className="icon-button"
            aria-label="重新生成预览"
            onClick={onRetry}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="mail-template-canvas" ref={canvas}>
        {html && !error ? (
          <div
            className="mail-template-frame"
            style={{ width: frameWidth * scale, height: 780 * scale }}
          >
            <iframe
              title="邮件预览"
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={html}
              style={{ width: frameWidth, transform: `scale(${scale})` }}
            />
          </div>
        ) : (
          <div className="mail-template-placeholder">
            <Mail size={28} aria-hidden="true" />
            <span role={error ? "alert" : "status"}>
              {error || "正在生成预览…"}
            </span>
          </div>
        )}
      </div>
      <p className="mail-template-preview-note">
        使用示例内容预览，不会发送邮件。
      </p>
    </section>
  );
}
