const SyncStatusPage = lazy(() =>
  import("./sync-status").then((module) => ({
    default: module.SyncStatusPage,
  })),
);
import { WorkspaceTabs, WorkspaceView } from "./workspace-ui";
const SystemOperationsPanel = lazy(() =>
  import("./system-operations").then((module) => ({
    default: module.SystemOperationsPanel,
  })),
);
const AgentRuntimeControls = lazy(() =>
  import("./agent-runtime").then((module) => ({
    default: module.AgentRuntimeControls,
  })),
);
import {
  FinancialDisplayProvider,
  AmountVisibilityControl,
} from "./financial-display";
import { mobileNavigation } from "./site-navigation";
import { WorkspaceNavigation } from "./workspace-navigation";
import { WorkspaceRoutes } from "./workspace-routes";
import "./workspace-ui.css";
import {
  PublicSiteProvider,
  PublicHomeNav,
  usePublicSite,
  registerSiteWorker,
} from "./public-site";
import { legacySitePath, loginDestination } from "./site-paths";
const MarketAssetDetails = lazy(() =>
  import("./market-asset-details").then((module) => ({
    default: module.MarketAssetDetails,
  })),
);
import { PersonalFontsProvider } from "./personal-font-runtime";
import { useVisitedViews } from "./visited-views";
import { clearFontRequests } from "./personal-font-state";
import { clearAttachmentImportRequests } from "./attachment-import-state";
import { clearIconRequests } from "./watch-group-icon-state";
import { clearGroupRequests } from "./watch-groups-state";
import { clearSharedAssetRequests } from "./shared-assets-state";
import { clearFireRequests } from "./fire-state";
import { clearAttachmentRequests } from "./admin-attachments-state";
import { clearResourceImportRequests } from "./resource-import-state";
import { clearLegacyImportRequests } from "./legacy-import-state";
import { clearPreferenceDrafts } from "./preference-draft";
import { apiSessionSnapshot, bindApiSession } from "./api-session";
import { AvatarStatusProvider } from "./avatar-status";
import { clearSourceRequests } from "./watch-group-source-state";
import { PasswordRecoveryBoundary } from "./password-recovery";
import { EmailVerificationBoundary } from "./email-verification";
import { clearOperationJournal } from "./operation-journal";
import { clearReferenceRequests } from "./reference-state";
import { clearResourceRequests } from "./resource-state";
import { clearPersonalProfileRequests } from "./personal-profile-state";
import { requestId as newRequestId } from "./request-id";
import React, {
  Activity as ViewActivity,
  Component,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import type { ReactNode } from "react";
const SimpleApp = lazy(() =>
  import("./simple-app").then((module) => ({ default: module.SimpleApp })),
);
const CelebsPage = lazy(() =>
  import("./celebs").then((module) => ({ default: module.CelebsPage })),
);
const FeedPage = lazy(() =>
  import("./feed").then((module) => ({ default: module.FeedPage })),
);
const WatchGroupsPage = lazy(() =>
  import("./watch-groups").then((module) => ({
    default: module.WatchGroupsPage,
  })),
);
const PortfolioPage = lazy(() =>
  import("./portfolio").then((module) => ({ default: module.PortfolioPage })),
);
const MigrationPage = lazy(() =>
  import("./migration").then((module) => ({ default: module.MigrationPage })),
);
const ActivityPage = lazy(() =>
  import("./audit-activity").then((module) => ({
    default: module.ActivityPage,
  })),
);
const LegacyImportPage = lazy(() =>
  import("./legacy-import").then((module) => ({
    default: module.LegacyImportPage,
  })),
);
const FirePage = lazy(() =>
  import("./fire").then((module) => ({ default: module.FirePage })),
);
const SharedAssetsPage = lazy(() =>
  import("./shared-assets").then((module) => ({
    default: module.SharedAssetsPage,
  })),
);
const AdminAttachmentsPage = lazy(() =>
  import("./admin-attachments").then((module) => ({
    default: module.AdminAttachmentsPage,
  })),
);
const ResourcesPage = lazy(() =>
  import("./resources").then((module) => ({ default: module.ResourcesPage })),
);
const FinancialReportsPage = lazy(() =>
  import("./financial-reports").then((module) => ({
    default: module.FinancialReportsPage,
  })),
);
const CardCatalogPage = lazy(() =>
  import("./card-catalog").then((module) => ({
    default: module.CardCatalogPage,
  })),
);
const FeesPage = lazy(() =>
  import("./fees").then((module) => ({ default: module.FeesPage })),
);
const ReferencePage = lazy(() =>
  import("./reference").then((module) => ({ default: module.ReferencePage })),
);
const MarketHistoryPage = lazy(() =>
  import("./market-history").then((module) => ({
    default: module.MarketHistoryPage,
  })),
);
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Route,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  Boxes,
  CircleCheck,
  CircleX,
  ClipboardList,
  CalendarDays,
  Database,
  FileCheck2,
  Layers3,
  LayoutDashboard,
  PanelLeft,
  Palette,
  Network,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Zap,
  WalletCards,
  Flame,
  ListFilter,
  Images,
  Newspaper,
  UserRoundSearch,
  ReceiptText,
  BookOpen,
  FolderOpen,
  CreditCard,
  ChartNoAxesCombined,
  Paperclip,
  FileText,
  Import,
  ArchiveRestore,
  UsersRound,
} from "lucide-react";
import { api, ApiError } from "./api";
import type {
  MigrationSummary,
  Overview,
  Session,
  Task,
  TaskDetail as TaskDetailType,
  TaskList,
} from "./api";
import { ResourceProvider, useResource, useTaskInvalidation } from "./hooks";
import { VersionHistory } from "./version-history";
const BackupsPage = lazy(() =>
  import("./backups").then((module) => ({ default: module.BackupsPage })),
);
import { AccountPreferencesProvider } from "./account-preferences";
const AccountClosureSettings = lazy(() =>
  import("./account-removal").then((module) => ({
    default: module.AccountClosureSettings,
  })),
);
import {
  AccountClosureBoundary,
  AccountClosureRecoveryLink,
} from "./self-account-closure";
import {
  EmailRegistrationBoundary,
  EmailRegistrationLink,
} from "./email-registration";
const AccountPage = lazy(() =>
  import("./accounts").then((module) => ({ default: module.AccountPage })),
);
const UsersPage = lazy(() =>
  import("./accounts").then((module) => ({ default: module.UsersPage })),
);
import { AuthorizePage } from "./client-access";
import { NativeAppAuthorize } from "./native-app-authorize";
import { NativePasskeyLogin } from "./native-passkey-login";
import { PasswordField, PasswordStrength } from "./password-fields";
import { Dialog } from "./dialog";
import { ProfilePage } from "./profile";
import { AccountMenu } from "./account-menu";
import { SelectMenu } from "./select-menu";
import { ServiceIllustration } from "./service-illustration";
const DeploymentSettings = lazy(() =>
  import("./deployment").then((module) => ({
    default: module.DeploymentSettings,
  })),
);
const ConnectionSettingsForm = lazy(() =>
  import("./connection-settings").then((module) => ({
    default: module.ConnectionSettingsForm,
  })),
);
const ApiReferenceSettings = lazy(() =>
  import("./api-reference-settings").then((module) => ({
    default: module.ApiReferenceSettings,
  })),
);
const MailTemplateSettings = lazy(() =>
  import("./mail-template-settings").then((module) => ({
    default: module.MailTemplateSettings,
  })),
);
const PrivateServiceSettings = lazy(() =>
  import("./private-service-settings").then((module) => ({
    default: module.PrivateServiceSettings,
  })),
);
import { servicePresentation } from "./connection-view";
import type { Profile } from "./api";
import "./styles.css";
import "./appearance-runtime.css";
import "./interaction.css";
import "./workspace-forms.css";
import "./page-layout.css";
const AppearancePage = lazy(() =>
  import("./appearance").then((module) => ({ default: module.AppearancePage })),
);
import { useAppearance } from "./use-appearance";
import type { AppearanceController } from "./use-appearance";
import {
  beginNavigation,
  useNavigationCommit,
  usePanelReady,
  TransitionQA,
} from "./transition-qa";

