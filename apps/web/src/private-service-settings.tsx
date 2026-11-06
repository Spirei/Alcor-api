import { FormActions, SettingsSurface } from "./workspace-forms";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Mail,
  Boxes,
  Radio,
  Bell,
  Clock3,
  Cookie,
  RefreshCw,
} from "lucide-react";
import { WorkspaceTabs } from "./workspace-ui";
import { SelectMenu } from "./select-menu";
import { Dialog } from "./dialog";
import { apiSessionSnapshot } from "./api-session";
import { privateFieldLabel } from "./private-field-labels";
import { NotificationServiceFields } from "./notification-service-fields";
import { PasswordField } from "./password-fields";
import { api, ApiError, type Session } from "./api";
import { PrivateTargetFields } from "./private-target-fields";
import { PrivateProviderActions } from "./private-provider-actions";
import { requestId } from "./request-id";
import {
  PrivateSettingFields,
  type PrivateField,
  type SecretChange,
} from "./private-setting-fields";
type Approval = {
  host?: string;
  port?: number;
  path?: string;
  addresses?: string[];
  approvedAccess?: boolean;
  licenseRevision?: string;
  expiresAt?: string;
  ownerId?: string;
  instanceId?: string;
  purpose?: string;
  allowPlaintext?: boolean;
  allowPrivate?: boolean;
};
type Model = {
  id: string;
  name: string;
  provider: string;
  apiUrl: string;
  models: string[];
  selectedModel: string;
  icon?: string;
  icons?: Record<string, string>;
  approval?: Approval;
  providerConfigs?: Record<string, Record<string, unknown>>;
};
type Group = {
  values: Record<string, unknown>;
  secretState: Record<string, string>;
  state: string;
};
type Head = {
  revision: number;
  groups: Record<string, Group>;
  unavailable: Record<string, string>;
};
type Receipt = {
  requestId: string;
  state: string;
  revision?: number;
  error?: string;
  result?: unknown;
};
const root = "/admin/private-runtime-settings";
const serviceGroups = [
  { value: "smtp", label: "邮件", icon: Mail },
  { value: "models", label: "模型", icon: Boxes },
  { value: "sources", label: "数据来源", icon: Radio },
  { value: "notifications", label: "通知", icon: Bell },
  { value: "scheduling", label: "调度", icon: Clock3 },
  { value: "cookies", label: "Cookie", icon: Cookie },
];
function emptyGroup(group: string): Record<string, unknown> {
  if (group === "sources")
    return {
      ...Object.fromEntries(
        [
          "market_data_policies",
          "dividend_source_targets",
          "fx_provider_targets",
          "market_discovery_targets",
          "earnings_targets",
          "sec_company_targets",
          "sec_financial_targets",
          "broker_statement_targets",
          "record_ocr_targets",
          "card_ocr_targets",
          "feed_targets",
          "feed_model_targets",
          "celeb_source_targets",
          "asset_source_targets",
        ].map((key) => [key, []]),
      ),
      public_ticker: {},
      translationEnabled: false,
      translationProvider: "",
      translationApiUrl: "",
      translationApproval: {},
    };
  if (group === "notifications") return { business_notification_targets: [] };
  if (group === "models")
    return { modelServices: [], activeModelServiceId: "" };
  if (group === "scheduling")
    return { worker_poll_seconds: null, lease_seconds: null };
  if (group === "cookies") return { xueqiuCookieTargetId: "" };
  return {
    smtpEnabled: false,
    smtpSecure: false,
    smtpApproval: {},
    smtpHost: "",
    smtpPort: 587,
    smtpFromName: "",
    smtpFromEmail: "",
    emailLinkOrigin: "",
    mailTimeout: 10,
  };
}
const smtpFields: PrivateField[] = [
  { key: "smtpEnabled", label: "启用邮件", type: "boolean" },
  { key: "smtpHost", label: "SMTP 主机", type: "string" },
  { key: "smtpPort", label: "端口", type: "number" },
  { key: "smtpSecure", label: "直接 TLS", type: "boolean" },
  { key: "smtpFromName", label: "发件人名称", type: "string" },
  { key: "smtpFromEmail", label: "发件邮箱", type: "string" },
  { key: "emailLinkOrigin", label: "邮件链接来源", type: "string" },
  { key: "mailTimeout", label: "邮件超时（秒）", type: "number" },
];
function ApprovalFields({
  value,
  disabled,
  onChange,
  smtp = false,
}: {
  value: Approval;
  disabled: boolean;
  smtp?: boolean;
  onChange: (value: Approval) => void;
}) {
  return (
    <details>
      <summary>目标批准与许可</summary>
      <div className="form-grid">
        {(
          [
            ["host", "目标主机"],
            ["path", "批准路径"],
            ["licenseRevision", "许可版本"],
            ["expiresAt", "到期时间（含时区）"],
            ["ownerId", "来源所有者 ID"],
            ["instanceId", "实例 ID"],
            ["purpose", "用途"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              disabled={disabled}
              value={value[key] ?? ""}
              onChange={(event) =>
                onChange({ ...value, [key]: event.target.value })
              }
            />
          </label>
        ))}
        <label>
          目标端口
          <input
            disabled={disabled}
            type="number"
            value={value.port ?? ""}
            onChange={(event) =>
              onChange({
                ...value,
                port: event.target.value
                  ? Number(event.target.value)
                  : undefined,
              })
            }
          />
        </label>
        <label>
          批准地址（每行一项）
          <textarea
            disabled={disabled}
            value={(value.addresses ?? []).join("\n")}
            onChange={(event) =>
              onChange({
                ...value,
                addresses: event.target.value.split("\n").filter(Boolean),
              })
            }
          />
        </label>
        <PrivateSettingFields
          fields={[
            { key: "allowPrivate", label: "允许固定私网目标", type: "boolean" },
            ...(!smtp
              ? [
                  {
                    key: "allowPlaintext",
                    label: "允许此目标明文连接",
                    type: "boolean" as const,
                  },
                ]
              : []),
            {
              key: "approvedAccess",
              label: "明确批准此目标访问",
              type: "boolean",
            },
          ]}
          value={value as Record<string, unknown>}
          secrets={{}}
          disabled={disabled}
          onChange={(key, next) => onChange({ ...value, [key]: next })}
          onSecret={() => {}}
        />
      </div>
    </details>
  );
}
export function PrivateServiceSettings({
  session,
  active = true,
  expanded = false,
}: {
  session: Session;
  active?: boolean;
  expanded?: boolean;
}) {
  return (
    <Content
      key={JSON.stringify([
        session.instance_id,
        session.user.id,
        session.user.role,
        session.receipt_scope,
        session.csrf,
        session.expires_at,
      ])}
      session={session}
      active={active}
      expanded={expanded}
    />
  );
}
function Content({
  session,
  active,
  expanded,
}: {
  session: Session;
  active: boolean;
  expanded: boolean;
}) {
  const storage = JSON.stringify([
    "private-service-settings",
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  const [open, setOpen] = useState(expanded),
    [visible, setVisible] = useState(!document.hidden),
    [head, setHead] = useState<Head | null>(null);
  const [repair, setRepair] = useState(false);
  const [newerHead, setNewerHead] = useState<Head | null>(null);
  const editing = useRef<{ head: Head | null; dirty: boolean }>({
    head: null,
    dirty: false,
  });
  const [password, setPassword] = useState(""),
    [code, setCode] = useState("");
  const [nextGroup, setNextGroup] = useState<string | null>(null);
  const [sourceCollection, setSourceCollection] = useState("");
  const [group, setGroup] = useState("smtp"),
    [draft, setDraft] = useState<Record<string, unknown>>({}),
    [secrets, setSecrets] = useState<Record<string, SecretChange>>({});
  const [pending, setPending] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [locked, setLocked] = useState(false),
    [message, setMessage] = useState("");
  const epoch = useRef(0),
    live = useRef(false);
  const readAttempt = useRef(false);
  const displayed = () => apiSessionSnapshot().csrf === session.csrf;
  live.current = active && open && visible && !locked && displayed();
  useEffect(() => {
    try {
      const id = sessionStorage.getItem(storage);
      if (id && /^[0-9a-f-]{36}$/i.test(id)) setPending(id);
    } catch {
      /* No configuration is persisted. */
    }
    return () => {
      epoch.current++;
    };
  }, [storage]);
  useEffect(() => {
    const hidden = () => {
      setVisible(!document.hidden);
      if (document.hidden) {
        readAttempt.current = false;
        setNextGroup(null);
        epoch.current++;
        setSecrets({});
        setPassword("");
        setCode("");
        setRepair(false);
        setMessage("");
        setBusy(false);
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);
  useLayoutEffect(() => {
    epoch.current++;
    live.current = active && open && visible && !locked && displayed();
    readAttempt.current = false;
    setNextGroup(null);
    setSecrets({});
    setPassword("");
    setCode("");
    setRepair(false);
    setBusy(false);
    return () => {
      live.current = false;
      epoch.current++;
      setSecrets({});
      setPassword("");
      setCode("");
      setNextGroup(null);
      setBusy(false);
    };
  }, [active, open]);
  const current = (generation: number) =>
    live.current &&
    displayed() &&
    !document.hidden &&
    epoch.current === generation;
  function fail(reason: unknown) {
    if (
      !displayed() ||
      (reason instanceof ApiError &&
        ([401, 403].includes(reason.status) ||
          reason.code === "session_changed"))
    ) {
      setLocked(true);
      setHead(null);
      setNewerHead(null);
      setDraft({});
      setSecrets({});
      setPassword("");
      setCode("");
      setPending(null);
      try {
        sessionStorage.removeItem(storage);
      } catch {
        /* Already retired in memory. */
      }
    }
    setMessage(reason instanceof Error ? reason.message : "私有配置不可用");
  }
  function accept(value: Head, chosen = group) {
    setNewerHead(null);
    setRepair(false);
    setHead(value);
    setDraft(value.groups[chosen]?.values ?? {});
    setSecrets({});
    setPassword("");
    setCode("");
  }
  async function read() {
    if (!live.current || busy) return;
    const generation = epoch.current;
    setBusy(true);
    setMessage("");
    try {
      const value = await api<Head>(root, {}, session.csrf);
      if (current(generation)) {
        const before = editing.current;
        if (before.head && before.dirty) {
          if (value.revision !== before.head.revision) {
            setNewerHead(value);
            setMessage("配置已在其他端更新，请放弃当前修改后重新编辑");
          }
        } else accept(value);
      }
    } catch (reason) {
      if (current(generation)) fail(reason);
    } finally {
      if (current(generation)) setBusy(false);
    }
  }
  useEffect(() => {
    if (active && open && visible && !locked && !busy && !readAttempt.current) {
      readAttempt.current = true;
      void read();
    }
  }, [active, open, visible, locked, busy]);
  async function refreshCommitted(generation: number, message: string) {
    try {
      const value = await api<Head>(root, {}, session.csrf);
      if (current(generation)) {
        accept(value);
        setMessage(message);
      }
    } catch (reason) {
      if (current(generation)) {
        fail(reason);
        if (!(reason instanceof ApiError && [401, 403].includes(reason.status)))
          setMessage(message + "；重新读取暂不可用");
      }
    }
  }
  async function query() {
    if (!live.current || busy || !pending) return;
    const generation = epoch.current;
    setBusy(true);
    try {
      const value = await api<Receipt>(
        root + "/operations/" + pending,
        {},
        session.csrf,
      );
      if (current(generation)) {
        if (value.state === "completed") {
          sessionStorage.removeItem(storage);
          setPending(null);
          await refreshCommitted(generation, "已核对原请求，配置操作已完成");
        } else setMessage("原请求结果仍未知，请继续核对");
      }
    } catch (reason) {
      if (current(generation)) fail(reason);
    } finally {
      if (current(generation)) setBusy(false);
    }
  }
  async function save() {
    if (!live.current || busy || pending || !head || newerHead) return;
    const generation = epoch.current;
    setBusy(true);
    setMessage("");
    try {
      const secretActions = Object.fromEntries(
        Object.entries(secrets)
          .filter(([key, value]) => {
            const [collection, id] = key.split(".");
            const rows = draft[collection];
            return (
              value.mode !== "keep" &&
              (!Array.isArray(rows) ||
                rows.some(
                  (row) =>
                    row &&
                    typeof row === "object" &&
                    (row as Record<string, unknown>).id === id,
                ))
            );
          })
          .map(([key, value]) => [
            key,
            value.mode === "clear"
              ? { action: "clear" }
              : { action: "set", value: value.value },
          ]),
      );
      const id = requestId();
      sessionStorage.setItem(storage, id);
      setPending(id);
      const body = {
        requestId: id,
        expectedRevision: head.revision,
        group,
        patch: draft,
        secretActions,
        ...(group === "notifications" && password ? { password, code } : {}),
        ...(repair ? { replaceUnavailable: true } : {}),
      };
      setSecrets({});
      setPassword("");
      setCode("");
      const value = await api<Receipt>(
        root,
        { method: "POST", body: JSON.stringify(body) },
        session.csrf,
      );
      if (current(generation)) {
        if (value.state === "completed") {
          sessionStorage.removeItem(storage);
          setPending(null);
          await refreshCommitted(
            generation,
            "配置已保存；连接或送达状态尚未测试",
          );
        } else setMessage("结果未知，只核对原请求");
      }
    } catch (reason) {
      if (current(generation)) {
        if (
          reason instanceof ApiError &&
          ([400, 422, 428, 429].includes(reason.status) ||
            (reason.status === 409 && reason.message === "私有配置修订已变化"))
        ) {
          sessionStorage.removeItem(storage);
          setPending(null);
        }
        fail(reason);
      }
    } finally {
      if (current(generation)) setBusy(false);
    }
  }
  const blocked =
    busy ||
    !!pending ||
    locked ||
    !active ||
    !visible ||
    (head?.groups[group]?.state === "unavailable" && !repair);
  const value = head?.groups[group];
  const sourceCollections = Object.entries(draft).filter(
    ([key, item]) =>
      key !== "legacyChannelSettings" &&
      item !== null &&
      typeof item === "object",
  );
  const selectedCollection = sourceCollections.some(
    ([key]) => key === sourceCollection,
  )
    ? sourceCollection
    : sourceCollections[0]?.[0] || "";
  const dirty =
    !!head &&
    (repair ||
      JSON.stringify(draft) !== JSON.stringify(value?.values ?? {}) ||
      Object.values(secrets).some((value) => value.mode !== "keep"));
  editing.current = { head, dirty };
  function changeGroup(chosen: string) {
    const currentHead = newerHead || head;
    if (currentHead) setHead(currentHead);
    setNewerHead(null);
    setGroup(chosen);
    setRepair(false);
    setDraft(currentHead?.groups[chosen]?.values ?? {});
    setSecrets({});
    setPassword("");
    setCode("");
    setMessage("");
    setNextGroup(null);
  }
  const models = Array.isArray(draft.modelServices)
    ? (draft.modelServices as Model[])
    : [];
  function updateModel(index: number, change: Partial<Model>) {
    setDraft({
      ...draft,
      modelServices: models.map((model, i) =>
        i === index ? { ...model, ...change } : model,
      ),
    });
  }
  const targetEditors =
    ["sources", "notifications"].includes(group) &&
    Object.entries(draft)
      .filter(
        ([key, item]) =>
          key !== "legacyChannelSettings" &&
          (group !== "sources" || key === selectedCollection) &&
          item !== null &&
          typeof item === "object",
      )
      .map(([key, items]) => (
        <section className="private-source-editor" key={key}>
          <h3>
            {group === "notifications" ? "已登记连接" : privateFieldLabel(key)}
          </h3>
          {Array.isArray(items) ? (
            <>
              {items.map((item, index) => (
                <fieldset key={index}>
                  <legend>
                    {String(
                      (item as Record<string, unknown>)?.name ??
                        `来源 ${index + 1}`,
                    )}
                  </legend>
                  <PrivateTargetFields
                    value={item as Record<string, unknown>}
                    disabled={blocked}
                    onChange={(next) =>
                      setDraft({
                        ...draft,
                        [key]: items.map((old, i) =>
                          i === index ? next : old,
                        ),
                      })
                    }
                  />
                  {[
                    "feed_model_targets",
                    "record_ocr_targets",
                    "card_ocr_targets",
                    "feed_targets",
                  ].includes(key) &&
                    typeof (item as Record<string, unknown>).id ===
                      "string" && (
                      <PrivateSettingFields
                        fields={[
                          {
                            key:
                              key +
                              "." +
                              String((item as Record<string, unknown>).id) +
                              ".credentialCiphertext",
                            label: "来源令牌（由平台封装）",
                            type: "secret",
                            configured:
                              value?.secretState?.[
                                key +
                                  "." +
                                  String((item as Record<string, unknown>).id) +
                                  ".credentialCiphertext"
                              ] === "configured",
                          },
                        ]}
                        value={{}}
                        secrets={secrets}
                        disabled={blocked}
                        onChange={() => {}}
                        onSecret={(key, value) =>
                          setSecrets({ ...secrets, [key]: value })
                        }
                      />
                    )}
                  <button
                    type="button"
                    className="button"
                    disabled={blocked}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        [key]: items.filter((_, i) => i !== index),
                      })
                    }
                  >
                    移除此来源
                  </button>
                </fieldset>
              ))}
              <button
                type="button"
                className="button"
                disabled={blocked}
                onClick={() =>
                  setDraft({
                    ...draft,
                    [key]: [...items, { id: requestId() }],
                  })
                }
              >
                {group === "notifications" ? "登记连接" : "添加来源"}
              </button>
            </>
          ) : items && typeof items === "object" ? (
            <PrivateTargetFields
              value={items as Record<string, unknown>}
              disabled={blocked}
              onChange={(value) => setDraft({ ...draft, [key]: value })}
            />
          ) : (
            <p>此配置类型需使用对应来源入口</p>
          )}
        </section>
      ));
  return (
    <SettingsSurface
      title="接口与服务"
      expanded={expanded}
      open={open}
      onOpenChange={setOpen}
    >
      <div className="private-settings">
        {open && (
          <>
            {pending && (
              <button
                type="button"
                className="button"
                disabled={busy || locked}
                onClick={() => void query()}
              >
                核对原请求 {pending}
              </button>
            )}
            {message && <p role="status">{message}</p>}
            {!head && (
              <button
                type="button"
                className="button secondary"
                disabled={busy || locked || !active || !visible}
                onClick={() => void read()}
              >
                重新读取配置
              </button>
            )}
            {head && (
              <>
                <div className="private-service-navigation">
                  <WorkspaceTabs
                    label="服务分组"
                    value={group}
                    items={serviceGroups.filter((item) =>
                      Object.hasOwn(head.groups, item.value),
                    )}
                    disabled={
                      busy || !!pending || locked || !active || !visible
                    }
                    onChange={(chosen) => {
                      if (dirty) setNextGroup(chosen);
                      else changeGroup(chosen);
                    }}
                  />

                  <button
                    type="button"
                    className="icon-button"
                    aria-label="重新读取配置"
                    disabled={
                      busy ||
                      locked ||
                      !active ||
                      !visible ||
                      dirty ||
                      !!pending
                    }
                    onClick={() => void read()}
                  >
                    <RefreshCw size={17} aria-hidden="true" />
                  </button>
                </div>
                {value?.state !== "installation" && (
                  <p className="private-group-status">
                    {{
                      saved: "已保存配置",
                      installation: "当前安装配置",
                      unavailable: "当前配置无法读取",
                    }[value?.state || ""] || "配置状态待核对"}
                  </p>
                )}
                {value?.state === "unavailable" && (
                  <PrivateSettingFields
                    fields={[
                      {
                        key: "repair",
                        label: "重新填写此分组；保留原密文版本",
                        type: "boolean",
                      },
                    ]}
                    value={{ repair }}
                    secrets={{}}
                    disabled={
                      busy || !!pending || locked || !active || !visible
                    }
                    onChange={(_, next) => {
                      setRepair(next === true);
                      setDraft(next === true ? emptyGroup(group) : {});
                      setSecrets({});
                      setPassword("");
                      setCode("");
                    }}
                    onSecret={() => {}}
                  />
                )}
                {group === "smtp" && (
                  <div className="form-grid">
                    <PrivateSettingFields
                      fields={[
                        ...smtpFields,
                        ...(["smtpUser", "smtpPassword"] as const).map(
                          (key) => ({
                            key,
                            label:
                              key === "smtpUser" ? "SMTP 用户名" : "SMTP 密码",
                            type: "secret" as const,
                            configured:
                              value?.secretState?.[key] === "configured",
                          }),
                        ),
                      ]}
                      value={draft}
                      secrets={secrets}
                      disabled={blocked}
                      onChange={(key, value) =>
                        setDraft({ ...draft, [key]: value })
                      }
                      onSecret={(key, value) =>
                        setSecrets({ ...secrets, [key]: value })
                      }
                    />
                    <ApprovalFields
                      smtp
                      value={(draft.smtpApproval ?? {}) as Approval}
                      disabled={blocked}
                      onChange={(value) =>
                        setDraft({ ...draft, smtpApproval: value })
                      }
                    />
                  </div>
                )}
                {group === "models" && (
                  <>
                    <label>
                      当前模型服务
                      <SelectMenu
                        label="当前模型服务"
                        variant="field"
                        disabled={blocked}
                        value={String(draft.activeModelServiceId ?? "")}
                        options={[
                          { value: "", label: "未指定" },
                          ...models.map((model) => ({
                            value: model.id,
                            label: model.name || "未命名服务",
                          })),
                        ]}
                        onChange={(activeModelServiceId) =>
                          setDraft({ ...draft, activeModelServiceId })
                        }
                      />
                    </label>
                    <PrivateSettingFields
                      fields={Object.entries(draft)
                        .filter(
                          ([key, item]) =>
                            !["modelServices", "activeModelServiceId"].includes(
                              key,
                            ) &&
                            !/password|api.?key|token|credential|secret|cookie|aeskey|webhook/i.test(
                              key,
                            ) &&
                            ["string", "boolean", "number"].includes(
                              typeof item,
                            ),
                        )
                        .map(([key, item]) => ({
                          key,
                          label: privateFieldLabel(key),
                          type:
                            typeof item === "boolean"
                              ? ("boolean" as const)
                              : typeof item === "number"
                                ? ("number" as const)
                                : ("string" as const),
                        }))}
                      value={draft}
                      secrets={secrets}
                      disabled={blocked}
                      onChange={(key, value) =>
                        setDraft({ ...draft, [key]: value })
                      }
                      onSecret={() => {}}
                    />
                    <PrivateSettingFields
                      fields={Object.entries(value?.secretState ?? {})
                        .filter(([key]) => !key.startsWith("modelServices."))
                        .map(([key, state]) => ({
                          key,
                          label: privateFieldLabel(key),
                          type: "secret" as const,
                          configured: state === "configured",
                        }))}
                      value={{}}
                      secrets={secrets}
                      disabled={blocked}
                      onChange={() => {}}
                      onSecret={(key, value) =>
                        setSecrets({ ...secrets, [key]: value })
                      }
                    />
                    {models.map((model, index) => (
                      <fieldset key={model.id}>
                        <legend>{model.name || `模型服务 ${index + 1}`}</legend>
                        <div className="form-grid">
                          <PrivateSettingFields
                            fields={[
                              { key: "name", label: "名称", type: "string" },
                              {
                                key: "provider",
                                label: "供应商",
                                type: "string",
                                choices: [
                                  "deepseek",
                                  "openai",
                                  "jev",
                                  "custom",
                                ],
                              },
                              {
                                key: "apiUrl",
                                label: "批准 API 地址",
                                type: "string",
                              },
                            ]}
                            value={model as unknown as Record<string, unknown>}
                            secrets={{}}
                            disabled={blocked}
                            onChange={(key, value) =>
                              updateModel(index, { [key]: value })
                            }
                            onSecret={() => {}}
                          />
                          <label>
                            模型（每行一项）
                            <textarea
                              disabled={blocked}
                              value={(model.models ?? []).join("\n")}
                              onChange={(event) =>
                                updateModel(index, {
                                  models: event.target.value
                                    .split("\n")
                                    .filter(Boolean),
                                })
                              }
                            />
                          </label>
                          <label>
                            选定模型
                            <SelectMenu
                              label="选定模型"
                              variant="field"
                              disabled={blocked}
                              value={model.selectedModel ?? ""}
                              options={[
                                { value: "", label: "未指定" },
                                ...(model.models ?? []).map((name) => ({
                                  value: name,
                                  label: name,
                                })),
                              ]}
                              onChange={(selectedModel) =>
                                updateModel(index, { selectedModel })
                              }
                            />
                          </label>
                          <PrivateSettingFields
                            fields={[
                              {
                                key: "modelServices." + model.id + ".apiKey",
                                label: "API Key",
                                type: "secret",
                                configured:
                                  value?.secretState?.[
                                    "modelServices." + model.id + ".apiKey"
                                  ] === "configured",
                              },
                            ]}
                            value={{}}
                            secrets={secrets}
                            disabled={blocked}
                            onChange={() => {}}
                            onSecret={(key, value) =>
                              setSecrets({ ...secrets, [key]: value })
                            }
                          />
                        </div>
                        <ApprovalFields
                          value={model.approval ?? {}}
                          disabled={blocked}
                          onChange={(approval) =>
                            updateModel(index, { approval })
                          }
                        />
                        <details>
                          <summary>供应商分配置</summary>
                          <PrivateTargetFields
                            value={model.providerConfigs ?? {}}
                            disabled={blocked}
                            onChange={(providerConfigs) =>
                              updateModel(index, {
                                providerConfigs:
                                  providerConfigs as Model["providerConfigs"],
                              })
                            }
                          />
                          {Object.keys(model.providerConfigs ?? {}).map(
                            (provider) => (
                              <PrivateSettingFields
                                key={provider}
                                fields={[
                                  {
                                    key:
                                      "modelServices." +
                                      model.id +
                                      ".providerConfigs." +
                                      provider +
                                      ".apiKey",
                                    label: provider + " API Key",
                                    type: "secret",
                                    configured:
                                      value?.secretState?.[
                                        "modelServices." +
                                          model.id +
                                          ".providerConfigs." +
                                          provider +
                                          ".apiKey"
                                      ] === "configured",
                                  },
                                ]}
                                value={{}}
                                secrets={secrets}
                                disabled={blocked}
                                onChange={() => {}}
                                onSecret={(key, value) =>
                                  setSecrets({ ...secrets, [key]: value })
                                }
                              />
                            ),
                          )}
                        </details>
                        <button
                          type="button"
                          className="button"
                          disabled={blocked}
                          onClick={() => {
                            setDraft({
                              ...draft,
                              modelServices: models.filter(
                                (_, i) => i !== index,
                              ),
                            });
                            setSecrets(
                              Object.fromEntries(
                                Object.entries(secrets).filter(
                                  ([key]) =>
                                    !key.startsWith(
                                      "modelServices." + model.id + ".",
                                    ),
                                ),
                              ),
                            );
                          }}
                        >
                          移除此服务配置
                        </button>
                      </fieldset>
                    ))}
                    <button
                      type="button"
                      className="button"
                      disabled={blocked}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          modelServices: [
                            ...models,
                            {
                              id: requestId(),
                              name: "",
                              provider: "custom",
                              apiUrl: "",
                              models: [],
                              selectedModel: "",
                            },
                          ],
                        })
                      }
                    >
                      添加模型服务
                    </button>
                  </>
                )}
                {["sources", "notifications"].includes(group) && (
                  <PrivateSettingFields
                    fields={Object.entries(draft)
                      .filter(
                        ([key, item]) =>
                          !/password|api.?key|token|credential|secret|cookie|aeskey|webhook/i.test(
                            key,
                          ) &&
                          ["string", "boolean", "number"].includes(typeof item),
                      )
                      .map(([key, item]) => ({
                        key,
                        label: privateFieldLabel(key),
                        type:
                          typeof item === "boolean"
                            ? ("boolean" as const)
                            : typeof item === "number"
                              ? ("number" as const)
                              : ("string" as const),
                      }))}
                    value={draft}
                    secrets={secrets}
                    disabled={blocked}
                    onChange={(key, value) =>
                      setDraft({ ...draft, [key]: value })
                    }
                    onSecret={() => {}}
                  />
                )}
                {group === "sources" && (
                  <label className="workspace-form-field private-source-selector">
                    <span>数据来源</span>
                    <SelectMenu
                      label="数据来源类别"
                      variant="field"
                      value={selectedCollection}
                      options={sourceCollections.map(([key]) => ({
                        value: key,
                        label: privateFieldLabel(key),
                      }))}
                      disabled={blocked}
                      onChange={setSourceCollection}
                    />
                  </label>
                )}
                {group === "sources" && targetEditors}
                {["sources", "notifications"].includes(group) && value && (
                  <PrivateSettingFields
                    fields={Object.entries(value.secretState ?? {})
                      .filter(
                        ([key]) =>
                          !key.startsWith("legacyChannelSettings.") &&
                          ![
                            "feed_model_targets",
                            "record_ocr_targets",
                            "card_ocr_targets",
                            "feed_targets",
                          ].some(
                            (collection) =>
                              key.startsWith(collection + ".") &&
                              key.endsWith(".credentialCiphertext"),
                          ),
                      )
                      .map(([key, state]) => ({
                        key,
                        label: privateFieldLabel(key),
                        type: "secret" as const,
                        configured: state === "configured",
                      }))}
                    value={{}}
                    secrets={secrets}
                    disabled={blocked}
                    onChange={() => {}}
                    onSecret={(key, value) =>
                      setSecrets({ ...secrets, [key]: value })
                    }
                  />
                )}
                {group === "notifications" && (
                  <>
                    <NotificationServiceFields
                      value={draft}
                      states={value?.secretState ?? {}}
                      secrets={secrets}
                      disabled={blocked}
                      onChange={setDraft}
                      onSecret={(key, value) =>
                        setSecrets({ ...secrets, [key]: value })
                      }
                    />
                    <section className="private-notification-proof">
                      <h3>验证当前管理员</h3>
                      <p className="private-group-status">
                        更改通知凭据或启停渠道时验证身份；保存配置不会发送消息或绑定接收人。
                      </p>
                      <div className="form-grid">
                        <label className="workspace-form-field">
                          <span>当前密码</span>
                          <PasswordField
                            id="runtime-notification-password"
                            value={password}
                            disabled={blocked}
                            autoComplete="current-password"
                            onChange={(event) =>
                              setPassword(event.target.value)
                            }
                          />
                        </label>
                        <label className="workspace-form-field">
                          <span>验证码或备用码</span>
                          <input
                            value={code}
                            disabled={blocked}
                            autoComplete="one-time-code"
                            onChange={(event) => setCode(event.target.value)}
                          />
                        </label>
                      </div>
                    </section>
                  </>
                )}
                {group === "notifications" && (
                  <details>
                    <summary>连接目标（高级）</summary>
                    {targetEditors}
                  </details>
                )}
                {group === "scheduling" && (
                  <PrivateSettingFields
                    fields={[
                      {
                        key: "worker_poll_seconds",
                        label: "Worker 轮询间隔（秒）",
                        type: "number",
                      },
                      {
                        key: "lease_seconds",
                        label: "任务租期（秒）",
                        type: "number",
                      },
                    ]}
                    value={draft}
                    secrets={secrets}
                    disabled={blocked}
                    onChange={(key, value) =>
                      setDraft({ ...draft, [key]: value })
                    }
                    onSecret={() => {}}
                  />
                )}
                {group === "cookies" && (
                  <PrivateSettingFields
                    fields={[
                      {
                        key: "xueqiuCookieTargetId",
                        label: "已批准雪球目标 ID",
                        type: "string",
                      },
                      {
                        key: "xueqiuCookie",
                        label: "雪球 Cookie",
                        type: "secret",
                        configured:
                          value?.secretState?.xueqiuCookie === "configured",
                      },
                    ]}
                    value={draft}
                    secrets={secrets}
                    disabled={blocked}
                    onChange={(key, value) =>
                      setDraft({ ...draft, [key]: value })
                    }
                    onSecret={(key, value) =>
                      setSecrets({ ...secrets, [key]: value })
                    }
                  />
                )}
                {[
                  "smtp",
                  "models",
                  "sources",
                  "notifications",
                  "scheduling",
                  "cookies",
                ].includes(group) && (
                  <div className="private-settings-actions">
                    {dirty && (
                      <button
                        type="button"
                        className="button"
                        disabled={blocked}
                        onClick={() => {
                          if (newerHead || head) accept((newerHead || head)!);
                          setMessage("");
                        }}
                      >
                        放弃修改
                      </button>
                    )}
                    <button
                      type="button"
                      className="button primary"
                      disabled={blocked || !dirty || !!newerHead}
                      onClick={() => void save()}
                    >
                      {busy && pending ? "处理中…" : "保存此分组"}
                    </button>
                  </div>
                )}
                <PrivateProviderActions
                  group={group}
                  session={session}
                  active={
                    active && open && visible && !locked && !busy && !pending
                  }
                  revision={head.revision}
                  models={
                    Array.isArray(head.groups.models?.values.modelServices)
                      ? (head.groups.models.values.modelServices as Model[])
                      : []
                  }
                  onDenied={fail}
                />
              </>
            )}
          </>
        )}
      </div>
      {nextGroup && (
        <Dialog title="切换配置分组" onClose={() => setNextGroup(null)}>
          <p>
            当前分组有未保存的修改。切换后，这些修改和未保存的秘密输入会被清除。
          </p>
          <FormActions>
            <button
              type="button"
              className="button"
              data-dialog-autofocus
              onClick={() => setNextGroup(null)}
            >
              继续编辑
            </button>
            <button
              type="button"
              className="button"
              onClick={() => changeGroup(nextGroup)}
            >
              放弃并切换
            </button>
          </FormActions>
        </Dialog>
      )}
    </SettingsSurface>
  );
}
