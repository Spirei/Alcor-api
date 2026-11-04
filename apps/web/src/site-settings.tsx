import { MarketBadgeSettings } from "./market-badge-settings";
import { SiteNavigationSettings } from "./site-navigation-settings";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { PasswordField } from "./password-fields";
import { requestId } from "./request-id";
import { SelectMenu } from "./select-menu";
import { PrivateServiceSettings } from "./private-service-settings";
import { SiteServiceStatus } from "./site-service-status";

type Config = {
  title: string;
  domain: string;
  logoText: string;
  logoFont: string;
  footerDesc: string;
  ico: string | null;
  pwaIcon: string | null;
  homepageBg: string | null;
  loginSideImage: string | null;
  siteLogo: string | null;
  homeNav: unknown[];
  mobileNavigationOrder: string[];
  marketBadges: Record<string, unknown>;
  marketBadgesVisible: boolean;
  allowRegister: boolean;
};
type Head = {
  revision: number;
  settings: Config;
  public: Omit<Config, "pwaIcon"> & { emailRegistration: boolean };
};
type Receipt = {
  requestId: string;
  state: "completed" | "closed";
  revision?: number;
  settings?: Config;
  executed?: boolean;
};
type Asset = {
  id: string;
  kind: string;
  public_path: string;
  served_sha256: string;
};
const root = "/admin/site-settings";
const assetFields = [
  ["ico", "图标", "ico"],
  ["pwaIcon", "桌面图标", "ico"],
  ["siteLogo", "标志", "logo"],
  ["homepageBg", "首页背景", "background"],
  ["loginSideImage", "登录配图", "login"],
] as const;
export function SiteSettings({
  session,
  active = true,
  expanded = false,
}: {
  session: Session;
  active?: boolean;
  expanded?: boolean;
}) {
  if (session.user.role !== "admin") return null;
  return (
    <SiteSettingsContent
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
function SiteSettingsContent({
  session,
  active,
  expanded,
}: {
  session: Session;
  active: boolean;
  expanded: boolean;
}) {
  const [opened, setOpened] = useState(expanded),
    [head, setHead] = useState<Head | null>(null),
    [draft, setDraft] = useState<Config | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]),
    [password, setPassword] = useState(""),
    [code, setCode] = useState("");
  const [nav, setNav] = useState("[]"),
    [badges, setBadges] = useState("{}"),
    [busy, setBusy] = useState(false),
    [locked, setLocked] = useState(false),
    [message, setMessage] = useState("");
  const [pending, setPending] = useState("");
  const scope = JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  const storage = "alcor.site-settings.pending:" + scope;
  const dirty = useRef(false);
  const [stale, setStale] = useState(false);
  const live = useRef(false),
    generation = useRef(0),
    controller = useRef<AbortController | null>(null),
    requestSequence = useRef(0);
  const [visible, setVisible] = useState(!document.hidden);
  const displayed = () => apiSessionSnapshot().csrf === session.csrf;
  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    live.current = opened && active && visible && !locked && displayed();
    ++generation.current;
    if (!live.current) {
      controller.current?.abort();
      setPassword("");
      setCode("");
      setBusy(false);
    }
    return () => {
      live.current = false;
      ++generation.current;
      controller.current?.abort();
    };
  }, [opened, active, visible, locked, session.csrf]);
  useEffect(() => {
    try {
      setPending(sessionStorage.getItem(storage) || "");
    } catch {
      /* Pending UUID remains in component memory. */
    }
  }, [storage]);
  function remember(value: string) {
    try {
      if (value) sessionStorage.setItem(storage, value);
      else sessionStorage.removeItem(storage);
    } catch {
      if (value) {
        setMessage("无法保存原请求编号，请核对浏览器存储");
        return false;
      }
    }
    setPending(value);
    return true;
  }
  function updateDraft(value: Config) {
    dirty.current = true;
    setDraft(value);
    setMessage("");
  }
  function accept(value: Head) {
    dirty.current = false;
    setStale(false);
    setHead(value);
    setDraft(value.settings);
    setNav(JSON.stringify(value.settings.homeNav, null, 2));
    setBadges(JSON.stringify(value.settings.marketBadges, null, 2));
  }
  function fail(error: unknown) {
    const proof =
      error instanceof ApiError &&
      error.status === 403 &&
      ["当前密码不正确", "二次验证码或备用码不正确"].includes(error.message);
    if (
      error instanceof ApiError &&
      (error.status === 401 || (error.status === 403 && !proof))
    ) {
      setLocked(true);
      setHead(null);
      setDraft(null);
      setAssets([]);
      setNav("[]");
      setBadges("{}");
      setPassword("");
      setCode("");
      remember("");
    }
    setMessage(error instanceof Error ? error.message : "读取失败");
  }
  async function read(preserveDraft = false) {
    if (!live.current || busy) return;
    const epoch = generation.current,
      seq = ++requestSequence.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setMessage("");
    try {
      const value = await api<Head>(root, { signal: abort.signal });
      if (
        live.current &&
        displayed() &&
        epoch === generation.current &&
        seq === requestSequence.current
      ) {
        if (preserveDraft && (dirty.current || pending)) {
          if (head && value.revision !== head.revision) {
            setStale(true);
            setMessage("站点配置已变化，请重新读取");
          }
        } else accept(value);
      }
    } catch (error) {
      if (!abort.signal.aborted && live.current && epoch === generation.current)
        fail(error);
    } finally {
      if (
        live.current &&
        epoch === generation.current &&
        seq === requestSequence.current
      )
        setBusy(false);
    }
  }
  useEffect(() => {
    if (opened && active && visible && !locked) void read(!!head);
  }, [opened, active, visible, locked]);
  function current(epoch: number) {
    return live.current && displayed() && epoch === generation.current;
  }
  async function save() {
    if (!live.current || !head || !draft || pending || busy || stale) return;
    let patch: Config;
    try {
      patch = {
        ...draft,
        homeNav: JSON.parse(nav),
        marketBadges: JSON.parse(badges),
      };
    } catch {
      setMessage("导航或市场色块格式无效");
      return;
    }
    const id = requestId(),
      epoch = generation.current;
    if (!remember(id)) return;
    setBusy(true);
    setMessage("");
    try {
      const value = await api<Receipt>(
        root,
        {
          method: "PUT",
          body: JSON.stringify({
            requestId: id,
            expectedRevision: head.revision,
            patch,
            password,
            code,
          }),
        },
        session.csrf,
      );
      if (current(epoch)) {
        remember("");
        if (value.settings && value.revision !== undefined) {
          setHead({
            ...head,
            revision: value.revision,
            settings: value.settings,
          });
          setDraft(value.settings);
        }
        dirty.current = false;
        setStale(false);
        setPassword("");
        setCode("");
        window.dispatchEvent(new Event("alcor:public-site-updated"));
        setMessage("已保存");
      }
    } catch (error) {
      if (current(epoch)) {
        if (
          error instanceof ApiError &&
          [400, 401, 403, 409, 422].includes(error.status)
        )
          remember("");
        fail(error);
      }
    } finally {
      if (current(epoch)) setBusy(false);
    }
  }
  async function resolve(close = false) {
    if (!live.current || !pending || busy) return;
    const epoch = generation.current;
    setBusy(true);
    setMessage("");
    try {
      const value = await api<Receipt>(
        root + "/operations/" + pending + (close ? "/close" : ""),
        close
          ? {
              method: "POST",
              body: JSON.stringify({ expectedKind: "site-settings" }),
            }
          : {},
        session.csrf,
      );
      if (!current(epoch)) return;
      remember("");
      const latest = await api<Head>(root);
      if (!current(epoch)) return;
      if (value.state === "closed" && dirty.current && head) {
        if (latest.revision !== head.revision) {
          setStale(true);
          setMessage("原请求已关闭；当前配置已变化，请重新读取");
        } else setMessage("原请求未执行");
      } else {
        accept(latest);
        setMessage(value.state === "closed" ? "原请求未执行" : "已核对原请求");
      }
    } catch (error) {
      if (current(epoch)) fail(error);
    } finally {
      if (current(epoch)) setBusy(false);
    }
  }
  async function loadAssets() {
    if (!live.current || busy) return;
    const epoch = generation.current;
    setBusy(true);
    setMessage("");
    try {
      const value = await api<{ items: Asset[] }>(root + "/assets");
      if (current(epoch)) setAssets(value.items);
    } catch (error) {
      if (current(epoch)) fail(error);
    } finally {
      if (current(epoch)) setBusy(false);
    }
  }
  const blocked = busy || locked || !active || !visible || !!pending;
  return (
    <details
      open={opened}
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary>站点设置</summary>
      {message && <p role="status">{message}</p>}
      {pending && (
        <div>
          <span>原请求待核对</span>
          <button
            className="button"
            type="button"
            disabled={busy || locked}
            onClick={() => void resolve()}
          >
            查询结果
          </button>
          <button
            className="button"
            type="button"
            disabled={busy || locked}
            onClick={() => void resolve(true)}
          >
            关闭未受理请求
          </button>
        </div>
      )}
      {draft && (
        <form
          className="access-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {(
            [
              ["title", "站点名称"],
              ["logoText", "标志文字"],
              ["domain", "公开域名"],
              ["footerDesc", "页脚文字"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                value={draft[key]}
                disabled={blocked}
                onChange={(event) =>
                  updateDraft({ ...draft, [key]: event.target.value })
                }
              />
            </label>
          ))}
          <label>
            标志字体
            <SelectMenu
              label="标志字体"
              variant="field"
              value={draft.logoFont}
              disabled={blocked}
              options={[
                { value: "system", label: "系统" },
                { value: "diatype", label: "Diatype" },
                { value: "diatype-regular", label: "Diatype Regular" },
              ]}
              onChange={(value) => updateDraft({ ...draft, logoFont: value })}
            />
          </label>
          <button
            className="button"
            type="button"
            disabled={blocked}
            onClick={() => void loadAssets()}
          >
            选择已上传素材
          </button>
          {assetFields.map(([field, label, kind]) => (
            <label key={field}>
              {label}
              <SelectMenu
                label={label}
                variant="field"
                disabled={blocked}
                value={draft[field] || ""}
                options={[
                  { value: "", label: "无" },
                  ...assets
                    .filter((asset) => asset.kind === kind)
                    .map((asset) => ({
                      value: asset.id,
                      label: asset.public_path.split("/").pop() || "素材",
                    })),
                  ...(draft[field] &&
                  !assets.some((asset) => asset.id === draft[field])
                    ? [{ value: draft[field]!, label: "当前素材" }]
                    : []),
                ]}
                onChange={(value) =>
                  updateDraft({ ...draft, [field]: value || null })
                }
              />
            </label>
          ))}
          <label>
            <button
              type="button"
              role="switch"
              className="appearance-switch"
              aria-label="开放注册"
              aria-checked={draft.allowRegister}
              disabled={blocked}
              onClick={() =>
                updateDraft({ ...draft, allowRegister: !draft.allowRegister })
              }
            >
              <span className="appearance-switch-track" aria-hidden="true">
                <span />
              </span>
            </button>
            开放注册
          </label>
          <label>
            <button
              type="button"
              role="switch"
              className="appearance-switch"
              aria-label="显示市场色块"
              aria-checked={draft.marketBadgesVisible}
              disabled={blocked}
              onClick={() =>
                updateDraft({
                  ...draft,
                  marketBadgesVisible: !draft.marketBadgesVisible,
                })
              }
            >
              <span className="appearance-switch-track" aria-hidden="true">
                <span />
              </span>
            </button>
            显示市场色块
          </label>
          <details>
            <summary>高级</summary>
            <label>
              首页导航
              <textarea
                value={nav}
                disabled={blocked}
                onChange={(event) => {
                  setNav(event.target.value);
                  dirty.current = true;
                  setMessage("");
                }}
              />
            </label>
            <label>
              市场色块
              <textarea
                value={badges}
                disabled={blocked}
                onChange={(event) => {
                  setBadges(event.target.value);
                  dirty.current = true;
                  setMessage("");
                }}
              />
            </label>
          </details>
          <MarketBadgeSettings
            value={badges}
            disabled={blocked}
            onChange={(value) => {
              setBadges(value);
              dirty.current = true;
              setMessage("");
            }}
          />
          <SiteNavigationSettings
            value={draft.mobileNavigationOrder ?? []}
            disabled={blocked}
            onChange={(value) => {
              setDraft({ ...draft, mobileNavigationOrder: value });
              dirty.current = true;
              setMessage("");
            }}
          />
          <label>
            当前密码
            <PasswordField
              id="site-settings-password"
              value={password}
              disabled={blocked}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            验证码或备用码
            <input
              value={code}
              disabled={blocked}
              autoComplete="one-time-code"
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <button
            className="button primary"
            type="submit"
            disabled={blocked || stale || !password}
          >
            保存
          </button>
          <button
            className="button"
            type="button"
            disabled={busy || locked || !!pending}
            onClick={() => void read()}
          >
            重新读取
          </button>
        </form>
      )}
      {!locked && (
        <PrivateServiceSettings
          session={session}
          active={active && opened && visible}
        />
      )}
      {!locked && (
        <SiteServiceStatus
          session={session}
          active={active && opened && visible}
        />
      )}
    </details>
  );
}
