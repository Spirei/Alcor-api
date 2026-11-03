import { requestId as newRequestId } from "./request-id";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { Session } from "./api";
import { useResource } from "./hooks";
import { Dialog } from "./dialog";

type Client = {
  client_id: string;
  name: string;
  redirect_uris: string[];
  scopes: string[];
  active: boolean;
  revision: string | null;
};
type Grant = {
  id: string;
  name: string;
  client_id: string;
  device_name: string;
  scopes: string[];
  created_at: string;
  expires_at: string;
  active: boolean;
};
const labels: Record<string, string> = {
  "profile.read": "读取个人资料",
  "profile.write": "修改个人资料",
  "activity.read": "读取本人活动",
};
const empty: Client = {
  client_id: "",
  name: "",
  redirect_uris: [""],
  scopes: ["profile.read"],
  active: true,
  revision: null,
};

function Failure({ message }: { message: string }) {
  return message ? (
    <div className="notice error" role="alert">
      {message}
    </div>
  ) : null;
}

export function ClientRegistry({ session }: { session: Session }) {
  const resource = useResource<{
    items: Client[];
    scopes: Record<string, string>;
  }>("/clients");
  const [draft, setDraft] = useState<Client | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(
    () => () => {
      setDraft(null);
      setConfirm(false);
    },
    [],
  );
  useEffect(() => {
    if (!resource.data && resource.error) setDraft(null);
  }, [resource.data, resource.error]);
  async function save() {
    if (
      !draft ||
      busy ||
      !draft.scopes.length ||
      !form.current?.reportValidity()
    )
      return;
    setBusy(true);
    setError("");
    try {
      const { client_id, ...body } = draft;
      await api(
        `/clients/${encodeURIComponent(client_id)}`,
        { method: "PUT", body: JSON.stringify(body) },
        session.csrf,
      );
      setDraft(null);
      setConfirm(false);
      resource.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      if (e instanceof ApiError && [401, 403].includes(e.status)) {
        setDraft(null);
        setConfirm(false);
        resource.reload();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>客户端</h1>
        <button
          className="button primary"
          onClick={() => {
            setDraft({ ...empty });
            setError("");
          }}
        >
          登记客户端
        </button>
      </div>
      <Failure message={resource.error || (!draft ? error : "")} />
      {resource.error && (
        <button className="text-button" onClick={resource.reload}>
          重新读取
        </button>
      )}
      {resource.data && (
        <div className="access-list">
          {resource.data.items.length ? (
            resource.data.items.map((client) => (
              <section className="access-row" key={client.client_id}>
                <div>
                  <h2>{client.name}</h2>
                  <span className="muted">
                    {client.client_id} · {client.active ? "已登记" : "已停用"}
                  </span>
                  <div className="access-scopes">
                    {client.scopes.map((s) => labels[s]).join(" · ")}
                  </div>
                </div>
                <button
                  className="button secondary"
                  onClick={() => {
                    setDraft({ ...client });
                    setError("");
                  }}
                >
                  编辑
                </button>
              </section>
            ))
          ) : (
            <div className="empty">
              <h3>暂无客户端</h3>
            </div>
          )}
        </div>
      )}
      {draft && (
        <Dialog
          title={draft.revision ? "编辑客户端" : "登记客户端"}
          onClose={() => {
            if (!busy) {
              setDraft(null);
              setConfirm(false);
            }
          }}
        >
          <form
            className="dialog-content access-form"
            ref={form}
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.revision) setConfirm(true);
              else void save();
            }}
          >
            <label>
              客户端标识
              <input
                data-dialog-autofocus
                required
                minLength={3}
                maxLength={80}
                pattern="[a-z0-9][a-z0-9._-]{2,79}"
                readOnly={!!draft.revision}
                disabled={busy}
                value={draft.client_id}
                onChange={(e) =>
                  setDraft({ ...draft, client_id: e.target.value })
                }
              />
            </label>
            <label>
              名称
              <input
                required
                maxLength={80}
                disabled={busy}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              回调地址
              <textarea
                required
                rows={3}
                disabled={busy}
                value={draft.redirect_uris.join("\n")}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    redirect_uris: e.target.value.split("\n"),
                  })
                }
              />
            </label>
            <fieldset>
              <legend>允许权限</legend>
              {Object.entries(labels).map(([scope, label]) => (
                <label className="access-check" key={scope}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={draft.scopes.includes(scope)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        scopes: e.target.checked
                          ? [...draft.scopes, scope]
                          : draft.scopes.filter((s) => s !== scope),
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            {draft.revision && (
              <label className="access-check">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={draft.active}
                  onChange={(e) =>
                    setDraft({ ...draft, active: e.target.checked })
                  }
                />
                启用客户端
              </label>
            )}
            <Failure message={error} />
            {confirm && (
              <div className="notice" role="alert">
                保存后，此客户端已有授权将失效。
              </div>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  setDraft(null);
                  setConfirm(false);
                }}
              >
                取消
              </button>
              {confirm ? (
                <button
                  type="button"
                  className="button primary"
                  disabled={busy}
                  onClick={() => void save()}
                >
                  {busy ? "保存中…" : "确认保存"}
                </button>
              ) : (
                <button
                  className="button primary"
                  disabled={busy || !draft.scopes.length}
                >
                  {busy ? "保存中…" : "保存"}
                </button>
              )}
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

export function Authorizations({ session }: { session: Session }) {
  const resource = useResource<{ items: Grant[] }>("/grants", true);
  const [selected, setSelected] = useState<Grant | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => () => setSelected(null), []);
  useEffect(() => {
    if (!resource.data && resource.error) setSelected(null);
  }, [resource.data, resource.error]);
  async function revoke() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(
        `/grants/${selected.id}/revoke`,
        { method: "POST" },
        session.csrf,
      );
      setSelected(null);
      resource.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "撤销失败");
      if (e instanceof ApiError && [401, 403].includes(e.status)) {
        setSelected(null);
        resource.reload();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>授权管理</h1>
        <button className="text-button" onClick={resource.reload}>
          刷新
        </button>
      </div>
      <Failure message={resource.error || error} />
      {resource.data && (
        <div className="access-list">
          {resource.data.items.length ? (
            resource.data.items.map((grant) => (
              <section className="access-row" key={grant.id}>
                <div>
                  <h2>{grant.name}</h2>
                  <span className="muted">
                    {grant.device_name} · {grant.active ? "已授权" : "已失效"}
                  </span>
                  <div className="access-scopes">
                    {grant.scopes.map((s) => labels[s]).join(" · ")}
                  </div>
                  <details>
                    <summary>详情</summary>
                    <dl>
                      <dt>客户端</dt>
                      <dd>{grant.client_id}</dd>
                      <dt>授权时间</dt>
                      <dd>
                        {new Date(grant.created_at).toLocaleString("zh-CN")}
                      </dd>
                      <dt>到期时间</dt>
                      <dd>
                        {new Date(grant.expires_at).toLocaleString("zh-CN")}
                      </dd>
                    </dl>
                  </details>
                </div>
                {grant.active && (
                  <button
                    className="button secondary"
                    onClick={() => setSelected(grant)}
                  >
                    撤销
                  </button>
                )}
              </section>
            ))
          ) : (
            <div className="empty">
              <h3>暂无授权</h3>
            </div>
          )}
        </div>
      )}
      {selected && (
        <Dialog
          title="撤销授权"
          onClose={() => {
            if (!busy) setSelected(null);
          }}
        >
          <div className="dialog-content">
            <p>
              {selected.name} · {selected.device_name}
            </p>
            <Failure message={error} />
            <div className="dialog-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                取消
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void revoke()}
              >
                {busy ? "撤销中…" : "确认撤销"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

export function AuthorizePage({
  session,
  query,
}: {
  session: Session;
  query: string;
}) {
  const params = new URLSearchParams(query);
  const keys = [
    "client_id",
    "redirect_uri",
    "scope",
    "state",
    "code_challenge",
    "code_challenge_method",
  ];
  const search = new URLSearchParams(keys.map((k) => [k, params.get(k) || ""]));
  const context = useResource<{
    name: string;
    redirect_uri: string;
    scopes: Record<string, string>;
  }>("/connect/authorize?" + search.toString());
  const [scopes, setScopes] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const requestId = useRef(newRequestId());
  useEffect(() => {
    setScopes(Object.keys(context.data?.scopes || {}));
    setError("");
    requestId.current = newRequestId();
  }, [query, context.data]);
  async function respond(approve: boolean) {
    if (!context.data || busy) return;
    setBusy(true);
    setError("");
    try {
      const values = Object.fromEntries(search);
      delete values.scope;
      const result = await api<{ redirect_uri: string }>(
        "/connect/authorize",
        {
          method: "POST",
          body: JSON.stringify({
            ...values,
            request_id: requestId.current,
            scopes: approve ? scopes : Object.keys(context.data.scopes),
            device_name: params.get("device_name") || "客户端",
            approve,
          }),
        },
        session.csrf,
      );
      window.location.assign(result.redirect_uri);
    } catch (e) {
      setError(e instanceof Error ? e.message : "授权失败");
      setBusy(false);
    }
  }
  return (
    <div className="connection-page">
      <div className="page-heading">
        <h1>客户端授权</h1>
      </div>
      <Failure message={context.error || error} />
      {context.data && (
        <section className="card padded access-form">
          <h2>{context.data.name}</h2>
          <div className="access-callback">{context.data.redirect_uri}</div>
          <fieldset>
            <legend>允许权限</legend>
            {Object.entries(context.data.scopes).map(([scope, label]) => (
              <label className="access-check" key={scope}>
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  disabled={busy}
                  onChange={(e) =>
                    setScopes((old) =>
                      e.target.checked
                        ? [...old, scope]
                        : old.filter((s) => s !== scope),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="dialog-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void respond(false)}
            >
              拒绝
            </button>
            <button
              className="button primary"
              disabled={busy || !scopes.length}
              onClick={() => void respond(true)}
            >
              {busy ? "处理中…" : "允许"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
