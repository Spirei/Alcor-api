import { WorkspaceTabs, WorkspaceView, WorkspaceEmpty } from "./workspace-ui";
import { useState as useWorkspaceState } from "react";
import { PublicPeopleFeed } from "./public-people-feed";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { requestId } from "./request-id";
import { Dialog } from "./dialog";
import "./feed.css";
import {
  Heart,
  MessageCircle,
  Newspaper,
  EyeOff,
  Ellipsis,
} from "lucide-react";
type Subscription = { name: string; url: string };
type Group = {
  id: string;
  name: string;
  revision: number;
  mode: "news" | "people";
  people: string[];
  subscriptions: Subscription[];
  updatedAt: string | null;
};
type Preferences = {
  instructions: string;
  revision: number;
  enabled: boolean;
  intervalMinutes: number;
  updatedAt: string | null;
};
type Agent = {
  name: string;
  image: string | null;
  revision: number;
  updatedAt: string | null;
};
type Source = {
  id: string;
  title: string;
  url: string;
  publisher: string;
  publishedAt: string | null;
  excerpt: string;
};
type Media = { type: string; url: string; alt?: string };
type Post = {
  id: string;
  title: string;
  icon: string;
  segments: { text: string; sourceId?: string; linkText?: string }[];
  sources: Source[];
  media: Media[];
  publishedAt: string | null;
  createdAt: string;
  liked: boolean;
  hidden: boolean;
  revision: number;
  sourceEvidence?: {
    sourceRevision: string;
    pageId: string;
    contentImmutable: boolean;
  };
  original?: {
    person: { name: string; handle: string; platform: string };
    text: string;
    textZh?: string;
    originalUrl: string;
    mediaUnavailable?: boolean;
    quote?: { name: string; text: string; url?: string };
  };
};
type Job = {
  requestId?: string;
  parentRequestId?: string;
  kind?: string;
  errorCode?: string | null;
  result?: unknown;
  id: string;
  jobId?: string;
  groupId?: string;
  status?: string;
  state?: string;
  createdAt?: string;
  updatedAt?: string;
  added?: number;
  error?: string | null;
  sources?: {
    targetId: string;
    state: string;
    reason?: string;
    pageId?: string;
    rawSha256?: string;
    count?: number;
    added?: number;
    title?: string;
    coverage?: {
      sourceItemCount: number;
      processedItems: number;
      skippedItems: number;
      partial: boolean;
      limit: number;
    };
  }[];
};
type Payload = {
  agent: Agent;
  posts: Post[];
  nextCursor: string | null;
  preferences: Preferences;
  group: Group | null;
  groups: Group[];
  job?: Job | null;
  capabilities?: {
    generate?: boolean;
    discussion?: boolean;
    discussionState?: string;
    avatar?: { image?: string; video?: string | null };
  };
  peopleSources?: {
    personId: string;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    error: string | null;
  }[];
};
type Message = {
  id: string;
  role: string;
  text: string;
  createdAt: string;
  sourceEvidence?: unknown;
};
type ModelTarget = {
  purpose: string;
  id: string;
  name?: string;
  model?: string;
  provider?: string;
  licenseRevision?: string;
  expiresAt?: string;
};
type Target = {
  id: string;
  name: string;
  url: string;
  provider: string;
  licenseRevision: string;
  expiresAt: string;
};
type Operation = {
  requestId: string;
  state: string;
  data?: unknown;
  result?: unknown;
  jobId?: string;
  taskId?: string;
  message?: string;
  error?: string;
  kind?: string;
  replyJob?: Job;
  replyState?: string;
  automation?: Record<string, unknown>;
  sources?: Job["sources"];
};
const base = "/feed";
const publicUrl = (raw: string) => {
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
};
const ownedImage = (raw: string | null) =>
  raw &&
  raw.startsWith("/api/feed/") &&
  !raw.includes("..") &&
  !raw.startsWith("//")
    ? raw
    : undefined;
const normalizeJob = (value: Job): Job => ({
  ...value,
  id: value.id || value.jobId || "",
});
const jobLabel = (raw: string) =>
  (
    ({
      queued: "等待执行",
      running: "执行中",
      searching: "读取来源中",
      writing: "整理中",
      done: "已完成",
      succeeded: "已完成",
      error: "失败",
      failed: "失败",
      unknown: "结果待核对",
      unavailable: "不可用",
      rejected: "已拒绝",
      cancelled: "已取消",
      partial: "部分来源完成",
      cancel_requested: "取消待核对",
    }) as Record<string, string>
  )[raw] || raw;
