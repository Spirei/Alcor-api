import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { PasswordField } from "./password-fields";
import { requestId } from "./request-id";
import { SelectMenu } from "./select-menu";
import { FormActions } from "./workspace-forms";
type Model = {
  id: string;
  name: string;
  models: string[];
  selectedModel: string;
};
type Result = {
  requestId?: string;
  state?: string;
  status?: string;
  ok?: boolean;
  latencyMs?: number;
  error?: string;
  cookie?: string;
  kind?: string;
  sourcePageId?: string;
  deliveryAuthority?: string;
};
const root = "/admin/provider-operations";
export function PrivateProviderActions({
  session,
  active,
  revision,
  models,
  onDenied,
  group,
}: {
  session: Session;
  group: string;
  active: boolean;
  revision: number;
  models: Model[];
  onDenied: (reason: unknown) => void;
}) {
  const storage = JSON.stringify([
    "private-provider-action",
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  const [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [service, setService] = useState(""),
    [model, setModel] = useState("");
  const [original, setOriginal] = useState("");
  const [tests, setTests] = useState<
    Record<
      string,
      {
        ok: boolean;
        latencyMs?: number;
        error?: string;
        requestId?: string;
        checkedAt?: string;
      }
    >
  >({});
  const [file, setFile] = useState<File | null>(null),
    [pending, setPending] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [cookie, setCookie] = useState("");
  const input = useRef<HTMLInputElement>(null),
    epoch = useRef(0),
    live = useRef(active);
  live.current = active;
  const clear = () => {
    setPassword("");
    setCode("");
    setFile(null);
    setCookie("");
    setTests({});
    setOriginal("");
    if (input.current) input.current.value = "";
  };
  useEffect(() => {
    try {
      const id = sessionStorage.getItem(storage);
      if (id && /^[0-9a-f-]{36}$/i.test(id)) setPending(id);
    } catch {
      /* Only operation UUID is retained. */
    }
    return () => {
      epoch.current++;
    };
  }, [storage]);
  useEffect(() => {
    epoch.current++;
    clear();
    setBusy(false);
    setMessage("");
  }, [active, revision, group]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) {
        epoch.current++;
        clear();
        setBusy(false);
        setMessage("");
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);
  const selected = models.find((value) => value.id === service);
  const current = (generation: number) =>
    live.current && !document.hidden && generation === epoch.current;
  function accept(value: Result, reveal = false) {
    if (value.sourcePageId && /^[0-9a-f-]{36}$/i.test(value.sourcePageId))
      setOriginal(value.sourcePageId);
    if (value.cookie && reveal) setCookie(value.cookie);
    setMessage(
      value.state === "unknown" || value.status === "unknown"
        ? "结果未知，只能核对原请求"
        : value.ok === false
          ? "测试未通过"
          : value.deliveryAuthority ===
              "smtp_accepted_not_inbox_delivery_confirmed"
            ? "SMTP 已接受，收件箱送达尚未确认"
            : value.kind === "model-icon"
              ? "图标已更新，请重新读取私有配置"
              : value.error ||
                [
                  value.state,
                  value.status,
                  value.latencyMs === undefined ? "" : value.latencyMs + " ms",
                ]
                  .filter(Boolean)
                  .join(" · ") ||
                "操作已返回",
    );
    if (
      ["completed", "rejected", "failed", "unavailable"].includes(
        value.state ?? "",
      ) ||
      ["completed", "succeeded", "failed", "unavailable"].includes(
        value.status ?? "",
      )
    ) {
      sessionStorage.removeItem(storage);
      setPending(null);
    }
  }
  async function run(
    kind:
      | "query"
      | "read-tests"
      | "mail-test"
      | "model-test"
      | "model-icon"
      | "xueqiu-cookie",
  ) {
    if (
      busy ||
      !active ||
      document.hidden ||
      (!["query", "read-tests"].includes(kind) && (!password || pending))
    )
      return;
    const generation = epoch.current;
    setBusy(true);
    setMessage("");
    setCookie("");
    try {
      if (kind === "read-tests") {
        const result = await api<{
          tests: Record<
            string,
            {
              ok: boolean;
              latencyMs?: number;
              error?: string;
              requestId?: string;
              checkedAt?: string;
            }
          >;
        }>(root + "/model-test", {}, session.csrf);
        if (current(generation)) setTests(result.tests);
        return;
      }
      if (kind === "query") {
        if (!pending) return;
        const result = await api<Result>(
          root + "/operations/" + pending,
          {},
          session.csrf,
        );
        if (current(generation)) accept(result);
        return;
      }
      if ((kind === "model-test" || kind === "model-icon") && !selected)
        throw new Error("请选择已保存的模型服务");
      if (
        kind === "model-test" &&
        (!model || !selected?.models.includes(model))
      )
        throw new Error("请选择已登记模型");
      if (kind === "model-icon" && (!file || file.size > 2 * 1024 * 1024))
        throw new Error("请选择不超过 2 MiB 的图标文件");
      const id = requestId();
      sessionStorage.setItem(storage, id);
      setPending(id);
      let body: string | FormData;
      if (kind === "model-icon") {
        const form = new FormData();
        form.set("requestId", id);
        form.set("expectedRevision", String(revision));
        form.set("serviceId", service);
        form.set("file", file!);
        form.set("password", password);
        if (code) form.set("code", code);
        body = form;
      } else
        body = JSON.stringify({
          requestId: id,
          expectedRevision: revision,
          password,
          ...(code ? { code } : {}),
          ...(kind === "model-test" ? { serviceId: service, model } : {}),
        });
      clear();
      const result = await api<Result>(
        root + "/" + kind,
        { method: "POST", body },
        session.csrf,
        60000,
      );
      if (current(generation)) accept(result, kind === "xueqiu-cookie");
    } catch (reason) {
      if (current(generation)) {
        if (
          reason instanceof ApiError &&
          ([400, 422, 428, 429].includes(reason.status) ||
            reason.code === "provider_proof_rejected")
        ) {
          sessionStorage.removeItem(storage);
          setPending(null);
          clear();
        }
        if (
          reason instanceof ApiError &&
          [401, 403].includes(reason.status) &&
          reason.code !== "provider_proof_rejected"
        ) {
          clear();
          onDenied(reason);
        }
        setMessage(
          reason instanceof Error
            ? reason.message
            : "操作失败；如已发送，请核对原请求",
        );
      }
    } finally {
      if (current(generation)) setBusy(false);
    }
  }
  const disabled = busy || !!pending || !active;
  const supported = ["smtp", "models", "cookies"].includes(group);
  if (!supported && !pending) return null;
  return (
    <details
      className="private-provider-actions"
      onToggle={(event) => {
        if (!event.currentTarget.open) {
          epoch.current++;
          clear();
          setBusy(false);
          setMessage("");
        }
      }}
    >
      <summary>
        {group === "smtp"
          ? "邮件连接测试"
          : group === "models"
            ? "模型测试与图标"
            : "Cookie 获取与核对"}
      </summary>
      {group === "smtp" && (
        <p className="private-group-status">
          测试邮件发送至当前管理员已验证邮箱；服务接受不代表已进入收件箱。
        </p>
      )}
      {group === "models" && (
        <>
          <p className="private-group-status">
            测试使用已保存且已批准的模型服务。
          </p>
          <button
            type="button"
            className="button"
            disabled={busy || !active}
            onClick={() => void run("read-tests")}
          >
            读取测试记录
          </button>
          {Object.entries(tests).map(([key, value]) => (
            <p className="private-group-status" key={key}>
              {models.find((item) => key.startsWith(item.id))?.name ||
                "已保存服务"}{" "}
              · {value.ok ? "已通过" : "未通过"}
              {value.latencyMs === undefined ? "" : ` · ${value.latencyMs} ms`}
              {value.checkedAt ? ` · ${value.checkedAt}` : ""}
              {value.error ? ` · ${value.error}` : ""}
            </p>
          ))}
        </>
      )}
      {pending && (
        <p>
          <button
            type="button"
            className="button"
            disabled={busy || !active}
            onClick={() => void run("query")}
          >
            核对原请求
          </button>
        </p>
      )}
      {supported && (
        <>
          <div className="form-grid">
            {group === "models" && (
              <>
                <label className="workspace-form-field">
                  <span>已保存模型服务</span>
                  <SelectMenu
                    label="已保存模型服务"
                    variant="field"
                    disabled={disabled}
                    value={service}
                    options={[
                      { value: "", label: "选择服务" },
                      ...models.map((value) => ({
                        value: value.id,
                        label: value.name || "未命名服务",
                      })),
                    ]}
                    onChange={(value) => {
                      setService(value);
                      setModel("");
                      setCookie("");
                    }}
                  />
                </label>
                <label className="workspace-form-field">
                  <span>模型</span>
                  <SelectMenu
                    label="已登记模型"
                    variant="field"
                    disabled={disabled}
                    value={model}
                    options={[
                      { value: "", label: "选择模型" },
                      ...(selected?.models ?? []).map((value) => ({
                        value,
                        label: value,
                      })),
                    ]}
                    onChange={setModel}
                  />
                </label>
              </>
            )}
            <label className="workspace-form-field">
              <span>当前密码</span>
              <PasswordField
                id="private-provider-password"
                value={password}
                disabled={disabled}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label className="workspace-form-field">
              <span>验证码或备用码</span>
              <input
                disabled={disabled}
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
          </div>
          <FormActions>
            {group === "smtp" && (
              <button
                type="button"
                className="button"
                disabled={disabled || !password}
                onClick={() => void run("mail-test")}
              >
                发送测试邮件
              </button>
            )}
            {group === "models" && (
              <button
                type="button"
                className="button"
                disabled={disabled || !password || !selected || !model}
                onClick={() => void run("model-test")}
              >
                测试已保存模型
              </button>
            )}
            {group === "cookies" && (
              <button
                type="button"
                className="button"
                disabled={disabled || !password}
                onClick={() => void run("xueqiu-cookie")}
              >
                获取雪球 Cookie
              </button>
            )}
          </FormActions>
          {group === "models" && (
            <div className="private-model-icon">
              <label className="workspace-form-field">
                <span>模型图标</span>
                <input
                  ref={input}
                  disabled={disabled}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <FormActions>
                <button
                  type="button"
                  className="button"
                  disabled={disabled || !password || !file || !selected}
                  onClick={() => void run("model-icon")}
                >
                  更新该服务图标
                </button>
              </FormActions>
            </div>
          )}
        </>
      )}
      {cookie && (
        <label className="workspace-form-field">
          <span>本次返回的秘密</span>
          <PasswordField
            id="private-xueqiu-cookie"
            value={cookie}
            readOnly
            autoComplete="off"
            onChange={() => {}}
          />
        </label>
      )}
      {original && (
        <a
          href={"/api/admin/provider-operations/originals/" + original}
          download
          rel="noreferrer"
        >
          下载本次提供商响应原件
        </a>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
