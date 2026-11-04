import { MarketBadgeSettings } from "./market-badge-settings";
import { SiteNavigationSettings } from "./site-navigation-settings";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { PasswordField } from "./password-fields";
import { requestId } from "./request-id";
import { SelectMenu } from "./select-menu";
import {
  FormActions,
  SettingGroup,
  SettingRow,
  SettingsSurface,
  ToggleSwitch,
} from "./workspace-forms";
import { RefreshCw, Layers } from "lucide-react";
import { SiteArtworkPicker } from "./site-artwork-picker";
import {
  siteArtworkFields,
  siteArtworkUrl,
  type SiteArtwork,
} from "./site-artwork-state";
import { useSiteArtworkUpload } from "./site-artwork-upload";
import { HomeNavigationSettings } from "./home-navigation-settings";
import "./site-settings.css";
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
const root = "/admin/site-settings";
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
  const [assets, setAssets] = useState<SiteArtwork[]>([]),
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
  const [assetError, setAssetError] = useState("");
  const [assetRefresh, setAssetRefresh] = useState(0);
  useEffect(() => {
    if (!head || !opened || !active || !visible || locked || !displayed())
      return;
    const epoch = generation.current,
      abort = new AbortController();
    void api<{ items: SiteArtwork[] }>(root + "/assets", {
      signal: abort.signal,
    })
      .then((value) => {
        if (!abort.signal.aborted && current(epoch)) {
          setAssets(value.items);
          setAssetError("");
        }
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted && current(epoch)) {
          setAssetError(
            error instanceof Error ? error.message : "图片读取失败",
          );
          if (error instanceof ApiError && [401, 403].includes(error.status))
            fail(error);
        }
      });
    return () => abort.abort();
  }, [head, opened, active, visible, locked, assetRefresh]);
  const artwork = useSiteArtworkUpload({
    session,
    active: opened && active && visible && !locked && !pending,
    onFailure: fail,
    onUploaded: (field, result) => {
      if (
        !draft ||
        !result.version ||
        !result.kind ||
        !result.legacyUrl ||
        !result.sha256
      )
        return;
      const item = {
        id: result.version,
        kind: result.kind,
        public_path: result.legacyUrl,
        served_sha256: result.sha256,
      };
      setAssets((items) => [
        item,
        ...items.filter((asset) => asset.id !== item.id),
      ]);
      updateDraft({ ...draft, [field]: result.version });
      setMessage("图片已加入草稿，保存站点设置后生效");
    },
  });
  const blocked =
    busy ||
    locked ||
    !active ||
    !visible ||
    !!pending ||
    artwork.busy ||
    !!artwork.pending;
  const image = (field: "siteLogo" | "ico" | "homepageBg") =>
    siteArtworkUrl(assets.find((item) => item.id === draft?.[field]));
  const background = image("homepageBg"),
    logo = image("siteLogo") || image("ico");
  return (
    <SettingsSurface
      title="站点设置"
      expanded={expanded}
      open={opened}
      onOpenChange={setOpened}
    >
      {message && <p role="status">{message}</p>}
      {pending && (
        <div className="site-pending-action" role="status">
          原请求待核对
          <FormActions>
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
          </FormActions>
        </div>
      )}
      {artwork.error && <p role="alert">{artwork.error}</p>}
      {artwork.pending && (
        <div className="site-pending-action" role="status">
          {artwork.busy ? "正在处理图片…" : "原图片操作结果待核对"}
          <FormActions>
            <button
              className="button"
              type="button"
              disabled={artwork.busy || locked}
              onClick={() => void artwork.query()}
            >
              核对图片结果
            </button>
          </FormActions>
        </div>
      )}
      {draft ? (
        <form
          className="site-settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <SettingGroup title="站点信息">
            <SettingRow title="站点名称">
              <input
                aria-label="站点名称"
                value={draft.title}
                maxLength={120}
                disabled={blocked}
                onChange={(event) =>
                  updateDraft({ ...draft, title: event.target.value })
                }
              />
            </SettingRow>
            <SettingRow title="公开域名">
              <input
                aria-label="公开域名"
                value={draft.domain}
                maxLength={120}
                disabled={blocked}
                onChange={(event) =>
                  updateDraft({ ...draft, domain: event.target.value })
                }
              />
            </SettingRow>
            <SettingRow
              title="开放注册"
              description="关闭后仅管理员可以创建账号"
            >
              <ToggleSwitch
                label="开放注册"
                checked={draft.allowRegister}
                disabled={blocked}
                onChange={(allowRegister) =>
                  updateDraft({ ...draft, allowRegister })
                }
              />
            </SettingRow>
            <SettingRow title="页脚简介">
              <input
                aria-label="页脚简介"
                value={draft.footerDesc}
                maxLength={500}
                disabled={blocked}
                onChange={(event) =>
                  updateDraft({ ...draft, footerDesc: event.target.value })
                }
              />
            </SettingRow>
          </SettingGroup>
          <section className="site-settings-section" aria-label="网站形象">
            <div className="site-settings-heading">
              <h3>网站形象</h3>
              <button
                type="button"
                className="icon-button"
                aria-label="重新读取站点图片"
                disabled={blocked}
                onClick={() => setAssetRefresh((value) => value + 1)}
              >
                <RefreshCw size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="site-brand-preview" aria-label="站点形象预览">
              <div className="site-brand-browser">
                <i />
                <i />
                <i />
                <span>{draft.title || "Alcor"}</span>
              </div>
              <div
                className={
                  "site-brand-content" + (background ? " has-background" : "")
                }
                style={
                  background
                    ? {
                        backgroundImage: `linear-gradient(135deg,#101820bb,#10182055),url("${background}")`,
                      }
                    : undefined
                }
              >
                {logo ? (
                  <img src={logo} alt="" />
                ) : (
                  <Layers size={36} aria-hidden="true" />
                )}
                <strong>{draft.logoText || draft.title || "Alcor"}</strong>
              </div>
            </div>
            <SettingGroup>
              <SettingRow title="标志文字">
                <input
                  aria-label="标志文字"
                  value={draft.logoText}
                  maxLength={120}
                  disabled={blocked}
                  onChange={(event) =>
                    updateDraft({ ...draft, logoText: event.target.value })
                  }
                />
              </SettingRow>
              <SettingRow title="标志字体">
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
                  onChange={(logoFont) => updateDraft({ ...draft, logoFont })}
                />
              </SettingRow>
            </SettingGroup>
            {assetError && <p role="alert">{assetError}</p>}
            <div className="site-artwork-list">
              {siteArtworkFields.map((item) => (
                <SiteArtworkPicker
                  key={item.field}
                  {...item}
                  value={draft[item.field]}
                  assets={assets}
                  disabled={blocked || !artwork.ready}
                  onChange={(value) =>
                    updateDraft({ ...draft, [item.field]: value })
                  }
                  onUpload={(file) => void artwork.upload(item.field, file)}
                />
              ))}
            </div>
            <p className="site-empty-note">
              点击图片更换，保存站点设置后生效；原图片会保留。
            </p>
          </section>
          <HomeNavigationSettings
            value={nav}
            disabled={blocked}
            onChange={(value) => {
              setNav(value);
              dirty.current = true;
              setMessage("");
            }}
          />
          <SiteNavigationSettings
            expanded
            value={draft.mobileNavigationOrder ?? []}
            disabled={blocked}
            onChange={(value) =>
              updateDraft({ ...draft, mobileNavigationOrder: value })
            }
          />
          <section className="site-settings-section" aria-label="市场色块">
            <SettingGroup title="市场色块">
              <SettingRow title="显示市场色块">
                <ToggleSwitch
                  label="显示市场色块"
                  checked={draft.marketBadgesVisible}
                  disabled={blocked}
                  onChange={(marketBadgesVisible) =>
                    updateDraft({ ...draft, marketBadgesVisible })
                  }
                />
              </SettingRow>
            </SettingGroup>
            <MarketBadgeSettings
              expanded
              value={badges}
              disabled={blocked}
              onChange={(value) => {
                setBadges(value);
                dirty.current = true;
                setMessage("");
              }}
            />
          </section>
          <details className="site-settings-advanced">
            <summary>高级资料</summary>
            <div className="workspace-form-grid">
              <label className="workspace-form-field">
                <span>首页导航原配置</span>
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
              <label className="workspace-form-field">
                <span>市场色块原配置</span>
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
            </div>
            {!locked && (
              <SiteServiceStatus
                session={session}
                active={active && opened && visible}
              />
            )}
          </details>
          <section className="site-settings-security" aria-label="确认站点设置">
            <p>站点设置会影响所有访客，保存时验证当前管理员身份。</p>
            <div className="workspace-form-grid">
              <label className="workspace-form-field">
                <span>当前密码</span>
                <PasswordField
                  id="site-settings-password"
                  value={password}
                  disabled={blocked}
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
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
            <FormActions>
              <button
                className="button"
                type="button"
                disabled={blocked || dirty.current}
                onClick={() => void read()}
              >
                重新读取
              </button>
              {dirty.current && (
                <button
                  type="button"
                  className="button"
                  disabled={blocked || !head}
                  onClick={() => {
                    if (head) accept(head);
                    setPassword("");
                    setCode("");
                    setMessage("");
                  }}
                >
                  放弃修改
                </button>
              )}
              <button
                className="button primary"
                type="submit"
                disabled={blocked || stale || !password || !dirty.current}
              >
                保存站点设置
              </button>
            </FormActions>
          </section>
        </form>
      ) : (
        !locked && !message && <p role="status">正在读取站点设置…</p>
      )}
    </SettingsSurface>
  );
}