const statusLabels: Record<string, string> = {
  queued: "等待执行",
  running: "执行中",
  cancel_requested: "取消待确认",
  cancelled: "已取消",
  succeeded: "已完成",
  failed: "失败",
};
const taskNames: Record<string, string> = {
  "system.diagnostics": "系统连接检查",
  "backup.create": "创建备份",
  "backup.verify": "校验备份",
  "backup.restore": "恢复备份",
};
const phaseLabels: Record<string, string> = {
  ...statusLabels,
  checking_database: "核对内部数据库连接",
  checking_cache: "检查内部缓存连接",
  recording_receipt: "保存检查结果与回执",
  backup_snapshot: "生成一致快照",
  backup_encrypt: "加密并校验备份",
  backup_restore: "恢复隔离目标",
  backup_verify_restored: "核对恢复数据与安全状态",
};
const envLabels: Record<string, string> = {
  local: "本地开发",
  test: "隔离测试",
  staging: "预发布",
  production: "生产环境",
};
const navigation = [
  { path: "/sync", name: "同步", icon: RefreshCw, hint: "账户变更与数据核对" },
  {
    path: "/celebs",
    name: "名人持仓",
    icon: UserRoundSearch,
    hint: "公开人物披露与来源观察",
  },
  {
    path: "/feed",
    name: "动态",
    icon: Newspaper,
    hint: "本人订阅、文章与帖子讨论",
  },
  {
    path: "/watch-groups",
    name: "自选分组",
    icon: ListFilter,
    hint: "本人分组与记录归属",
  },
  {
    path: "/shared-assets",
    name: "素材库",
    icon: Images,
    hint: "管理员共享图片与原件",
  },
  {
    path: "/activity",
    name: "活动",
    icon: Activity,
    hint: "本人活动与系统审计",
  },
  {
    path: "/fire",
    name: "FIRE 规划",
    icon: Flame,
    hint: "本人手填规划与资产观察",
  },
  {
    path: "/attachments",
    name: "共享附件",
    icon: Paperclip,
    hint: "管理员共享文件与目录",
  },
  {
    path: "/financial-reports",
    name: "财报文件",
    icon: FileText,
    hint: "管理员财报原件与上传回执",
  },
  {
    path: "/legacy-import",
    name: "旧数据导入",
    icon: Import,
    hint: "本人来源授权与原始快照",
  },
  {
    path: "/simple",
    name: "独立记账",
    icon: BookOpen,
    hint: "家庭资产、现金流与投资登记",
  },
  {
    path: "/resources",
    name: "资源库",
    icon: FolderOpen,
    hint: "本人文件与目录",
  },
  {
    path: "/cards",
    name: "卡面",
    icon: CreditCard,
    hint: "卡面目录与本人偏好",
  },
  {
    path: "/market",
    name: "行情",
    icon: ChartNoAxesCombined,
    hint: "行情来源与历史数据",
  },
  {
    path: "/fees",
    name: "费用",
    icon: ReceiptText,
    hint: "个人费率与历史费用核对",
  },
  {
    path: "/reference",
    name: "汇率与日历",
    icon: CalendarDays,
    hint: "报价来源与交易安排",
  },
  {
    path: "/portfolio",
    name: "资产记录",
    icon: WalletCards,
    hint: "持仓、自选与券商账户",
  },
  {
    path: "/",
    name: "系统总览",
    icon: LayoutDashboard,
    hint: "连接状态与运行概况",
  },
  {
    path: "/tasks",
    name: "后台任务",
    icon: ClipboardList,
    hint: "执行进度与操作回执",
  },
  {
    path: "/migration",
    name: "迁移进度",
    icon: FileCheck2,
    hint: "旧 Web 全部功能清单",
  },
  {
    path: "/backups",
    name: "备份恢复",
    icon: ArchiveRestore,
    hint: "创建、校验与隔离恢复",
  },
  {
    path: "/users",
    name: "用户管理",
    icon: UsersRound,
    hint: "账号状态与角色",
  },
  {
    path: "/account",
    name: "账号与安全",
    icon: ShieldCheck,
    hint: "本人账号与密码",
  },
  {
    path: "/settings",
    name: "系统设置",
    icon: Settings2,
    hint: "账号、环境与架构",
  },
];
const appearanceNavigation = {
  path: "/appearance",
  name: "外观",
  icon: Palette,
  hint: "模式、颜色与字体",
};
const servicePages = [
  {
    id: "postgresql",
    label: "PostgreSQL",
    icon: Database,
    title: "连接你的 PostgreSQL",
    action: "管理连接",
  },
  {
    id: "redis",
    label: "Redis",
    icon: Zap,
    title: "连接你的 Redis",
    action: "管理连接",
  },
  {
    id: "worker",
    label: "Worker",
    icon: Boxes,
    title: "管理你的后台任务",
    action: "管理任务",
  },
];
const modulePaths = [
  ...navigation.map((n) => n.path),
  ...servicePages.map((s) => "/connections/" + s.id),
  "/profile",
  "/appearance",
  "/clients",
  "/authorizations",
  "/authorize",
  "/app/authorize",
];
const memberPaths = [
  "/sync",
  "/shared-assets",
  "/celebs",
  "/feed",
  "/market",
  "/cards",
  "/watch-groups",
  "/activity",
  "/fire",
  "/legacy-import",
  "/simple",
  "/resources",
  "/fees",
  "/reference",
  "/portfolio",
  "/profile",
  "/settings",
  "/appearance",
  "/authorize",
  "/account",
  "/app/authorize",
];
function ServiceState({
  service,
  historical = false,
}: {
  service: Overview["services"][number];
  historical?: boolean;
}) {
  const presentation = servicePresentation(service);
  return (
    <span className={"connection " + presentation.state}>
      <span className="status-dot" />
      <span>
        {historical ? "上次：" : ""}
        {presentation.label}
      </span>
    </span>
  );
}
function time(value?: string | null) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(new Date(value))
    : "尚无记录";
}
function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      <span className="status-dot" />
      {statusLabels[status] || status}
    </span>
  );
}
function ErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return message ? (
    <div className="notice error" role="alert">
      <CircleX size={18} />
      <span>{message}</span>
      {onRetry && (
        <button className="text-button" onClick={onRetry}>
          重新读取
        </button>
      )}
    </div>
  ) : null;
}
function Empty({
  title,
  description,
  icon: Icon = ClipboardList,
}: {
  title: string;
  description?: string;
  icon?: typeof ClipboardList;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={24} />
      </span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
    </div>
  );
}
function Loading() {
  return (
    <div className="loading" role="status">
      <RefreshCw size={18} className="spin" />
      正在读取…
    </div>
  );
}
function ReadPending({ error }: { error: string }) {
  return error ? null : <Loading />;
}
function Logo() {
  const site = usePublicSite();
  return (
    <div className="brand">
      {site.siteLogo ? (
        <img src={site.siteLogo} alt="" width={23} height={23} />
      ) : (
        <Layers3 size={23} />
      )}
      <strong>{site.logoText}</strong>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const location = useLocation(),
    navigate = useNavigate();
  const register = location.pathname === "/register";
  const publicSite = usePublicSite();
  const [login, setLogin] = useState(""),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [factorCode, setFactorCode] = useState("");
  const [registrationUnknown, setRegistrationUnknown] = useState(false);
  const inFlight = useRef(false);
  const loginGeneration = useRef(0),
    loginRequest = useRef<AbortController | null>(null);
  const [setupToken, setSetupToken] = useState("");
  const registration = useResource<{
    first_user: boolean;
    requires_setup_token: boolean;
  }>("/auth/registration");
  useEffect(() => {
    const invalidate = () => {
      ++loginGeneration.current;
      loginRequest.current?.abort();
      loginRequest.current = null;
      if (inFlight.current && register) setRegistrationUnknown(true);
      inFlight.current = false;
      setPending(false);
      setPassword("");
      setConfirmation("");
      setSetupToken("");
      setChallenge(null);
      setFactorCode("");
    };
    invalidate();
    setRegistrationUnknown(false);
    setPassword("");
    setConfirmation("");
    setChallenge(null);
    setFactorCode("");
    setError("");
    document.title = (register ? "注册" : "登录") + " · " + publicSite.title;
    const hidden = () => {
      if (document.hidden) invalidate();
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      invalidate();
    };
  }, [register, location.pathname, publicSite.title]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current || pending || (register && !registration.data)) return;
    if (register && registrationUnknown) {
      navigate("/login", { replace: true });
      return;
    }
    setError("");
    if (register && !/^[\p{L}\p{N}_.-]{1,80}$/u.test(login.trim())) {
      setError("用户名可用中英文、数字、下划线、点和短横线（1–80 位）");
      return;
    }
    if (register && password !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }
    if (
      register &&
      (password.length < 8 ||
        password.length > 128 ||
        !/[A-Za-z]/.test(password) ||
        !/[0-9]/.test(password))
    ) {
      setError("密码须为 8–128 位，并同时包含字母和数字");
      return;
    }
    inFlight.current = true;
    const mine = ++loginGeneration.current,
      controller = new AbortController();
    loginRequest.current = controller;
    setPending(true);
    try {
      const session = await api<
        Session | { status: "requires_2fa"; challenge_token: string }
      >(
        challenge
          ? "/session/login/totp"
          : register
            ? "/session/register"
            : "/session/login",
        {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify(
            challenge
              ? { challenge_token: challenge, code: factorCode }
              : register
                ? {
                    username: login.trim(),
                    password,
                    ...(registration.data?.requires_setup_token
                      ? { setup_token: setupToken }
                      : {}),
                  }
                : { login, password },
          ),
        },
      );
      if (mine !== loginGeneration.current) return;
      setSetupToken("");
      setPassword("");
      setConfirmation("");
      if ("status" in session) {
        setChallenge(session.challenge_token);
        setFactorCode("");
        return;
      }
      setChallenge(null);
      setFactorCode("");
      navigate(
        loginDestination(location.pathname, location.search, location.hash),
        { replace: true },
      );
      onLogin(session);
    } catch (e) {
      if (mine !== loginGeneration.current) return;
      const unknown =
        register &&
        (!(e instanceof ApiError) || e.status === 0 || e.status >= 500);
      if (unknown) setRegistrationUnknown(true);
      setError(
        unknown
          ? "注册结果尚未确认，请先尝试用相同账号登录。"
          : e instanceof Error
            ? e.message
            : register
              ? "注册失败"
              : "登录失败",
      );
    } finally {
      if (mine === loginGeneration.current) {
        inFlight.current = false;
        loginRequest.current = null;
        setPending(false);
        setSetupToken("");
        setPassword("");
        setConfirmation("");
        setFactorCode("");
      }
    }
  }
  return (
    <div className="login-page">
      <div className="login-shell">
        <Logo />
        <PublicHomeNav />
        <div className="login-card">
          {register && (
            <ErrorNotice
              message={registration.error}
              onRetry={registration.reload}
            />
          )}
          <form onSubmit={submit} aria-label={register ? "注册" : "登录"}>
            {!challenge && (
              <>
                <label htmlFor="login">
                  {register ? "用户名" : "用户名或邮箱"}
                </label>
                <input
                  id="login"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={login}
                  maxLength={register ? 80 : 254}
                  onChange={(e) => setLogin(e.target.value)}
                  required
                  autoFocus
                />
                <label htmlFor="password">密码</label>
                <PasswordField
                  key={register ? "register-password" : "login-password"}
                  id="password"
                  autoComplete={register ? "new-password" : "current-password"}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                {register && password && (
                  <PasswordStrength
                    password={password}
                    username={login.trim()}
                  />
                )}
                {register && (
                  <>
                    <label htmlFor="confirm-password">确认密码</label>
                    <PasswordField
                      id="confirm-password"
                      autoComplete="new-password"
                      maxLength={128}
                      value={confirmation}
                      onChange={(e) => setConfirmation(e.target.value)}
                      required
                    />
                  </>
                )}
              </>
            )}
            {register && registration.data?.requires_setup_token && (
              <>
                <label htmlFor="setup-token">安装令牌</label>
                <PasswordField
                  id="setup-token"
                  autoComplete="off"
                  maxLength={512}
                  value={setupToken}
                  onChange={(event) => setSetupToken(event.target.value)}
                  required
                />
              </>
            )}
            {challenge && (
              <>
                <label htmlFor="factor-code">验证码或备用码</label>
                <input
                  id="factor-code"
                  key={challenge}
                  autoComplete="one-time-code"
                  autoFocus
                  value={factorCode}
                  onChange={(e) => setFactorCode(e.target.value)}
                  maxLength={32}
                  required
                />
              </>
            )}
            <ErrorNotice message={error} />
            <button
              className="button primary full"
              type={register && registrationUnknown ? "button" : "submit"}
              onClick={() => {
                if (register && registrationUnknown)
                  navigate("/login", { replace: true });
              }}
              disabled={
                pending ||
                (!(register && registrationUnknown) &&
                  (challenge
                    ? !factorCode.trim()
                    : !login.trim() ||
                      !password ||
                      (register && (!confirmation || !registration.data))))
              }
            >
              {pending
                ? register
                  ? "正在创建…"
                  : "正在验证…"
                : register && registrationUnknown
                  ? "登录核对注册结果"
                  : register
                    ? "注册并登录"
                    : challenge
                      ? "验证并登录"
                      : "登录平台"}
            </button>
          </form>
          {challenge && (
            <button
              type="button"
              className="text-button"
              disabled={pending}
              onClick={() => {
                setChallenge(null);
                setFactorCode("");
                setPassword("");
                setError("");
              }}
            >
              重新登录
            </button>
          )}
          {!register && (
            <NativePasskeyLogin
              disabled={pending}
              onPending={setPending}
              onError={setError}
              onLogin={(session) => {
                navigate(
                  loginDestination(
                    location.pathname,
                    location.search,
                    location.hash,
                  ),
                  { replace: true },
                );
                onLogin(session);
              }}
            />
          )}
          {!register && (
            <p className="auth-switch">
              <NavLink
                to="/password-reset"
                onClick={(e) => {
                  if (pending) e.preventDefault();
                }}
              >
                找回密码
              </NavLink>
            </p>
          )}
          <p className="auth-switch">
            <NavLink
              to={
                (register ? "/login" : "/register") +
                "?returnTo=" +
                encodeURIComponent(
                  loginDestination(
                    location.pathname,
                    location.search,
                    location.hash,
                  ),
                )
              }
              aria-disabled={pending}
              onClick={(e) => {
                if (pending) e.preventDefault();
              }}
            >
              {register ? "登录" : "注册账号"}
            </NavLink>
          </p>
          {!register && <AccountClosureRecoveryLink />}
          {register && <EmailRegistrationLink />}
        </div>
      </div>
    </div>
  );
}

