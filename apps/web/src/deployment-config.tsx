import {
  useDeploymentVerification,
  requiresDeploymentVerification,
} from "./deployment-verification";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, base, type Session } from "./api";
import { PasswordField } from "./password-fields";
import { requestId } from "./request-id";
import { useDeploymentInvalidation, useResource } from "./hooks";

export type DeploymentConfig = {
  repository: string;
  revision: string | null;
  hasToken: boolean;
  githubAccount: string;
  oauthAvailable: boolean;
};
type SavePayload = {
  request_id: string;
  revision: string | null;
  repository: string;
  token: string;
};

export function useDeploymentConfig() {
  return useResource<DeploymentConfig>("/deployment/config");
}
export function startGithubAuthorization(
  config: DeploymentConfig | null,
  onError: (message: string) => void,
) {
  if (!config?.oauthAvailable) {
    onError("服务端尚未配置 GitHub OAuth App");
    return;
  }
  window.open(
    base + "/deployment/github/start",
    "_blank",
    "noopener,noreferrer",
  );
}
export function DeploymentConfigForm({
  session,
  onClose,
}: {
  session: Session;
  onClose: () => void;
}) {
  const verification = useDeploymentVerification(session, () => {
    setToken("");
    setRepository("");
    invalidate();
    onClose();
  });
  const config = useDeploymentConfig(),
    invalidate = useDeploymentInvalidation();
  const [repository, setRepository] = useState(""),
    [token, setToken] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const initial = useRef(false),
    pending = useRef<string | null>(null);
  useEffect(() => {
    if (config.data && !initial.current) {
      setRepository(config.data.repository);
      initial.current = true;
    }
  }, [config.data]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current = null;
    };
  }, []);
  function withdraw(error: unknown) {
    if (
      error instanceof ApiError &&
      [401, 403].includes(error.status) &&
      !requiresDeploymentVerification(error)
    ) {
      setToken("");
      setRepository("");
      onClose();
    }
  }
  async function save(payload?: SavePayload) {
    if (busy || !config.data) return;
    const checking = !payload && !!pending.current;
    const snapshot =
      payload ||
      (checking
        ? null
        : {
            request_id: requestId(),
            revision: config.data.revision,
            repository: repository.trim(),
            token,
          });
    if (snapshot) pending.current = snapshot.request_id;
    setBusy(true);
    setError("");
    try {
      await api<DeploymentConfig>(
        checking
          ? `/deployment/config/receipts/${pending.current}`
          : "/deployment/config",
        checking ? {} : { method: "PUT", body: JSON.stringify(snapshot) },
        session.csrf,
      );
      if (!alive.current) return;
      pending.current = null;
      setToken("");
      invalidate();
      onClose();
    } catch (e) {
      if (!alive.current) return;
      if (requiresDeploymentVerification(e) && snapshot) {
        pending.current = null;
        verification.request(() => save(snapshot));
      } else {
        setError(e instanceof Error ? e.message : "保存失败");
        if (
          e instanceof ApiError &&
          e.status >= 400 &&
          e.status < 500 &&
          e.status !== 404
        )
          pending.current = null;
        withdraw(e);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function disconnect(revision = config.data?.revision) {
    if (!revision || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(
        "/deployment/config",
        {
          method: "DELETE",
          body: JSON.stringify({ revision }),
        },
        session.csrf,
      );
      if (alive.current) invalidate();
    } catch (e) {
      if (!alive.current) return;
      if (requiresDeploymentVerification(e))
        verification.request(() => disconnect(revision));
      else {
        setError(e instanceof Error ? e.message : "撤销失败");
        withdraw(e);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <>
      <section className="deploy-card deploy-config">
        <h2>GitHub 发布配置</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="deploy-config-fields">
            <label>
              仓库（账号/仓库名）
              <input
                aria-label="仓库（账号/仓库名）"
                value={repository}
                onChange={(e) => setRepository(e.target.value)}
                placeholder="owner/repository"
                autoComplete="off"
                disabled={busy || !!pending.current || verification.required}
              />
            </label>
            <label htmlFor="deploy-token">
              发布 Token{config.data?.hasToken ? "（已配置，留空保持）" : ""}
              <PasswordField
                id="deploy-token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Actions: Read and write"
                autoComplete="new-password"
                disabled={busy || !!pending.current || verification.required}
              />
            </label>
          </div>
          <div className="deploy-config-auth">
            <button
              type="button"
              className="deploy-auth-button"
              disabled={busy}
              onClick={() => startGithubAuthorization(config.data, setError)}
            >
              {config.data?.githubAccount
                ? `已授权：${config.data.githubAccount}`
                : "使用 GitHub 授权"}
            </button>
            {config.data?.githubAccount && (
              <button
                type="button"
                className="deploy-disconnect"
                disabled={busy}
                onClick={() => void disconnect()}
              >
                撤销授权
              </button>
            )}
          </div>
          {(error || config.error) && (
            <p role="alert" className="deploy-config-error">
              {error || config.error}
            </p>
          )}
          <div className="deploy-config-actions">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setToken("");
                onClose();
              }}
            >
              取消
            </button>
            <button
              type="submit"
              className="deploy-save"
              disabled={busy || !config.data || verification.required}
            >
              {pending.current ? "核对保存回执" : "保存配置"}
            </button>
          </div>
        </form>
      </section>
      {verification.dialog}
    </>
  );
}