export function FeedPage({
  session,
  active = true,
}: {
  session: Session;
  active?: boolean;
}) {
  return (
    <FeedSession
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
    />
  );
}
function FeedSession({
  session,
  active,
}: {
  session: Session;
  active: boolean;
}) {
  const [workspaceSection, setWorkspaceSection] = useWorkspaceState("news");

  const storage =
    "feed-operation:" +
    JSON.stringify([
      session.instance_id,
      session.user.id,
      session.user.role,
      session.receipt_scope,
    ]);
  const [groupId, setGroupId] = useState("default"),
    [data, setData] = useState<Payload | null>(null),
    [filter, setFilter] = useState("all"),
    [author, setAuthor] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState<Post | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [question, setQuestion] = useState(""),
    [discussionError, setDiscussionError] = useState(""),
    [settings, setSettings] = useState(false),
    [targets, setTargets] = useState<Target[]>([]),
    [modelTargets, setModelTargets] = useState<ModelTarget[]>([]),
    [modelTarget, setModelTarget] = useState(""),
    [composeTarget, setComposeTarget] = useState(""),
    [testTarget, setTestTarget] = useState(""),
    [jobs, setJobs] = useState<Job[]>([]),
    [jobsCursor, setJobsCursor] = useState<string | null>(null),
    [job, setJob] = useState<Job | null>(null),
    [replyJob, setReplyJob] = useState<Job | null>(null),
    [cancelPending, setCancelPending] = useState<string | null>(null),
    [history, setHistory] = useState(false),
    [profile, setProfile] = useState<Agent | null>(null),
    [profileName, setProfileName] = useState(""),
    [profileFile, setProfileFile] = useState<File | null>(null),
    [profileOpen, setProfileOpen] = useState(false),
    [testResult, setTestResult] = useState<unknown>(null);
  const [draft, setDraft] = useState({
      name: "",
      instructions: "",
      enabled: false,
      intervalMinutes: "360",
      mode: "news",
      people: ["trump", "duan"] as string[],
      subscriptions: [] as Subscription[],
    }),
    [newName, setNewName] = useState(""),
    [newMode, setNewMode] = useState("news"),
    [newPeople, setNewPeople] = useState(["trump", "duan"]);
  const [pending, setPending] = useState<string | null>(() => {
    try {
      const id = sessionStorage.getItem(storage);
      return id &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          id,
        )
        ? id
        : null;
    } catch {
      return null;
    }
  });
  const postRead = useRef(0),
    selectedId = useRef<string | null>(null),
    discussionPost = useRef<string | null>(null);
  const epoch = useRef(0),
    live = useRef(true),
    controllers = useRef(new Set<AbortController>()),
    fileInput = useRef<HTMLInputElement>(null),
    reading = useRef(0);
  function clear() {
    epoch.current++;
    reading.current++;
    postRead.current++;
    selectedId.current = null;
    for (const c of controllers.current) c.abort();
    controllers.current.clear();
    setData(null);
    setSelected(null);
    setMessages([]);
    setQuestion("");
    setProfile(null);
    setProfileFile(null);
    if (fileInput.current) fileInput.current.value = "";
    setJobs([]);
    setJob(null);
    setReplyJob(null);
    setCancelPending(null);
    setTestResult(null);
    setBusy(false);
    setSettings(false);
    setProfileOpen(false);
    setHistory(false);
  }
  function fail(reason: unknown) {
    if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
      clear();
      setTargets([]);
      setModelTargets([]);
      setModelTarget("");
      setDraft({
        name: "",
        instructions: "",
        enabled: false,
        intervalMinutes: "360",
        mode: "news",
        people: [],
        subscriptions: [],
      });
      try {
        sessionStorage.removeItem(storage);
      } catch {
        /* Retire owner state. */
      }
      setPending(null);
    }
    setError(reason instanceof Error ? reason.message : "动态暂时不可用");
  }
  useEffect(() => {
    live.current = active;
    if (active && !document.hidden) void load();
    else clear();
    const visibility = () => {
      if (document.hidden) clear();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      live.current = false;
      epoch.current++;
      for (const c of controllers.current) c.abort();
      controllers.current.clear();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [active, groupId, author, filter]);
  function current(run: number) {
    return live.current && !document.hidden && run === epoch.current;
  }
  async function load(more = false) {
    if (!live.current || document.hidden) return;
    const run = epoch.current,
      seq = ++reading.current,
      c = new AbortController();
    controllers.current.add(c);
    setBusy(true);
    setError("");
    const params = new URLSearchParams({
      group: groupId,
      limit: "10",
      includeHidden: filter === "hidden" ? "true" : "false",
      ...(author ? { author } : {}),
      ...(more && data?.nextCursor ? { cursor: data.nextCursor } : {}),
    });
    try {
      const value = await api<Payload>(base + "?" + params, {
        signal: c.signal,
      });
      if (current(run) && seq === reading.current) {
        setData((previous) =>
          more && previous
            ? {
                ...value,
                posts: [
                  ...previous.posts,
                  ...value.posts.filter(
                    (row) =>
                      !previous.posts.some(
                        (existing) => existing.id === row.id,
                      ),
                  ),
                ],
              }
            : value,
        );
        setJob(value.job ? normalizeJob(value.job) : null);
      }
    } catch (reason) {
      if (!c.signal.aborted && current(run) && seq === reading.current)
        fail(reason);
    } finally {
      controllers.current.delete(c);
      if (current(run) && seq === reading.current) setBusy(false);
    }
  }
  function remember(id: string | null) {
    try {
      if (id) sessionStorage.setItem(storage, id);
      else sessionStorage.removeItem(storage);
      setPending(id);
      return true;
    } catch {
      setError("无法保留原请求编号，未提交动态操作");
      return false;
    }
  }
  function accept(value: Operation, id: string) {
    if (value.requestId !== id) throw new Error("原动态请求仍待核对");
    if (["unknown", "running", "admitted"].includes(value.state)) {
      setNotice("原请求尚待核对，不会自动重发");
      return;
    }
    if (
      ![
        "completed",
        "failed",
        "rejected",
        "unavailable",
        "queued",
        "succeeded",
        "partial",
        "cancelled",
      ].includes(value.state)
    )
      throw new Error("原动态请求状态仍待核对");
    remember(null);
    setNotice(
      value.replyState === "not_requested"
        ? "本人消息已保存，未请求模型回复"
        : value.message || value.error || jobLabel(value.state),
    );
    if (value.replyJob) setReplyJob(normalizeJob(value.replyJob));
    if (value.automation) {
      const automation = value.automation;
      if (typeof automation.jobId === "string")
        setJob(normalizeJob(automation as unknown as Job));
      else if (automation.state === "unavailable")
        setNotice(
          "偏好已保存，定时更新尚不可用：" +
            String(automation.reason || "来源或授权未核实"),
        );
    }
    if (value.jobId) {
      setJob({
        id: value.jobId,
        jobId: value.jobId,
        requestId: value.requestId,
        state: value.state,
        kind: value.kind,
        sources: value.sources,
      });
      setHistory(true);
    }
    if (value.kind === "test_source" || value.kind === "source_test")
      setTestResult(value.data ?? value.result ?? value);
    const outcome = value.result ?? value.data;
    if (outcome && typeof outcome === "object") {
      const result = outcome as Record<string, unknown>;
      if (
        Array.isArray(result.messages) &&
        discussionPost.current !== null &&
        selectedId.current === discussionPost.current
      ) {
        setMessages(result.messages as Message[]);
        setQuestion("");
        if (value.replyJob) {
          setDiscussionError("");
          setNotice("本人消息已保存，回复任务已登记（尚未完成）");
        } else if (value.replyState === "not_requested") setDiscussionError("");
        else if (
          result.assistantReplyGenerated === false ||
          result.replyState === "unavailable"
        )
          setDiscussionError("本人消息已保存；当前未生成讨论回复");
      }
      if (
        typeof result.name === "string" &&
        typeof result.revision === "number" &&
        "image" in result
      ) {
        setProfile(result as Agent);
        setProfileName(result.name);
      }
      if (
        typeof result.id === "string" &&
        Array.isArray(result.subscriptions) &&
        "mode" in result
      ) {
        if (result.id !== groupId || result.mode !== "people") setAuthor("");
        setGroupId(result.id);
        setNewName("");
      }
      if (typeof result.jobId === "string")
        setJob({ id: result.jobId, state: String(result.state || "queued") });
    }
    if (value.state === "completed" || value.state === "succeeded") void load();
  }
  async function mutate(
    path: string,
    method: string,
    body: Record<string, unknown> | FormData,
  ) {
    if (busy || pending || !active || document.hidden) return;
    const id = requestId();
    if (!remember(id)) return;
    discussionPost.current = path.endsWith("/discussion")
      ? selectedId.current
      : null;
    const run = epoch.current;
    setBusy(true);
    setError("");
    setNotice("");
    if (body instanceof FormData) {
      body.set("requestId", id);
      setProfileFile(null);
      if (fileInput.current) fileInput.current.value = "";
    }
    try {
      const value = await api<Operation>(
        base + path,
        {
          method,
          body:
            body instanceof FormData
              ? body
              : JSON.stringify({ ...body, requestId: id }),
        },
        session.csrf,
        60000,
      );
      if (current(run)) {
        if (
          !(body instanceof FormData) &&
          path.startsWith("/preferences") &&
          body.mode !== "people" &&
          value.state === "completed"
        )
          setAuthor("");
        accept(value, id);
      }
    } catch (reason) {
      if (current(run)) {
        fail(reason);
        if (
          reason instanceof ApiError &&
          [400, 404, 405, 409, 413, 415, 422, 429].includes(reason.status)
        ) {
          try {
            const known = await api<Operation>(base + "/operations/" + id);
            if (current(run)) accept(known, id);
          } catch (lookup) {
            if (current(run)) {
              if (lookup instanceof ApiError && lookup.status === 404) {
                remember(null);
                setNotice("请求已被明确拒绝，请修正后再操作");
              } else if (
                lookup instanceof ApiError &&
                [401, 403].includes(lookup.status)
              )
                fail(lookup);
            }
          }
        }
      }
    } finally {
      if (current(run)) setBusy(false);
    }
  }
  async function query() {
    if (!pending || busy || !active || document.hidden) return;
    const id = pending,
      run = epoch.current;
    setBusy(true);
    setError("");
    try {
      const value = await api<Operation>(base + "/operations/" + id);
      if (current(run)) accept(value, id);
    } catch (reason) {
      if (current(run)) fail(reason);
    } finally {
      if (current(run)) setBusy(false);
    }
  }
  async function readGroups() {
    if (busy || document.hidden) return;
    const run = epoch.current,
      c = new AbortController();
    controllers.current.add(c);
    setBusy(true);
    try {
      const value = await api<{ groups: Group[] }>(base + "/groups", {
        signal: c.signal,
      });
      if (current(run)) {
        setData((previous) =>
          previous ? { ...previous, groups: value.groups } : previous,
        );
        if (
          !value.groups.some((group) => group.id === groupId) &&
          value.groups[0]
        )
          setGroupId(value.groups[0].id);
      }
    } catch (reason) {
      if (!c.signal.aborted && current(run)) fail(reason);
    } finally {
      controllers.current.delete(c);
      if (current(run)) setBusy(false);
    }
  }
  async function readTargets() {
    if (busy || !active || document.hidden) return;
    const run = epoch.current,
      c = new AbortController();
    controllers.current.add(c);
    setBusy(true);
    setError("");
    try {
      const value = await api<{
        targets: Target[];
        modelTargets: ModelTarget[];
      }>(base + "/targets", { signal: c.signal });
      if (current(run)) {
        setTargets(value.targets);
        const models = value.modelTargets || [];
        setModelTargets(models);
        if (
          !value.targets.some(
            (target) =>
              target.provider === "rss-atom" && target.id === testTarget,
          )
        )
          setTestTarget("");
        if (
          !models.some(
            (target) =>
              target.id === modelTarget && target.purpose === "feed.discussion",
          )
        )
          setModelTarget("");
        if (
          !models.some(
            (target) =>
              target.id === composeTarget && target.purpose === "feed.compose",
          )
        )
          setComposeTarget("");
      }
    } catch (reason) {
      if (!c.signal.aborted && current(run)) fail(reason);
    } finally {
      controllers.current.delete(c);
      if (current(run)) setBusy(false);
    }
  }
  async function showPost(post: Post) {
    if (busy || document.hidden) return;
    selectedId.current = post.id;
    const sequence = ++postRead.current;
    setSelected(post);
    setMessages([]);
    setQuestion("");
    setDiscussionError("");
    const run = epoch.current,
      c = new AbortController();
    controllers.current.add(c);
    try {
      const [item, discussion] = await Promise.all([
        api<Post>(base + "/posts/" + encodeURIComponent(post.id), {
          signal: c.signal,
        }),
        api<{ messages: Message[] }>(
          base + "/posts/" + encodeURIComponent(post.id) + "/discussion",
          { signal: c.signal },
        ),
      ]);
      if (current(run) && sequence === postRead.current) {
        setSelected(item);
        setMessages(discussion.messages);
      }
    } catch (reason) {
      if (!c.signal.aborted && current(run) && sequence === postRead.current) {
        if (reason instanceof ApiError && [401, 403].includes(reason.status))
          fail(reason);
        else
          setDiscussionError(
            reason instanceof Error ? reason.message : "帖子读取失败",
          );
      }
    } finally {
      controllers.current.delete(c);
    }
  }
  async function readDiscussion() {
    if (!selected || busy || document.hidden) return;
    const id = selected.id,
      run = epoch.current,
      sequence = ++postRead.current,
      c = new AbortController();
    controllers.current.add(c);
    setBusy(true);
    try {
      const value = await api<{ messages: Message[] }>(
        base + "/posts/" + encodeURIComponent(id) + "/discussion",
        { signal: c.signal },
      );
      if (current(run) && sequence === postRead.current)
        setMessages(value.messages);
    } catch (reason) {
      if (!c.signal.aborted && current(run)) fail(reason);
    } finally {
      controllers.current.delete(c);
      if (current(run)) setBusy(false);
    }
  }
  async function readJobs(more = false) {
    if (busy || document.hidden) return;
    const run = epoch.current,
      c = new AbortController();
    controllers.current.add(c);
    setBusy(true);
    setHistory(true);
    try {
      const value = await api<{ jobs: Job[]; nextCursor: string | null }>(
        base +
          "/jobs?" +
          new URLSearchParams({
            group: groupId,
            ...(more && jobsCursor ? { cursor: jobsCursor } : {}),
          }),
        { signal: c.signal },
      );
      if (current(run)) {
        setJobs((previous) =>
          more
            ? [
                ...previous,
                ...value.jobs
                  .map(normalizeJob)
                  .filter(
                    (item) => !previous.some((known) => known.id === item.id),
                  ),
              ]
            : value.jobs.map(normalizeJob),
        );
        setJobsCursor(value.nextCursor);
      }
    } catch (reason) {
      if (!c.signal.aborted && current(run)) fail(reason);
    } finally {
      controllers.current.delete(c);
      if (current(run)) setBusy(false);
    }
  }
  async function readJob(id: string, reply = false) {
    if (busy || document.hidden) return;
    const run = epoch.current;
    setBusy(true);
    try {
      const value = await api<Job>(base + "/jobs/" + encodeURIComponent(id));
      if (current(run)) {
        if (reply) setReplyJob(normalizeJob(value));
        else setJob(normalizeJob(value));
        setCancelPending(null);
      }
    } catch (reason) {
      if (current(run)) fail(reason);
    } finally {
      if (current(run)) setBusy(false);
    }
  }
  async function cancelJob(id: string, reply = false) {
    if (busy || pending || cancelPending || !active || document.hidden) return;
    const run = epoch.current;
    setBusy(true);
    setError("");
    setCancelPending(id);
    try {
      const value = await api<Job>(
        base + "/jobs/" + encodeURIComponent(id) + "/cancel",
        { method: "POST", body: "{}" },
        session.csrf,
      );
      if (current(run)) {
        if (reply) setReplyJob(normalizeJob(value));
        else setJob(normalizeJob(value));
        setCancelPending(null);
      }
    } catch (reason) {
      if (current(run)) {
        fail(reason);
        setNotice("取消结果待核对，请读取原任务，不会新建来源请求");
      }
    } finally {
      if (current(run)) setBusy(false);
    }
  }
  async function original(pageId: string) {
    if (busy || !active || document.hidden) return;
    const run = epoch.current,
      c = new AbortController();
    controllers.current.add(c);
    setBusy(true);
    try {
      const response = await fetch(
        "/api" + base + "/originals/" + encodeURIComponent(pageId),
        {
          credentials: "same-origin",
          headers: { "X-CSRF-Token": session.csrf },
          signal: c.signal,
        },
      );
      if (!response.ok) throw new ApiError(response.status, "原件暂不可读");
      const blob = await response.blob();
      if (!current(run)) return;
      const url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "feed-original-" + pageId;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (reason) {
      if (!c.signal.aborted && current(run)) fail(reason);
    } finally {
      controllers.current.delete(c);
      if (current(run)) setBusy(false);
    }
  }
  async function queryJobOperation(id: string, reply = false) {
    if (busy || !active || document.hidden) return;
    const run = epoch.current;
    setBusy(true);
    try {
      const value = await api<Job>(
        base + "/operations/" + encodeURIComponent(id),
      );
      if (current(run)) {
        if (reply) setReplyJob(normalizeJob(value));
        else setJob(normalizeJob(value));
      }
    } catch (reason) {
      if (current(run)) fail(reason);
    } finally {
      if (current(run)) setBusy(false);
    }
  }
  async function editProfile() {
    if (busy) return;
    const run = epoch.current;
    setBusy(true);
    setProfileOpen(true);
    try {
      const value = await api<Agent>(base + "/profile");
      if (current(run)) {
        setProfile(value);
        setProfileName(value.name);
      }
    } catch (reason) {
      if (current(run)) fail(reason);
    } finally {
      if (current(run)) setBusy(false);
    }
  }
  function editSettings() {
    if (!data?.group) return;
    setDraft({
      name: data.group.name,
      instructions: data.preferences.instructions,
      enabled: data.preferences.enabled,
      intervalMinutes: String(data.preferences.intervalMinutes),
      mode: data.group.mode,
      people: data.group.people,
      subscriptions: data.group.subscriptions,
    });
    setSettings(true);
  }
  const sourceBusy = [job, replyJob].some(
    (item) =>
      !!item &&
      ([
        "queued",
        "running",
        "searching",
        "writing",
        "cancel_requested",
        "unknown",
      ].includes(item.state || item.status || "unknown") ||
        item.sources?.some((source) => source.state === "unknown")),
  );
  const disabled = busy || !!pending || !active;
  const posts = (data?.posts || []).filter((post) =>
    filter === "hidden"
      ? post.hidden
      : filter === "liked"
        ? post.liked && !post.hidden
        : !post.hidden,
  );
  return (
    <section className="feed-page">
      <div className="page-heading">
        <h1>动态</h1>
        <div className="feed-actions">
          <button
            className="button"
            disabled={disabled}
            onClick={() => void load()}
          >
            读取列表
          </button>
          <button
            className="button"
            disabled={disabled || sourceBusy || !data?.group}
            onClick={() =>
              void mutate("/refresh", "POST", {
                groupId: data!.group!.id,
                groupRevision: data!.group!.revision,
                ...(composeTarget ? { modelTargetId: composeTarget } : {}),
              })
            }
          >
            明确刷新来源
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {pending && (
        <div className="feed-pending">
          <p role="status">原动态操作结果待核对</p>
          <code>{pending}</code>
          <button disabled={busy || !active} onClick={() => void query()}>
            查询原请求
          </button>
        </div>
      )}
      <WorkspaceTabs
        label="动态视图"
        value={workspaceSection}
        onChange={setWorkspaceSection}
        items={[
          { value: "news", label: "资讯动态" },
          { value: "people", label: "公开原帖" },
        ]}
      />

      <WorkspaceView active={workspaceSection === "people"} label="公开原帖">
        <PublicPeopleFeed
          session={session}
          active={active && workspaceSection === "people"}
          expanded
        />
      </WorkspaceView>

      <WorkspaceView active={workspaceSection === "news"} label="资讯动态">
        <div className="feed-toolbar">
          <button
            className="button"
            disabled={disabled}
            onClick={() => void readGroups()}
          >
            读取分组
          </button>
          <label>
            分组
            <select
              value={groupId}
              disabled={disabled}
              onChange={(e) => {
                clear();
                setAuthor("");
                setGroupId(e.target.value);
              }}
            >
              {!data?.groups.some((group) => group.id === groupId) && (
                <option value={groupId}>
                  {groupId === "default" ? "默认分组" : "分组待核对"}
                </option>
              )}
              {data?.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            帖子
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">未隐藏</option>
              <option value="liked">已喜欢（当前已读范围）</option>
              <option value="hidden">已隐藏（当前已读范围）</option>
            </select>
          </label>
          {data?.group?.mode === "people" && (
            <label>
              人物
              <select
                value={author}
                onChange={(e) => {
                  clear();
                  setAuthor(e.target.value);
                }}
              >
                <option value="">本组人物</option>
                {data.group.people.map((id) => (
                  <option key={id} value={id}>
                    {id === "trump" ? "特朗普" : id === "duan" ? "段永平" : id}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="button"
            disabled={disabled || !data?.group}
            onClick={editSettings}
          >
            分组与个人偏好
          </button>
        </div>
        <details className="workspace-tools feed-tools">
          <summary>来源与分组管理</summary>
          <div className="feed-toolbar">
            <button disabled={busy} onClick={() => void readTargets()}>
              读取已安装来源
            </button>
            <label>
              文章整理模型
              <select
                value={composeTarget}
                disabled={disabled}
                onChange={(event) => setComposeTarget(event.target.value)}
              >
                <option value="">
                  不请求模型整理（保留RSS原文，个人指示不应用）
                </option>
                {modelTargets
                  .filter((target) => target.purpose === "feed.compose")
                  .map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.model || target.id} ·{" "}
                      {target.licenseRevision || "许可待核对"}
                    </option>
                  ))}
              </select>
            </label>
            <button
              className="button"
              disabled={disabled}
              onClick={() => void editProfile()}
            >
              动态形象
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => void readJobs()}
            >
              更新记录
            </button>
          </div>
          <details>
            <summary>新建分组</summary>
            <div className="feed-fields">
              <label>
                名称
                <input
                  value={newName}
                  maxLength={40}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={disabled}
                />
              </label>
              <ModeFields
                mode={newMode}
                people={newPeople}
                disabled={disabled}
                onMode={setNewMode}
                onPeople={setNewPeople}
              />
              <button
                className="button"
                disabled={disabled || !newName.trim()}
                onClick={() =>
                  void mutate("/groups", "POST", {
                    name: newName,
                    mode: newMode,
                    people: newPeople,
                  })
                }
              >
                创建分组
              </button>
            </div>
          </details>
        </details>
        {data?.agent && (
          <div className="feed-agent">
            {ownedImage(data.agent.image) && (
              <AgentImage src={ownedImage(data.agent.image)!} />
            )}
            <strong>{data.agent.name}</strong>
          </div>
        )}
        {data?.peopleSources?.map(
          (source) =>
            source.error && (
              <p key={source.personId} role="status">
                {source.personId} · {source.error} · 最近成功{" "}
                {source.lastSuccessAt || "未知"}
              </p>
            ),
        )}
        {!data && !error && <p role="status">正在读取动态…</p>}
        {data && !posts.length && (
          <WorkspaceEmpty
            title="暂无符合筛选的动态"
            description="可以切换分组或筛选条件，已保留的来源不会被改写。"
          />
        )}
        <div className="feed-list">
          {posts.map((post) => (
            <article key={post.id} className="feed-post">
              <div className="feed-post-avatar" aria-hidden="true">
                {post.original ? (
                  post.original.person.name.slice(0, 1)
                ) : (
                  <Newspaper size={22} />
                )}
              </div>
              <div className="feed-post-content">
                <div className="feed-post-heading">
                  <div>
                    {post.original && (
                      <div className="feed-post-author">
                        <strong>{post.original.person.name}</strong>
                        <span>
                          {post.original.person.handle} ·{" "}
                          {post.original.person.platform}
                        </span>
                      </div>
                    )}
                    <h2>
                      <button onClick={() => void showPost(post)}>
                        {post.title}
                      </button>
                    </h2>
                  </div>
                  <button
                    className="feed-more"
                    aria-label={"查看“" + post.title + "”原文与来源"}
                    onClick={() => void showPost(post)}
                  >
                    <Ellipsis size={20} />
                  </button>
                </div>
                <time>
                  {post.publishedAt || "发布时间未知"}
                  {!post.publishedAt && " · 收录 " + post.createdAt}
                </time>
                {post.segments.map((segment, index) => (
                  <p key={index}>
                    {segment.text}
                    {segment.sourceId && (
                      <button
                        className="feed-source-link"
                        onClick={() => void showPost(post)}
                      >
                        {segment.linkText || "查看来源"}
                      </button>
                    )}
                  </p>
                ))}
                {post.original && (
                  <p className="feed-plain-text">
                    {post.original.textZh || post.original.text}
                  </p>
                )}
                {post.original?.quote && (
                  <blockquote className="feed-quote">
                    <strong>{post.original.quote.name}</strong>
                    <p>{post.original.quote.text}</p>
                  </blockquote>
                )}
                {post.media.length > 0 && (
                  <div className="feed-media">
                    {post.media.map((media, index) =>
                      media.type === "image" && ownedImage(media.url) ? (
                        <img
                          key={index}
                          src={ownedImage(media.url)}
                          alt={media.alt || "帖子附图"}
                          loading="lazy"
                          decoding="async"
                        />
                      ) : publicUrl(media.url) ? (
                        <a
                          key={index}
                          href={publicUrl(media.url)!}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {media.alt || "查看原始媒体"}
                        </a>
                      ) : null,
                    )}
                  </div>
                )}
                <div className="feed-actions">
                  <button
                    disabled={disabled}
                    aria-pressed={post.liked}
                    onClick={() =>
                      void mutate(
                        "/posts/" + encodeURIComponent(post.id),
                        "PUT",
                        {
                          revision: post.revision,
                          liked: !post.liked,
                        },
                      )
                    }
                  >
                    <Heart
                      size={17}
                      fill={post.liked ? "currentColor" : "none"}
                    />
                    {post.liked ? "已喜欢" : "喜欢"}
                  </button>
                  <button
                    disabled={disabled}
                    onClick={() =>
                      void mutate(
                        "/posts/" + encodeURIComponent(post.id),
                        "PUT",
                        {
                          revision: post.revision,
                          hidden: !post.hidden,
                        },
                      )
                    }
                  >
                    <EyeOff size={17} />
                    {post.hidden ? "恢复显示" : "隐藏"}
                  </button>
                  <button onClick={() => void showPost(post)}>
                    <MessageCircle size={17} />
                    原文与讨论
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
        {data?.nextCursor && (
          <button
            className="button"
            disabled={busy}
            onClick={() => void load(true)}
          >
            读取更多保留帖子
          </button>
        )}
        {job && (
          <JobView
            job={job}
            busy={busy}
            onRead={() => void readJob(job.id || job.jobId!)}
            onCancel={() => void cancelJob(job.id)}
            cancelBlocked={!!cancelPending || !!pending}
            onOriginal={original}
            onQuery={
              job.requestId
                ? () => void queryJobOperation(job.requestId!)
                : undefined
            }
          />
        )}
        {replyJob && (
          <JobView
            job={replyJob}
            busy={busy}
            onRead={() => void readJob(replyJob.id, true)}
            onCancel={() => void cancelJob(replyJob.id, true)}
            cancelBlocked={!!cancelPending || !!pending}
            onOriginal={original}
            onQuery={
              replyJob.requestId
                ? () => void queryJobOperation(replyJob.requestId!, true)
                : undefined
            }
          />
        )}
        {history && (
          <details open>
            <summary>更新记录</summary>
            {jobs.map((item) => (
              <JobView
                key={item.id}
                job={item}
                busy={busy}
                onRead={() => void readJob(item.id, item.kind === "discussion")}
                onCancel={() =>
                  void cancelJob(item.id, item.kind === "discussion")
                }
                cancelBlocked={!!cancelPending || !!pending}
                onOriginal={original}
                onQuery={
                  item.requestId
                    ? () =>
                        void queryJobOperation(
                          item.requestId!,
                          item.kind === "discussion",
                        )
                    : undefined
                }
              />
            ))}
            {jobsCursor && (
              <button disabled={busy} onClick={() => void readJobs(true)}>
                读取更早任务
              </button>
            )}
          </details>
        )}
      </WorkspaceView>

      {settings && data?.group && (
        <Dialog title="分组与个人偏好" onClose={() => setSettings(false)}>
          <div className="feed-fields">
            <label>
              分组名称
              <input
                value={draft.name}
                maxLength={40}
                disabled={disabled}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <button
              disabled={disabled}
              onClick={() =>
                void mutate(
                  "/groups/" + encodeURIComponent(data.group!.id),
                  "PUT",
                  { name: draft.name, revision: data.group!.revision },
                )
              }
            >
              仅保存分组名称
            </button>
            <ModeFields
              mode={draft.mode}
              people={draft.people}
              disabled={disabled}
              onMode={(mode) => setDraft({ ...draft, mode })}
              onPeople={(people) => setDraft({ ...draft, people })}
            />
            <label>
              个人编辑指示
              <textarea
                value={draft.instructions}
                maxLength={10000}
                disabled={disabled}
                onChange={(e) =>
                  setDraft({ ...draft, instructions: e.target.value })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.enabled}
                disabled={disabled}
                onChange={(e) =>
                  setDraft({ ...draft, enabled: e.target.checked })
                }
              />
              明确启用定时更新
            </label>
            <label>
              间隔分钟
              <input
                type="number"
                min="5"
                max="10080"
                value={draft.intervalMinutes}
                disabled={disabled}
                onChange={(e) =>
                  setDraft({ ...draft, intervalMinutes: e.target.value })
                }
              />
            </label>
            <button disabled={busy} onClick={() => void readTargets()}>
              读取已安装订阅来源
            </button>
            {!targets.length && (
              <p>当前未读到可用订阅来源；不会自动安装或外取</p>
            )}
            <label>
              测试来源
              <select
                value={testTarget}
                disabled={disabled}
                onChange={(e) => setTestTarget(e.target.value)}
              >
                <option value="">选择已安装来源</option>
                {targets
                  .filter((target) => target.provider === "rss-atom")
                  .map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name} · {target.provider} ·{" "}
                      {target.licenseRevision}
                    </option>
                  ))}
              </select>
            </label>
            <button
              disabled={disabled || sourceBusy || !testTarget}
              onClick={() =>
                void mutate("/subscriptions/test", "POST", {
                  targetId: testTarget,
                })
              }
            >
              明确读取测试一次（不加入文章）
            </button>
            {testResult !== null && <OperationDetails value={testResult} />}
            <div>
              {targets.map((target) => (
                <label key={target.id}>
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={draft.subscriptions.some(
                      (source) => source.url === target.url,
                    )}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        subscriptions: e.target.checked
                          ? [
                              ...draft.subscriptions.filter(
                                (source) => source.url !== target.url,
                              ),
                              { name: target.name, url: target.url },
                            ]
                          : draft.subscriptions.filter(
                              (source) => source.url !== target.url,
                            ),
                      })
                    }
                  />
                  {target.name} · 到期 {target.expiresAt}
                </label>
              ))}
              {draft.subscriptions
                .filter(
                  (source) =>
                    !targets.some((target) => target.url === source.url),
                )
                .map((source) => (
                  <div key={source.url}>
                    <span>{source.name} · 未匹配当前已安装来源</span>
                    <button
                      disabled={disabled}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          subscriptions: draft.subscriptions.filter(
                            (item) => item.url !== source.url,
                          ),
                        })
                      }
                    >
                      移除此订阅
                    </button>
                  </div>
                ))}
            </div>
            <button
              className="button primary"
              disabled={disabled}
              onClick={() =>
                void mutate(
                  "/preferences?group=" + encodeURIComponent(groupId),
                  "PUT",
                  {
                    ...draft,
                    revision: data.preferences.revision,
                    intervalMinutes: Number(draft.intervalMinutes),
                  },
                )
              }
            >
              保存偏好（不自动刷新）
            </button>
          </div>
        </Dialog>
      )}
      {profileOpen && (
        <Dialog
          title="动态形象"
          onClose={() => {
            setProfileOpen(false);
            setProfileFile(null);
            if (fileInput.current) fileInput.current.value = "";
          }}
        >
          {profile ? (
            <div className="feed-fields">
              {ownedImage(profile.image) && (
                <AgentImage src={ownedImage(profile.image)!} large />
              )}
              <label>
                名称
                <input
                  value={profileName}
                  maxLength={40}
                  disabled={disabled}
                  onChange={(e) => setProfileName(e.target.value)}
                />
              </label>
              <button
                disabled={disabled || !profileName.trim()}
                onClick={() =>
                  void mutate("/profile", "PUT", {
                    name: profileName,
                    revision: profile.revision,
                  })
                }
              >
                保存名称
              </button>
              <label>
                形象原图
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  disabled={disabled}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file && file.size > 2 * 1024 * 1024) {
                      setProfileFile(null);
                      e.target.value = "";
                      setError("请选择不超过2MiB的形象原图");
                      return;
                    }
                    setProfileFile(file || null);
                  }}
                />
              </label>
              <button
                disabled={disabled || !profileFile}
                onClick={() => {
                  const form = new FormData();
                  form.set("file", profileFile!);
                  form.set("revision", String(profile.revision));
                  void mutate("/profile/avatar", "POST", form);
                }}
              >
                上传形象
              </button>
              <button
                disabled={disabled}
                onClick={() =>
                  void mutate("/profile", "PUT", {
                    resetAvatar: true,
                    revision: profile.revision,
                  })
                }
              >
                恢复默认形象
              </button>
            </div>
          ) : (
            <p>形象读取中或不可用</p>
          )}
        </Dialog>
      )}
      {selected && (
        <Dialog
          title={selected.title}
          onClose={() => {
            postRead.current++;
            selectedId.current = null;
            setSelected(null);
            setMessages([]);
            setQuestion("");
            setDiscussionError("");
          }}
        >
          <article className="feed-plain-text">
            {selected.original && (
              <>
                <h3>保留原文</h3>
                <p>{selected.original.text}</p>
                {selected.original.textZh && (
                  <>
                    <h3>已有译文</h3>
                    <p>{selected.original.textZh}</p>
                  </>
                )}
                {publicUrl(selected.original.originalUrl) && (
                  <a
                    href={publicUrl(selected.original.originalUrl)!}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    打开原发布页
                  </a>
                )}
                {selected.original.quote && (
                  <blockquote>
                    {selected.original.quote.name} ·{" "}
                    {selected.original.quote.text}
                  </blockquote>
                )}
                {selected.original.mediaUnavailable && <p>原媒体不可用</p>}
              </>
            )}
            {selected.segments.map((segment, index) => (
              <p key={index}>{segment.text}</p>
            ))}
            <details>
              <summary>来源与保留证据</summary>
              {selected.sources.map((source) => (
                <div key={source.id}>
                  <h4>{source.title}</h4>
                  <p>
                    {source.publisher} · {source.publishedAt || "发布时间未知"}
                  </p>
                  <p>{source.excerpt}</p>
                  {publicUrl(source.url) && (
                    <a
                      href={publicUrl(source.url)!}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      打开原文
                    </a>
                  )}
                </div>
              ))}
              {selected.sourceEvidence && (
                <p>
                  来源 {selected.sourceEvidence.sourceRevision} · 原页{" "}
                  {selected.sourceEvidence.pageId} ·{" "}
                  {selected.sourceEvidence.contentImmutable
                    ? "保留内容不可变"
                    : "状态待核对"}
                  <button
                    disabled={busy}
                    onClick={() =>
                      void original(selected.sourceEvidence!.pageId)
                    }
                  >
                    下载保留原页
                  </button>
                </p>
              )}
            </details>
            {selected.media.map(
              (media, index) =>
                publicUrl(media.url) && (
                  <p key={index}>
                    <a
                      href={publicUrl(media.url)!}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      明确打开{media.type === "video" ? "原视频" : "原图片"} ·{" "}
                      {media.alt || "媒体"}
                    </a>
                  </p>
                ),
            )}
            <h3>仅此帖讨论</h3>
            {discussionError && <p role="alert">{discussionError}</p>}
            {messages.map((message) => (
              <div key={message.id}>
                <strong>
                  {message.role === "assistant" ? "帖子讨论回复" : "本人"}
                </strong>
                <p>{message.text}</p>
                <small>{message.createdAt}</small>
              </div>
            ))}
            {!data?.capabilities?.discussion &&
              !modelTargets.some(
                (target) => target.purpose === "feed.discussion",
              ) && <p>帖子讨论模型当前未明确可用；不会生成占位回复</p>}
            <button disabled={busy} onClick={() => void readTargets()}>
              读取已安装帖子回复模型
            </button>
            <label>
              帖子回复来源
              <select
                value={modelTarget}
                disabled={disabled}
                onChange={(event) => setModelTarget(event.target.value)}
              >
                <option value="">不请求模型回复（仅保存本人消息）</option>
                {modelTargets
                  .filter((target) => target.purpose === "feed.discussion")
                  .map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name || target.model || target.id} ·{" "}
                      {target.provider || "来源"} ·{" "}
                      {target.licenseRevision || "许可待核对"}
                    </option>
                  ))}
              </select>
            </label>
            <textarea
              value={question}
              maxLength={2000}
              disabled={disabled}
              onChange={(e) => setQuestion(e.target.value)}
              aria-label="对此帖的讨论内容"
            />
            <button
              disabled={
                disabled || !question.trim() || (!!modelTarget && sourceBusy)
              }
              onClick={() =>
                void mutate(
                  "/posts/" + encodeURIComponent(selected.id) + "/discussion",
                  "POST",
                  {
                    text: question,
                    ...(modelTarget ? { modelTargetId: modelTarget } : {}),
                  },
                )
              }
            >
              {modelTarget ? "明确请求此帖回复" : "保存本人帖子讨论"}
            </button>
            <button disabled={busy} onClick={() => void readDiscussion()}>
              读取已有讨论
            </button>
          </article>
        </Dialog>
      )}
    </section>
  );
}
function ModeFields({
  mode,
  people,
  disabled,
  onMode,
  onPeople,
}: {
  mode: string;
  people: string[];
  disabled: boolean;
  onMode: (value: string) => void;
  onPeople: (value: string[]) => void;
}) {
  return (
    <>
      <label>
        模式
        <select
          value={mode}
          disabled={disabled}
          onChange={(e) => onMode(e.target.value)}
        >
          <option value="news">文章动态</option>
          <option value="people">人物原文</option>
        </select>
      </label>
      {mode === "people" &&
        [
          ["trump", "特朗普"],
          ["duan", "段永平"],
        ].map(([id, label]) => (
          <label key={id}>
            <input
              type="checkbox"
              checked={people.includes(id)}
              disabled={disabled}
              onChange={(e) =>
                onPeople(
                  e.target.checked
                    ? [...people, id]
                    : people.filter((value) => value !== id),
                )
              }
            />
            {label}
          </label>
        ))}
    </>
  );
}
function JobView({
  job,
  busy,
  onRead,
  onCancel,
  cancelBlocked,
  onOriginal,
  onQuery,
}: {
  job: Job;
  busy: boolean;
  onRead: () => void;
  onCancel?: () => void;
  cancelBlocked?: boolean;
  onOriginal?: (id: string) => void;
  onQuery?: () => void;
}) {
  return (
    <article className="feed-job">
      <strong>
        {job.kind === "source_test"
          ? "订阅测试 · "
          : job.kind === "discussion"
            ? "帖子回复 · "
            : ""}
        {jobLabel(job.state || job.status || "unknown")}
      </strong>
      <span>
        {" "}
        · {job.id} · {job.updatedAt || job.createdAt || "时间未知"}
      </span>
      {job.added !== undefined && <p>已新增 {job.added} 篇</p>}
      {(job.error || job.errorCode) && (
        <p role="alert">{job.error || job.errorCode}</p>
      )}
      {job.sources?.map((source) => (
        <p key={source.targetId}>
          {source.targetId} · {jobLabel(source.state)} · {source.reason || ""}
          {source.count !== undefined && ` · 读取 ${source.count} 条`}
          {source.added !== undefined && ` · 新增 ${source.added} 篇`}
          {source.coverage && (
            <small>
              来源条目 {source.coverage.sourceItemCount} · 已处理{" "}
              {source.coverage.processedItems} · 跳过{" "}
              {source.coverage.skippedItems}
              {source.coverage.partial ? " · 范围未完整" : ""}
            </small>
          )}
          {source.rawSha256 && (
            <small>
              原页 {source.pageId} · SHA-256 {source.rawSha256}
              {source.pageId && onOriginal && (
                <button
                  disabled={busy}
                  onClick={() => onOriginal(source.pageId!)}
                >
                  下载保留原页
                </button>
              )}
            </small>
          )}
        </p>
      ))}
      <button disabled={busy} onClick={onRead}>
        读取本次任务
      </button>
      {job.requestId && <small>原请求 {job.requestId}</small>}
      {onQuery && (
        <button disabled={busy} onClick={onQuery}>
          核对原UUID
        </button>
      )}
      {onCancel &&
        ["queued", "running", "searching", "writing"].includes(
          job.state || job.status || "",
        ) && (
          <button disabled={busy || cancelBlocked} onClick={onCancel}>
            取消此任务（不新建外呼）
          </button>
        )}
    </article>
  );
}
function OperationDetails({ value }: { value: unknown }) {
  return (
    <details>
      <summary>来源测试结果</summary>
      {value && typeof value === "object" ? (
        Object.entries(value)
          .filter(
            ([, item]) =>
              typeof item === "string" ||
              typeof item === "number" ||
              typeof item === "boolean" ||
              item === null,
          )
          .map(([key, item]) => (
            <p key={key}>
              {key} · {item === null ? "未知" : String(item)}
            </p>
          ))
      ) : (
        <p>结果待核对</p>
      )}
    </details>
  );
}

function AgentImage({ src, large = false }: { src: string; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return failed ? (
    <span role="status">形象原图暂不可读</span>
  ) : (
    <img
      className={large ? "feed-profile-image" : undefined}
      src={src}
      alt="本人动态形象"
      onError={() => setFailed(true)}
    />
  );
}