function ServiceBrand({ kind }: { kind: string }) {
  return (
    <img
      className="service-brand"
      src={"/assets/brands/" + kind + (kind === "redis" ? ".png" : ".svg")}
      alt=""
    />
  );
}

function TaskRows({
  items,
  onOpen,
}: {
  items: Task[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="table-scroll">
      <table className="task-table">
        <thead>
          <tr>
            <th>任务</th>
            <th>状态</th>
            <th>创建时间</th>
            <th>执行次数</th>
          </tr>
        </thead>
        <tbody>
          {items.map((task) => (
            <tr key={task.id}>
              <td>
                <button className="task-link" onClick={() => onOpen(task.id)}>
                  <span className="task-icon">
                    <Activity size={18} aria-hidden="true" />
                  </span>
                  <span>
                    <strong>{taskNames[task.kind] || task.kind}</strong>
                    <small>{task.id.slice(0, 8)}</small>
                  </span>
                </button>
              </td>
              <td>
                <Badge status={task.status} />
              </td>
              <td className="numeric">{time(task.created_at)}</td>
              <td className="numeric">{task.attempts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskDetail({
  id,
  session,
  onClose,
}: {
  id: string;
  session: Session;
  onClose: () => void;
}) {
  const { data, error, reload } = useResource<TaskDetailType>(
    "/tasks/" + id,
    true,
  );
  const invalidate = useTaskInvalidation();
  const [pending, setPending] = useState(false),
    [mutationError, setMutationError] = useState("");
  async function cancel() {
    setPending(true);
    setMutationError("");
    try {
      await api("/tasks/" + id + "/cancel", { method: "POST" }, session.csrf);
      invalidate();
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : "取消失败");
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog title="任务详情" onClose={onClose}>
      <div className="dialog-content">
        <ErrorNotice message={error} onRetry={reload} />
        {!data ? (
          <ReadPending error={error} />
        ) : (
          <>
            <div className="detail-title">
              <span className="large-icon">
                <Activity size={24} />
              </span>
              <div>
                <h3>{taskNames[data.kind] || data.kind}</h3>
                <p className="mono">{data.id}</p>
              </div>
              <Badge status={data.status} />
            </div>
            <dl className="detail-grid">
              <div>
                <dt>创建时间</dt>
                <dd>{time(data.created_at)}</dd>
              </div>
              <div>
                <dt>结束时间</dt>
                <dd>{time(data.finished_at)}</dd>
              </div>
              <div>
                <dt>执行次数</dt>
                <dd>{data.attempts}</dd>
              </div>
              <div>
                <dt>请求编号</dt>
                <dd className="mono">{data.request_id}</dd>
              </div>
            </dl>
            <h3 className="section-label">真实执行记录</h3>
            <ol className="timeline">
              {data.events.map((event) => (
                <li key={event.id}>
                  <span className="timeline-dot" />
                  <div>
                    {phaseLabels[event.phase] || event.phase}
                    <time>{time(event.created_at)}</time>
                  </div>
                </li>
              ))}
            </ol>
            {data.result && (
              <div className="notice">
                <CircleCheck size={18} />
                <span>
                  {data.result.scope === "backup" &&
                  typeof data.result.message === "string"
                    ? data.result.message
                    : data.result.scope === "runtime"
                      ? data.result.healthy
                        ? "内部运行检查通过，回执已保存。"
                        : "内部运行检查完成，存在异常依赖。"
                      : "系统检查已完成，回执已保存。"}
                </span>
              </div>
            )}
            {data.error_code && (
              <div className="notice error">任务未完成：{data.error_code}</div>
            )}
            <ErrorNotice message={mutationError} />
            {["queued", "running", "cancel_requested"].includes(
              data.status,
            ) && (
              <div className="dialog-actions">
                <button
                  className="button secondary"
                  onClick={cancel}
                  disabled={pending || data.status === "cancel_requested"}
                >
                  {data.status === "cancel_requested"
                    ? "正在等待 Worker 确认"
                    : pending
                      ? "正在提交…"
                      : "取消任务"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function useDiagnostic(session: Session, onCreated: (id: string) => void) {
  const invalidate = useTaskInvalidation();
  // This store contains operation IDs only, never credentials or financial authorizations.
  const storageKey = `alcor.pending.diagnostics.v1:${session.instance_id}:${session.user.id}`;
  function restored() {
    try {
      const value = localStorage.getItem(storageKey);
      return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
    } catch {
      return null;
    }
  }
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [uncertain, setUncertain] = useState<string | null>(restored),
    [canRetry, setCanRetry] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    setUncertain(restored());
  }, [storageKey]);
  function remember(id: string) {
    try {
      localStorage.setItem(storageKey, id);
    } catch {
      /* IDs remain visible in memory when browser storage is unavailable. */
    }
    setUncertain(id);
  }
  function forget(id: string) {
    try {
      if (localStorage.getItem(storageKey) === id)
        localStorage.removeItem(storageKey);
    } catch {
      /* No credential is stored here. */
    }
    setUncertain(null);
  }
  async function run(retry = false) {
    if (inFlight.current || (uncertain && !retry)) return;
    const existing = uncertain || restored();
    if (existing && !retry) {
      setUncertain(existing);
      setError("先核对上次请求的回执。");
      return;
    }
    inFlight.current = true;
    setPending(true);
    setError("");
    setCanRetry(false);
    const requestId = existing || newRequestId();
    remember(requestId);
    try {
      const task = await api<Task>(
        "/tasks",
        {
          method: "POST",
          body: JSON.stringify({
            request_id: requestId,
            kind: "system.diagnostics",
          }),
        },
        session.csrf,
      );
      forget(requestId);
      invalidate();
      onCreated(task.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "任务受理状态未知");
      if (
        !existing &&
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 409
      )
        forget(requestId);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  async function check() {
    if (!uncertain || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setCanRetry(false);
    try {
      const task = await api<Task>("/tasks/receipts/" + uncertain);
      forget(uncertain);
      setError("");
      onCreated(task.id);
    } catch (e) {
      setCanRetry(e instanceof ApiError && e.status === 404);
      setError(
        e instanceof ApiError && e.status === 404
          ? "暂未查到回执。可继续核对，或用原编号重试这项只读检查。"
          : e instanceof Error
            ? e.message
            : "核对失败",
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return { pending, error, uncertain, canRetry, run, check };
}
function DiagnosticNotice({
  diagnostic,
}: {
  diagnostic: ReturnType<typeof useDiagnostic>;
}) {
  return (
    <>
      <ErrorNotice message={diagnostic.error} />
      {diagnostic.uncertain && (
        <p className="mono request-id">请求：{diagnostic.uncertain}</p>
      )}
      {diagnostic.canRetry && (
        <button
          className="button secondary"
          disabled={diagnostic.pending}
          onClick={() => void diagnostic.run(true)}
        >
          用原编号重试
        </button>
      )}
    </>
  );
}

function useModuleVisibility(onHide: () => void) {
  const visible = useRef(false),
    hide = useRef(onHide);
  hide.current = onHide;
  useEffect(() => {
    visible.current = true;
    return () => {
      visible.current = false;
      hide.current();
    };
  }, []);
  return visible;
}
function OverviewPage({ session }: { session: Session }) {
  const [workspaceSection, setWorkspaceSection] = useState("overview");

  const pageLocation = useLocation();
  const overview = useResource<Overview>("/system/overview", true),
    recent = useResource<TaskList>("/tasks?limit=4", true),
    migration = useResource<MigrationSummary>("/system/migration?summary=1");
  const [selected, setSelected] = useState<string | null>(null);
  const visible = useModuleVisibility(() => setSelected(null));
  const diagnostic = useDiagnostic(session, (id) => {
    if (visible.current) setSelected(id);
  });
  const navigate = useNavigate();
  usePanelReady("/", Boolean(overview.data && recent.data && migration.data));
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>系统总览</h1>
        </div>
        <button
          className="button primary"
          data-dialog-return
          disabled={diagnostic.pending}
          onClick={() =>
            void (diagnostic.uncertain ? diagnostic.check() : diagnostic.run())
          }
        >
          <Activity size={17} aria-hidden="true" />
          {diagnostic.pending
            ? "正在受理…"
            : diagnostic.uncertain
              ? "核对上次请求"
              : "运行系统检查"}
        </button>
      </div>
      <WorkspaceTabs
        label="系统总览视图"
        value={workspaceSection}
        onChange={setWorkspaceSection}
        items={[
          { value: "overview", label: "运行总览" },
          ...(session.user.role === "admin"
            ? [{ value: "operations", label: "运行控制" }]
            : []),
        ]}
      />

      <DiagnosticNotice diagnostic={diagnostic} />
      <WorkspaceView
        active={workspaceSection === "operations"}
        label="运行控制"
      >
        {session.user.role === "admin" && (
          <AgentRuntimeControls
            session={session}
            active={pageLocation.pathname === "/"}
          />
        )}
        {session.user.role === "admin" && (
          <SystemOperationsPanel
            session={session}
            active={pageLocation.pathname === "/"}
          />
        )}
      </WorkspaceView>
      <WorkspaceView active={workspaceSection === "overview"} label="运行总览">
        <section className="section-block">
          <div className="section-heading">
            <h2 className="section-title">
              <Network size={18} aria-hidden="true" />
              连接状态
            </h2>
            <button
              className="icon-button"
              aria-label="刷新状态"
              onClick={() => {
                overview.reload();
                recent.reload();
              }}
            >
              <RefreshCw size={17} />
            </button>
          </div>
          <ErrorNotice
            message={
              overview.error && overview.data
                ? overview.error + "。以下为上次核对记录。"
                : overview.error
            }
            onRetry={overview.reload}
          />
          {overview.data ? (
            <div className="service-grid">
              {servicePages.map(({ id, label, action }) => {
                const service = overview.data!.services.find(
                  (s) => s.id === id,
                );
                if (!service) return null;
                const path = "/connections/" + id;
                return (
                  <NavLink
                    className={"service-entry service-" + id}
                    key={id}
                    to={path}
                    aria-label={label + "，" + action}
                    onClick={() => beginNavigation(path)}
                  >
                    <ServiceIllustration kind={id} />
                    <h3 className="service-title">
                      <ServiceBrand kind={id} />
                      {label}
                    </h3>
                    <div className="service-entry-bottom">
                      <ServiceState
                        service={service}
                        historical={Boolean(overview.error)}
                      />
                      <span className="service-entry-action">{action}</span>
                    </div>
                  </NavLink>
                );
              })}
            </div>
          ) : (
            <ReadPending error={overview.error} />
          )}
        </section>
        <section className="section-block">
          <div className="section-heading">
            <div>
              <h2 className="section-title">
                <ClipboardList size={18} aria-hidden="true" />
                最近任务
              </h2>
              <p>
                {overview.data
                  ? `等待 ${overview.data.task_counts.queued || 0} · 运行 ${overview.data.task_counts.running || 0} · 完成 ${overview.data.task_counts.succeeded || 0}`
                  : "读取服务端记录"}
              </p>
            </div>
            <button
              className="text-button"
              onClick={() => {
                beginNavigation("/tasks");
                navigate("/tasks");
              }}
            >
              全部任务
            </button>
          </div>
          <ErrorNotice message={recent.error} onRetry={recent.reload} />
          {recent.data ? (
            recent.data.items.length ? (
              <TaskRows items={recent.data.items} onOpen={setSelected} />
            ) : (
              <Empty title="还没有任务" />
            )
          ) : (
            <ReadPending error={recent.error} />
          )}
        </section>
        <section className="section-block migration-overview">
          <div className="section-heading">
            <div>
              <h2 className="section-title">
                <FileCheck2 size={18} aria-hidden="true" />
                旧业务迁移
              </h2>
              <p>
                {migration.data
                  ? `${migration.data.summary.domains} 个业务域 · ${migration.data.summary.method_bindings} 条旧方法`
                  : "正在读取清单"}
              </p>
            </div>
            <button
              className="text-button"
              onClick={() => {
                beginNavigation("/migration");
                navigate("/migration");
              }}
            >
              查看清单
            </button>
          </div>
          <div className="migration-inline">
            <span>
              {migration.data
                ? migration.data.capability_plan
                  ? `${migration.data.capability_plan.summary.implementation_local_verified} / ${migration.data.capability_plan.summary.capabilities}`
                  : "—"
                : "—"}
            </span>
            <span>能力候选已本地验证</span>
          </div>
          <ErrorNotice message={migration.error} onRetry={migration.reload} />
        </section>
      </WorkspaceView>
      {selected && (
        <TaskDetail
          id={selected}
          session={session}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function ConnectionPage({
  session,
  serviceId,
}: {
  session: Session;
  serviceId: string;
}) {
  const overview = useResource<Overview>("/system/overview", true);
  const [selected, setSelected] = useState<string | null>(null);
  const visible = useModuleVisibility(() => setSelected(null));
  const diagnostic = useDiagnostic(session, (id) => {
    if (visible.current) setSelected(id);
  });
  const navigate = useNavigate();
  const info = servicePages.find((s) => s.id === serviceId)!;
  const service = overview.data?.services.find((s) => s.id === serviceId);
  usePanelReady("/connections/" + serviceId, Boolean(service));
  if (serviceId === "postgresql" || serviceId === "redis")
    return (
      <div className="connection-editor-page">
        <div className="page-heading connection-editor-heading">
          <button
            type="button"
            className="icon-button"
            aria-label="返回总览"
            title="返回总览"
            onClick={() => navigate("/")}
          >
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
          <h1 className="service-title service-detail-title">
            <ServiceBrand kind={serviceId} />
            {info.label}
          </h1>
        </div>
        <ConnectionSettingsForm kind={serviceId} session={session} />
      </div>
    );
  return (
    <div className="connection-editor-page worker-detail-page">
      <div className="page-heading connection-editor-heading">
        <button
          className="icon-button"
          aria-label="返回总览"
          title="返回总览"
          onClick={() => {
            beginNavigation("/");
            navigate("/");
          }}
        >
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <h1 className="service-title service-detail-title">
          <ServiceBrand kind={serviceId} />
          {info.label}
        </h1>
        <button
          className="icon-button worker-detail-refresh"
          aria-label="刷新连接状态"
          onClick={overview.reload}
        >
          <RefreshCw size={18} />
        </button>
      </div>
      <section
        className="worker-status-sheet"
        aria-label={info.label + "连接管理"}
      >
        <div className="connection-sheet-heading">
          <h2>{serviceId === "worker" ? "运行状态" : "连接状态"}</h2>
          {service && (
            <ServiceState
              service={service}
              historical={Boolean(overview.error)}
            />
          )}
        </div>
        <ErrorNotice
          message={
            overview.error && service
              ? overview.error + "。以下为上次核对记录。"
              : overview.error
          }
          onRetry={overview.reload}
        />
        {service ? (
          <>
            <div className="connection-detail">
              <span className="detail-icon">
                <ServiceBrand kind={serviceId} />
              </span>
              <div>
                <strong>{service.detail}</strong>
                <p>
                  {serviceId === "worker" ? "最近心跳" : "最近核对"} ·{" "}
                  {time(service.observed_at)}
                </p>
              </div>
            </div>
          </>
        ) : (
          <ReadPending error={overview.error} />
        )}
        <DiagnosticNotice diagnostic={diagnostic} />
        <button
          className="button primary connection-primary"
          data-dialog-return
          disabled={diagnostic.pending}
          onClick={() => {
            if (serviceId === "worker" && !diagnostic.uncertain) {
              beginNavigation("/tasks");
              navigate("/tasks");
            } else
              void (diagnostic.uncertain
                ? diagnostic.check()
                : diagnostic.run());
          }}
        >
          {diagnostic.pending
            ? "正在受理…"
            : diagnostic.uncertain
              ? "核对上次请求"
              : serviceId === "worker"
                ? "查看任务"
                : "检查数据库与缓存"}
        </button>
      </section>
      {selected && (
        <TaskDetail
          id={selected}
          session={session}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function TasksPage({ session }: { session: Session }) {
  const [status, setStatus] = useState(""),
    [cursor, setCursor] = useState(""),
    [history, setHistory] = useState<string[]>([]),
    [selected, setSelected] = useState<string | null>(null);
  const { data, error, reload } = useResource<TaskList>(
    "/tasks?limit=15" +
      (status ? "&status=" + status : "") +
      (cursor ? "&cursor=" + cursor : ""),
    true,
  );
  usePanelReady("/tasks", Boolean(data));
  const visible = useModuleVisibility(() => setSelected(null));
  const diagnostic = useDiagnostic(session, (id) => {
    if (visible.current) setSelected(id);
    setCursor("");
    setHistory([]);
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>后台任务</h1>
        </div>
        <button
          className="button primary"
          data-dialog-return
          disabled={diagnostic.pending}
          onClick={() =>
            void (diagnostic.uncertain ? diagnostic.check() : diagnostic.run())
          }
        >
          <Activity size={17} aria-hidden="true" />
          {diagnostic.uncertain ? "核对上次请求" : "运行系统检查"}
        </button>
      </div>
      <ErrorNotice message={error} onRetry={reload} />
      <DiagnosticNotice diagnostic={diagnostic} />
      <section className="card">
        <div className="table-toolbar">
          <SelectMenu
            label="任务状态"
            value={status}
            options={[
              { value: "", label: "全部状态" },
              ...Object.entries(statusLabels).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
            onChange={(value) => {
              setStatus(value);
              setCursor("");
              setHistory([]);
            }}
          />
          <button
            className="icon-button"
            aria-label="刷新任务"
            onClick={reload}
          >
            <RefreshCw size={18} />
          </button>
        </div>
        {!data ? (
          <ReadPending error={error} />
        ) : data.items.length ? (
          <TaskRows items={data.items} onOpen={setSelected} />
        ) : (
          <Empty title="暂无符合条件的任务" />
        )}
        <div className="pagination">
          <span>当前第 {history.length + 1} 页 · 每页最多 15 条</span>
          <div>
            <button
              className="button secondary small"
              disabled={!history.length}
              onClick={() => {
                setCursor(history.at(-1) || "");
                setHistory(history.slice(0, -1));
              }}
            >
              上一页
            </button>
            <button
              className="button secondary small"
              disabled={!data?.next_cursor}
              onClick={() => {
                setHistory([...history, cursor]);
                setCursor(data?.next_cursor || "");
              }}
            >
              下一页
            </button>
          </div>
        </div>
      </section>
      {selected && (
        <TaskDetail
          id={selected}
          session={session}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function SettingsPage({
  session,
  active = true,
}: {
  session: Session;
  active?: boolean;
}) {
  const [view, setView] = useState("general");
  const meta = useResource<{
    version: string;
    build: number;
    environment: string;
  }>("/meta");
  usePanelReady("/settings", true);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>系统设置</h1>
        </div>
      </div>
      <WorkspaceTabs
        label="设置分类"
        value={view}
        onChange={setView}
        items={[
          { value: "general", label: "常规" },
          ...(session.user.role === "admin"
            ? [
                { value: "services", label: "接口与服务" },
                { value: "mail", label: "邮件模板" },
                { value: "reference", label: "API 参考" },
              ]
            : []),
          { value: "closure", label: "账号注销" },
        ]}
      />
      <WorkspaceView active={view === "general"} label="常规">
        <section className="card padded settings-section">
          <h2>当前账号</h2>
          <dl className="settings-list">
            <div>
              <dt>版本</dt>
              <dd>
                {meta.data ? (
                  <VersionHistory
                    version={`v${meta.data.version} Build ${meta.data.build}`}
                  />
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt>环境</dt>
              <dd>
                {meta.data
                  ? envLabels[meta.data.environment] || meta.data.environment
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>用户名</dt>
              <dd>{session.user.username}</dd>
            </div>
            <div>
              <dt>角色</dt>
              <dd>{session.user.role === "admin" ? "管理员" : "用户"}</dd>
            </div>
            <div>
              <dt>登录有效期</dt>
              <dd>{time(session.expires_at)}</dd>
            </div>
          </dl>
        </section>
        {session.user.role === "admin" && (
          <NavLink className="button" to="/deploy-status">
            发布与更新
          </NavLink>
        )}
      </WorkspaceView>
      {session.user.role === "admin" && (
        <>
          <WorkspaceView active={view === "services"} label="接口与服务">
            <PrivateServiceSettings
              session={session}
              active={active && view === "services"}
              expanded
            />
          </WorkspaceView>
          <WorkspaceView active={view === "mail"} label="邮件模板">
            <MailTemplateSettings session={session} expanded />
          </WorkspaceView>
          <WorkspaceView active={view === "reference"} label="API 参考">
            <ApiReferenceSettings session={session} expanded />
          </WorkspaceView>
        </>
      )}
      <WorkspaceView active={view === "closure"} label="账号注销">
        <AccountClosureSettings session={session} />
      </WorkspaceView>
    </>
  );
}

function ModulePanel({
  path,
  active,
  children,
}: {
  path: string;
  active: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null),
    scroll = useRef(0);
  useLayoutEffect(() => {
    if (active && ref.current) ref.current.scrollTop = scroll.current;
  }, [active]);
  return (
    <section
      ref={ref}
      className="module-panel"
      data-module={path}
      data-module-active={active}
      onScroll={(e) => {
        if (active) scroll.current = e.currentTarget.scrollTop;
      }}
    >
      <div className="module-content workspace-ui" data-workspace-page={path}>
        {children}
      </div>
    </section>
  );
}
function Workspace({
  session,
  onLogout,
  appearance,
}: {
  session: Session;
  onLogout: () => void;
  appearance: AppearanceController;
}) {
  const location = useLocation(),
    navigate = useNavigate();
  const publicSite = usePublicSite();
  const [mobileViewport, setMobileViewport] = useState(
    () => matchMedia("(max-width: 800px)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(max-width: 800px)"),
      changed = () => setMobileViewport(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useNavigationCommit(location.pathname);
  const visited = useVisitedViews(location.pathname);
  const [mobile, setMobile] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [query, setQuery] = useState(""),
    [logoutError, setLogoutError] = useState("");
  useEffect(() => {
    if (!mobileViewport) setMobile(false);
  }, [mobileViewport]);
  const collapsed = appearance.settings.sidebarCollapsed;
  const profile = useResource<Profile>("/profile");
  useEffect(() => {
    setMobile(false);
    if (
      session.user.role !== "admin" &&
      !memberPaths.includes(location.pathname)
    )
      navigate("/profile", { replace: true });
    document.title =
      (navigation.find((n) => n.path === location.pathname)?.name ||
        servicePages.find((s) => "/connections/" + s.id === location.pathname)
          ?.label ||
        (location.pathname === "/deploy-status"
          ? "发布与更新"
          : location.pathname === "/profile"
            ? "个人资料"
            : location.pathname === "/appearance"
              ? "外观"
              : location.pathname === "/authorize"
                ? "客户端授权"
                : publicSite.title)) +
      " · " +
      publicSite.title;
  }, [location.pathname, publicSite.title]);
  useEffect(() => {
    if (!mobile) return;
    const previous = document.activeElement;
    const selected =
      document.querySelector<HTMLElement>(
        '.sidebar nav a[aria-current="page"]',
      ) || document.querySelector<HTMLElement>(".sidebar nav a");
    selected?.focus({ preventScroll: true });
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobile(false);
    };
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("keydown", escape);
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, [mobile]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setMobile(false);
        setSearchOpen((x) => !x);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  function toggleSidebar() {
    if (matchMedia("(max-width:800px)").matches) setMobile(false);
    else appearance.update({ sidebarCollapsed: !collapsed });
  }
  async function logout() {
    try {
      await api("/session/logout", { method: "POST" }, session.csrf);
      onLogout();
    } catch (e) {
      setLogoutError(e instanceof Error ? e.message : "退出失败");
    }
  }
  return (
    <div className={"app-shell " + (collapsed ? "collapsed" : "")}>
      {mobile && (
        <button
          className="mobile-scrim"
          tabIndex={-1}
          aria-label="关闭侧栏背景"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={"sidebar " + (mobile ? "open" : "")}>
        <div className="sidebar-top">
          <Logo />
          <button
            className="icon-button sidebar-toggle"
            aria-label={
              mobile ? "关闭导航" : collapsed ? "展开侧栏" : "收起侧栏"
            }
            onClick={toggleSidebar}
          >
            <PanelLeft size={19} />
          </button>
        </div>
        <button
          className="sidebar-search"
          aria-label="搜索功能"
          title={collapsed ? "搜索功能" : undefined}
          onClick={() => {
            setMobile(false);
            setQuery("");
            setSearchOpen(true);
          }}
        >
          <Search size={19} />
          <span className="nav-text">搜索功能</span>
          <kbd className="nav-text">⌘ K</kbd>
        </button>
        <WorkspaceNavigation
          items={mobileNavigation(
            session.user.role === "admin"
              ? navigation
              : navigation.filter((item) => memberPaths.includes(item.path)),
            publicSite.mobileNavigationOrder,
            mobileViewport,
          )}
          collapsed={collapsed}
          mobileOpen={mobile}
          preferInputOrder={
            mobileViewport && publicSite.mobileNavigationOrder.length > 0
          }
          onNavigate={(path) => {
            beginNavigation(path);
            setMobile(false);
          }}
        />
        <div className="sidebar-bottom">
          <NavLink
            to="/appearance"
            className={({ isActive }) =>
              "sidebar-appearance " + (isActive ? "active" : "")
            }
            aria-label="外观"
            title={collapsed ? "外观" : undefined}
            onClick={() => {
              beginNavigation("/appearance");
              setMobile(false);
            }}
          >
            <Palette size={19} />
            <span className="nav-text">外观</span>
          </NavLink>
          <div className="account">
            <AccountMenu
              session={session}
              profile={profile.data}
              location={location.pathname}
              onNavigate={(path) => {
                beginNavigation(path);
                setMobile(false);
                navigate(path);
              }}
              onLogout={() => void logout()}
            />
          </div>
        </div>
      </aside>
      <div className="main-shell" inert={mobile}>
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="打开导航"
            onClick={() => setMobile(true)}
          >
            <PanelLeft size={20} />
          </button>
          <div className="topbar-end">
            {["/cards", "/fire", "/activity"].includes(location.pathname) && (
              <AmountVisibilityControl />
            )}
            <button
              className="icon-button header-search"
              data-global-search-trigger
              aria-label="搜索功能"
              onClick={() => {
                setQuery("");
                setSearchOpen(true);
              }}
            >
              <Search size={18} />
            </button>
          </div>
        </header>
        {logoutError && (
          <div className="shell-notice">
            <ErrorNotice message={logoutError} />
          </div>
        )}
        <main className="workspace" aria-label="模块内容">
          {session.user.role !== "admin" &&
          !memberPaths.includes(location.pathname) ? (
            <Empty
              title="已登录 Alcor"
              description="普通用户账号无系统管理权限。"
              icon={ShieldCheck}
            />
          ) : (
            <>
              {(session.user.role === "admin" ? modulePaths : memberPaths)
                .filter(visited)
                .map((path) => (
                  <ViewActivity
                    key={path}
                    mode={location.pathname === path ? "visible" : "hidden"}
                  >
                    <ModulePanel
                      path={path}
                      active={location.pathname === path}
                    >
                      <Suspense
                        fallback={
                          <div className="workspace-loading" role="status">
                            <Loading />
                          </div>
                        }
                      >
                        <WorkspaceRoutes path={path}>
                          <Route
                            path="/backups"
                            element={<BackupsPage session={session} />}
                          />
                          <Route
                            path="/reference"
                            element={
                              <Suspense
                                fallback={<div role="status">正在读取…</div>}
                              >
                                <ReferencePage
                                  session={session}
                                  active={location.pathname === "/reference"}
                                />
                              </Suspense>
                            }
                          />
                          <Route
                            path="/celebs"
                            element={
                              <Suspense
                                fallback={<div role="status">正在读取…</div>}
                              >
                                <CelebsPage
                                  session={session}
                                  active={location.pathname === "/celebs"}
                                />
                              </Suspense>
                            }
                          />
                          <Route
                            path="/feed"
                            element={
                              <Suspense
                                fallback={<div role="status">正在读取…</div>}
                              >
                                <FeedPage
                                  session={session}
                                  active={location.pathname === "/feed"}
                                />
                              </Suspense>
                            }
                          />
                          <Route
                            path="/market"
                            element={
                              <Suspense
                                fallback={<div role="status">正在读取…</div>}
                              >
                                <MarketHistoryPage
                                  session={session}
                                  active={location.pathname === "/market"}
                                />
                              </Suspense>
                            }
                          />
                          <Route
                            path="/fire"
                            element={
                              <Suspense
                                fallback={<div role="status">正在读取…</div>}
                              >
                                <FirePage
                                  session={session}
                                  active={location.pathname === "/fire"}
                                />
                              </Suspense>
                            }
                          />
                          <Route
                            path="/shared-assets"
                            element={
                              <Suspense
                                fallback={<div role="status">正在读取…</div>}
                              >
                                <SharedAssetsPage
                                  session={session}
                                  active={
                                    location.pathname === "/shared-assets"
                                  }
                                />
                              </Suspense>
                            }
                          />
                          <Route
                            path="/attachments"
                            element={
                              <Suspense
                                fallback={<div role="status">正在读取…</div>}
                              >
                                <AdminAttachmentsPage
                                  session={session}
                                  active={location.pathname === "/attachments"}
                                />
                              </Suspense>
                            }
                          />
                          <Route
                            path="/watch-groups"
                            element={
                              <Suspense
                                fallback={<div role="status">正在读取…</div>}
                              >
                                <WatchGroupsPage
                                  session={session}
                                  active={location.pathname === "/watch-groups"}
                                />
                              </Suspense>
                            }
                          />
                          <Route
                            path="/activity"
                            element={
                              <Suspense
                                fallback={<div role="status">正在读取…</div>}
                              >
                                <ActivityPage session={session} />
                              </Suspense>
                            }
                          />
                          <Route
                            path="/legacy-import"
                            element={
                              <Suspense
                                fallback={<div role="status">正在读取…</div>}
                              >
                                <LegacyImportPage
                                  session={session}
                                  active={
                                    location.pathname === "/legacy-import"
                                  }
                                />
                              </Suspense>
                            }
                          />
                          <Route
                            path="/cards"
                            element={
                              <Suspense
                                fallback={<div role="status">正在读取…</div>}
                              >
                                <CardCatalogPage
                                  key={JSON.stringify([
                                    session.instance_id,
                                    session.user.id,
                                    session.user.role,
                                    session.receipt_scope,
                                    session.csrf,
                                    session.expires_at,
                                  ])}
                                  session={session}
                                  active={location.pathname === "/cards"}
                                />
                              </Suspense>
                            }
                          />
                          <Route
                            path="/financial-reports"
                            element={
                              <Suspense
                                fallback={<div role="status">正在读取…</div>}
                              >
                                <FinancialReportsPage
                                  session={session}
                                  active={
                                    location.pathname === "/financial-reports"
                                  }
                                />
                              </Suspense>
                            }
                          />
                          <Route
                            path="/resources"
                            element={
                              <Suspense
                                fallback={<div role="status">正在读取…</div>}
                              >
                                <ResourcesPage
                                  session={session}
                                  active={location.pathname === "/resources"}
                                />
                              </Suspense>
                            }
                          />
                          <Route
                            path="/fees"
                            element={
                              <Suspense
                                fallback={<div role="status">正在读取…</div>}
                              >
                                <FeesPage
                                  session={session}
                                  active={location.pathname === "/fees"}
                                />
                              </Suspense>
                            }
                          />
                          <Route
                            path="/portfolio"
                            element={<PortfolioPage session={session} />}
                          />
                          <Route
                            path="/account"
                            element={<AccountPage session={session} />}
                          />
                          <Route
                            path="/users"
                            element={<UsersPage session={session} />}
                          />
                          <Route
                            path="/clients"
                            element={<Navigate to="/" replace />}
                          />
                          <Route
                            path="/authorizations"
                            element={<Navigate to="/" replace />}
                          />
                          <Route
                            path="/authorize"
                            element={
                              <AuthorizePage
                                session={session}
                                query={location.search}
                              />
                            }
                          />
                          <Route
                            path="/app/authorize"
                            element={
                              <NativeAppAuthorize
                                session={session}
                                query={location.search}
                              />
                            }
                          />
                          <Route
                            path="/profile"
                            element={<ProfilePage session={session} />}
                          />
                          <Route
                            path="/"
                            element={<OverviewPage session={session} />}
                          />
                          <Route
                            path="/sync"
                            element={
                              <SyncStatusPage
                                session={session}
                                active={location.pathname === "/sync"}
                              />
                            }
                          />
                          <Route
                            path="/tasks"
                            element={<TasksPage session={session} />}
                          />
                          {servicePages.map((service) => (
                            <Route
                              key={service.id}
                              path={"/connections/" + service.id}
                              element={
                                <ConnectionPage
                                  session={session}
                                  serviceId={service.id}
                                />
                              }
                            />
                          ))}
                          <Route
                            path="/migration"
                            element={<MigrationPage />}
                          />
                          <Route
                            path="/appearance"
                            element={
                              <AppearancePage
                                appearance={appearance}
                                session={session}
                                active={location.pathname === path}
                              />
                            }
                          />
                          <Route
                            path="/settings"
                            element={
                              <SettingsPage
                                session={session}
                                active={location.pathname === "/settings"}
                              />
                            }
                          />
                        </WorkspaceRoutes>
                      </Suspense>
                    </ModulePanel>
                  </ViewActivity>
                ))}
              {!modulePaths.includes(location.pathname) && (
                <Empty title="页面不存在" />
              )}
            </>
          )}
        </main>
      </div>
      {searchOpen && (
        <Dialog title="搜索功能" onClose={() => setSearchOpen(false)}>
          <div className="dialog-content">
            <div className="input-search">
              <Search size={18} />
              <input
                data-dialog-autofocus
                autoFocus
                aria-label="搜索功能"
                placeholder="搜索功能"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="search-results">
              {[...navigation, appearanceNavigation]
                .filter(
                  (n) =>
                    session.user.role === "admin" ||
                    memberPaths.includes(n.path),
                )
                .filter((n) => (n.name + n.hint).includes(query))
                .map(({ path, name, icon: Icon }) => (
                  <button
                    key={path}
                    onClick={() => {
                      beginNavigation(path);
                      navigate(path);
                      setSearchOpen(false);
                    }}
                  >
                    <Icon size={19} />
                    <span>{name}</span>
                  </button>
                ))}
              {![...navigation, appearanceNavigation]
                .filter(
                  (n) =>
                    session.user.role === "admin" ||
                    memberPaths.includes(n.path),
                )
                .some((n) => (n.name + n.hint).includes(query)) && (
                <Empty title="没有找到功能" icon={Search} />
              )}
            </div>
          </div>
        </Dialog>
      )}
      <TransitionQA />
    </div>
  );
}

function AuthenticatedViews({
  session,
  appearance,
  onLogout,
}: {
  session: Session;
  appearance: AppearanceController;
  onLogout: () => void;
}) {
  const location = useLocation();
  const deploy = location.pathname === "/deploy-status";
  const visited = useVisitedViews(deploy ? "deployment" : "workspace");
  const site = usePublicSite();
  useEffect(() => {
    if (!modulePaths.includes(location.pathname) && !deploy)
      document.title = site.title;
  }, [location.pathname, deploy, site.title]);
  if (["/login", "/register", "/setup"].includes(location.pathname))
    return (
      <Navigate
        to={loginDestination(location.pathname, location.search, location.hash)}
        replace
      />
    );
  const legacy = legacySitePath(location.pathname);
  if (legacy)
    return <Navigate to={legacy + location.search + location.hash} replace />;
  const symbol =
    /^\/(?:watchlist|security)\/([A-Za-z]{2,5})\.([A-Za-z0-9._-]+)$/.exec(
      location.pathname,
    );
  if (symbol)
    return (
      <main className="page-section">
        <Logo />
        <NavLink to="/portfolio">返回记录</NavLink>
        <Suspense fallback={<Loading />}>
          <MarketAssetDetails
            session={session}
            entity={{
              market: symbol[1].toUpperCase(),
              code: symbol[2].toUpperCase(),
            }}
          />
        </Suspense>
      </main>
    );
  if (["/simple", "/simple-app"].includes(location.pathname))
    return (
      <main className="page-section simple-shell">
        <header className="simple-shell-heading">
          <Logo />
          <NavLink to="/legacy-import">返回数据与账本</NavLink>
        </header>
        <Suspense fallback={<Loading />}>
          <SimpleApp session={session} active />
        </Suspense>
      </main>
    );
  if (
    ["/assistant", "/chat", "/3d", "/app-download", "/downloads"].includes(
      location.pathname,
    )
  )
    return (
      <main className="page-section">
        <Logo />
        <p role="status">此模块已移出当前迁移范围</p>
        <NavLink to="/">返回</NavLink>
      </main>
    );
  if (
    !modulePaths.includes(location.pathname) &&
    location.pathname !== "/deploy-status"
  )
    return (
      <main className="page-section">
        <Logo />
        <p role="status">此路径尚未登记到当前平台</p>
        <NavLink to="/">返回</NavLink>
      </main>
    );
  return (
    <>
      {visited("deployment") && (
        <ViewActivity mode={deploy ? "visible" : "hidden"}>
          {session.user.role === "admin" ? (
            <DeploymentSettings session={session} appearance={appearance} />
          ) : (
            <main className="boot">
              <p>需要管理员权限</p>
              <NavLink to="/settings">返回系统设置</NavLink>
            </main>
          )}
        </ViewActivity>
      )}
      {visited("workspace") && (
        <ViewActivity mode={deploy ? "hidden" : "visible"}>
          <Workspace
            key={session.user.id}
            session={session}
            appearance={appearance}
            onLogout={onLogout}
          />
        </ViewActivity>
      )}
    </>
  );
}

function App() {
  const appearance = useAppearance();
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  useLayoutEffect(() => {
    if (!session) return;
    try {
      clearAttachmentRequests(
        sessionStorage,
        session.user.role === "admin"
          ? JSON.stringify([
              session.instance_id,
              session.user.id,
              session.user.role,
              session.receipt_scope,
            ])
          : undefined,
      );
      clearAttachmentImportRequests(
        sessionStorage,
        session.user.role === "admin"
          ? JSON.stringify([
              session.instance_id,
              session.user.id,
              session.user.role,
              session.receipt_scope,
            ])
          : undefined,
      );
      clearSharedAssetRequests(
        sessionStorage,
        session.user.role === "admin"
          ? JSON.stringify([
              session.instance_id,
              session.user.id,
              session.user.role,
              session.receipt_scope,
            ])
          : undefined,
      );
      clearFireRequests(
        sessionStorage,
        JSON.stringify([
          session.instance_id,
          session.user.id,
          session.user.role,
          session.receipt_scope,
        ]),
      );
      clearGroupRequests(
        sessionStorage,
        JSON.stringify([
          session.instance_id,
          session.user.id,
          session.user.role,
          session.receipt_scope,
        ]),
      );
      clearSourceRequests(
        sessionStorage,
        JSON.stringify([
          session.instance_id,
          session.user.id,
          session.user.role,
          session.receipt_scope,
        ]),
      );
      clearIconRequests(
        sessionStorage,
        JSON.stringify([
          session.instance_id,
          session.user.id,
          session.user.role,
          session.receipt_scope,
        ]),
      );
      clearFontRequests(
        sessionStorage,
        JSON.stringify([
          session.instance_id,
          session.user.id,
          session.user.role,
          session.receipt_scope,
        ]),
      );
    } catch {}
  }, [
    session?.instance_id,
    session?.user.id,
    session?.user.role,
    session?.receipt_scope,
  ]);
  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    const clearDrafts = () => {
      try {
        clearOperationJournal(sessionStorage);
        clearReferenceRequests(sessionStorage);
        clearPersonalProfileRequests(sessionStorage);
        clearResourceRequests(sessionStorage);
        clearSharedAssetRequests(sessionStorage);
        clearFireRequests(sessionStorage);
        clearGroupRequests(sessionStorage);
        clearSourceRequests(sessionStorage);
        clearIconRequests(sessionStorage);
        clearFontRequests(sessionStorage);
        clearAttachmentRequests(sessionStorage);
        clearAttachmentImportRequests(sessionStorage);
        clearLegacyImportRequests(sessionStorage);
        clearResourceImportRequests(sessionStorage);
        clearPreferenceDrafts(sessionStorage);
      } catch {}
    };
    const readSession = (replace = false) => {
      if (controller && !replace) return;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      void api<Session>("/session", { signal: request.signal })
        .then((s) => {
          if (!active || request.signal.aborted) return;
          const previous = apiSessionSnapshot().csrf;
          if (previous && previous !== s.csrf) clearDrafts();
          bindApiSession(s.csrf);
          setSession(s);
          setError("");
        })
        .catch((e) => {
          if (!active || request.signal.aborted) return;
          if (e instanceof ApiError && e.status === 401) {
            bindApiSession(null);
            clearDrafts();
            setSession(null);
          } else if (!(e instanceof ApiError && e.code === "session_changed"))
            setError(e instanceof Error ? e.message : "连接失败");
        })
        .finally(() => {
          if (controller === request) {
            controller = null;
            if (active) setLoading(false);
          }
        });
    };
    const expired = (event: Event) => {
      controller?.abort();
      controller = null;
      bindApiSession(null);
      clearDrafts();
      setLoading(false);
      setSession(null);
      setError(
        event instanceof CustomEvent &&
          typeof event.detail?.message === "string"
          ? event.detail.message
          : "登录已失效，请重新登录",
      );
    };
    const changed = () => {
      bindApiSession(null);
      clearDrafts();
      setSession(null);
      setLoading(true);
      readSession(true);
    };
    const visible = () => {
      if (document.visibilityState === "visible" && apiSessionSnapshot().csrf)
        readSession();
    };
    readSession();
    window.addEventListener("alcor:session-expired", expired);
    window.addEventListener("alcor:session-changed", changed);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      controller?.abort();
      window.removeEventListener("alcor:session-expired", expired);
      window.removeEventListener("alcor:session-changed", changed);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  if (loading)
    return (
      <div className="boot">
        <Logo />
        <Loading />
      </div>
    );
  return (
    <BrowserRouter>
      <EmailRegistrationBoundary>
        <AccountClosureBoundary>
          <EmailVerificationBoundary>
            <PasswordRecoveryBoundary>
              {session ? (
                <ResourceProvider
                  key={JSON.stringify([
                    window.location.origin,
                    session.instance_id,
                    session.user.id,
                    session.user.role,
                    session.expires_at,
                    session.receipt_scope,
                  ])}
                >
                  <AccountPreferencesProvider
                    session={session}
                    appearance={appearance}
                  >
                    <AvatarStatusProvider session={session}>
                      <>
                        <PersonalFontsProvider
                          session={session}
                          appearance={appearance}
                        >
                          <FinancialDisplayProvider>
                            <AuthenticatedViews
                              session={session}
                              appearance={appearance}
                              onLogout={() => {
                                try {
                                  clearOperationJournal(sessionStorage);
                                  clearReferenceRequests(sessionStorage);
                                  clearPersonalProfileRequests(sessionStorage);
                                  clearResourceRequests(sessionStorage);
                                  clearSharedAssetRequests(sessionStorage);
                                  clearFireRequests(sessionStorage);
                                  clearGroupRequests(sessionStorage);
                                  clearSourceRequests(sessionStorage);
                                  clearIconRequests(sessionStorage);
                                  clearFontRequests(sessionStorage);
                                  clearAttachmentRequests(sessionStorage);
                                  clearAttachmentImportRequests(sessionStorage);
                                  clearLegacyImportRequests(sessionStorage);
                                  clearResourceImportRequests(sessionStorage);
                                  clearPreferenceDrafts(sessionStorage);
                                } catch {}
                                bindApiSession(null);
                                setSession(null);
                                setError("");
                              }}
                            />
                          </FinancialDisplayProvider>
                        </PersonalFontsProvider>
                      </>
                    </AvatarStatusProvider>
                  </AccountPreferencesProvider>
                </ResourceProvider>
              ) : (
                <>
                  <ErrorNotice message={error} />
                  <Login
                    onLogin={(s) => {
                      bindApiSession(s.csrf);
                      setSession(s);
                      setError("");
                    }}
                  />
                </>
              )}
            </PasswordRecoveryBoundary>
          </EmailVerificationBoundary>
        </AccountClosureBoundary>
      </EmailRegistrationBoundary>
    </BrowserRouter>
  );
}
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="boot">
        <h1>页面暂时无法显示</h1>
        <button
          className="button primary"
          onClick={() => window.location.reload()}
        >
          重新加载
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
registerSiteWorker();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Boundary>
      <PublicSiteProvider>
        <App />
      </PublicSiteProvider>
    </Boundary>
  </React.StrictMode>,
);
