import { memo, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Ellipsis,
  FileText,
  PlayCircle,
  Image,
  Info,
  RefreshCw,
  Users,
} from "lucide-react";
import { api, ApiError, type Session } from "./api";
import { Dialog } from "./dialog";
import { WorkspaceEmpty } from "./workspace-ui";
import { feedDateTime } from "./feed-display";
import "./feed.css";
import "./public-people-feed.css";
export type PublicPost = {
  id: string;
  date: string | null;
  text: string;
  textZh?: string;
  originalUrl: string;
  author: "trump" | "duan";
  replyTo?: string;
  quote?: { name: string; text: string; url?: string; images?: string[] };
  images?: string[];
  media?: { type: "image" | "video"; url: string; alt?: string }[];
  comments?: {
    id: string;
    name: string;
    createdAt: string;
    text: string;
    likes?: number;
    replyTo?: string;
  }[];
  sourceEvidence: {
    sourceRevision: string;
    pageId: string;
    licenseRevision: string;
  };
};
type Payload = {
  state: "observed" | "partial" | "unavailable";
  posts: PublicPost[];
  nextCursor: string | null;
  updatedAt: string | number | null;
  updatedByAuthor: Partial<Record<"trump" | "duan", string | number | null>>;
  collectionOnRead: false;
  refreshing: false;
};
const people = [
  { id: "all", name: "全部动态" },
  { id: "trump", name: "特朗普" },
  { id: "duan", name: "段永平" },
] as const;
const personName = (author: string) =>
  people.find((person) => person.id === author)?.name || author;
function external(raw: string | undefined) {
  try {
    const value = new URL(raw || "");
    return ["https:", "http:"].includes(value.protocol) &&
      !value.username &&
      !value.password
      ? value.href
      : null;
  } catch {
    return null;
  }
}
function actualTime(raw: string | number | null | undefined) {
  if (typeof raw !== "number") return feedDateTime(raw);
  const value = new Date(raw);
  return Number.isFinite(value.getTime())
    ? feedDateTime(value.toISOString())
    : "时间未知";
}
export function PublicPeopleFeed({
  session,
  active,
  expanded = false,
}: {
  session: Session;
  active: boolean;
  expanded?: boolean;
}) {
  return (
    <Panel
      key={JSON.stringify([
        session.instance_id,
        session.user.id,
        session.user.role,
        session.receipt_scope,
        session.csrf,
        session.expires_at,
      ])}
      active={active}
      expanded={expanded}
    />
  );
}
function Panel({ active, expanded }: { active: boolean; expanded: boolean }) {
  const [open, setOpen] = useState(expanded),
    [author, setAuthor] = useState("all"),
    [data, setData] = useState<Payload | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sources, setSources] = useState(false),
    [cursors, setCursors] = useState<(string | null)[]>([null]);
  const list = useRef<HTMLDivElement>(null);
  const epoch = useRef(0),
    live = useRef(false),
    controller = useRef<AbortController | null>(null);
  function clear() {
    epoch.current++;
    controller.current?.abort();
    setData(null);
    setBusy(false);
    setSources(false);
    setCursors([null]);
  }
  useEffect(() => {
    live.current = active && (expanded || open);
    if (live.current && !document.hidden) void read();
    else clear();
    const visibility = () => {
      if (document.hidden) clear();
      else if (live.current) void read();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      live.current = false;
      epoch.current++;
      controller.current?.abort();
      setBusy(false);
      setData(null);
      setSources(false);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [active, expanded, open, author]);
  async function read(direction: "refresh" | "older" | "newer" = "refresh") {
    if (busy || !live.current || document.hidden) return;
    const trigger = document.activeElement;
    const cursor =
      direction === "older"
        ? data?.nextCursor
        : direction === "newer"
          ? cursors[cursors.length - 2]
          : cursors[cursors.length - 1];
    if (
      (direction === "older" && !cursor) ||
      (direction === "newer" && cursors.length < 2)
    )
      return;
    const run = ++epoch.current,
      c = new AbortController();
    controller.current?.abort();
    controller.current = c;
    setBusy(true);
    setError("");
    const params = new URLSearchParams({
      limit: "30",
      ...(author !== "all" ? { author } : {}),
      ...(cursor ? { cursor } : {}),
    });
    try {
      const value = await api<Payload>("/public-square?" + params, {
        signal: c.signal,
      });
      if (
        !live.current ||
        run !== epoch.current ||
        c.signal.aborted ||
        document.hidden
      )
        return;
      if (
        !["observed", "partial", "unavailable"].includes(value.state) ||
        value.collectionOnRead !== false ||
        !Array.isArray(value.posts) ||
        value.posts.some((post) => !["trump", "duan"].includes(post.author))
      )
        throw new Error("公开人物动态范围待核对");
      // Every page is a newly verified public projection. Do not retain a prior page's
      // translations or content after its display permission may have changed.
      setData(
        value.state === "unavailable"
          ? { ...value, posts: [], nextCursor: null }
          : value,
      );
      if (direction === "older")
        setCursors((previous) => [...previous, cursor!]);
      else if (direction === "newer")
        setCursors((previous) => previous.slice(0, -1));
      if (direction !== "refresh")
        requestAnimationFrame(() => {
          if (live.current && run === epoch.current) {
            list.current?.scrollIntoView({ block: "start", behavior: "auto" });
            list.current?.focus({ preventScroll: true });
          }
        });
    } catch (reason) {
      if (!c.signal.aborted && run === epoch.current) {
        if (reason instanceof ApiError && [401, 403].includes(reason.status))
          clear();
        setError(
          reason instanceof Error ? reason.message : "公开人物动态暂不可用",
        );
      }
    } finally {
      if (run === epoch.current) {
        setBusy(false);
        if (direction === "refresh")
          requestAnimationFrame(() => {
            if (
              live.current &&
              run === epoch.current &&
              document.activeElement === document.body &&
              trigger instanceof HTMLElement &&
              trigger.isConnected &&
              trigger.getClientRects().length &&
              !trigger.matches(":disabled")
            )
              trigger.focus({ preventScroll: true });
          });
      }
    }
  }
  const content = (
    <>
      <div className="public-people-toolbar">
        <nav className="public-people-filter" aria-label="人物筛选">
          {people.map((person) => (
            <button
              type="button"
              key={person.id}
              aria-label={person.name}
              aria-pressed={author === person.id}
              disabled={!active}
              onClick={() => {
                if (author === person.id) return;
                clear();
                setError("");
                setAuthor(person.id);
              }}
            >
              <span className="public-person-avatar" aria-hidden="true">
                {person.id === "all" ? (
                  <Users size={25} />
                ) : (
                  person.name.slice(0, 1)
                )}
              </span>
              <span>{person.name}</span>
            </button>
          ))}
        </nav>
        <div className="feed-header-actions">
          <button
            type="button"
            className="icon-button"
            disabled={busy || !active || !(expanded || open)}
            aria-label="刷新已保留公开原帖"
            title="刷新已保留公开原帖"
            aria-busy={busy}
            onClick={() => void read()}
          >
            <RefreshCw size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="公开来源信息"
            title="公开来源信息"
            disabled={!data || !active}
            onClick={() => setSources(true)}
          >
            <Info size={18} />
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && (
        <div className="public-people-loading" role="status">
          <i />
          <i />
          <span className="sr-only">正在读取公开原帖…</span>
        </div>
      )}
      {data?.state === "partial" && (
        <p className="public-people-status" role="status">
          当前只展示部分已授权来源
        </p>
      )}
      {data?.state === "unavailable" ? (
        <WorkspaceEmpty
          title="公开原帖暂不可用"
          description="当前没有获准展示的已保留来源。"
        />
      ) : data && !data.posts.length ? (
        <WorkspaceEmpty title="暂无符合筛选的原帖" />
      ) : null}
      <div
        ref={list}
        tabIndex={-1}
        className="public-people-posts"
        role="feed"
        aria-label="公开人物原帖"
        aria-busy={busy}
      >
        {data?.posts.map((post) => (
          <PublicOriginalPost key={post.author + ":" + post.id} post={post} />
        ))}
      </div>
      {data && (data.nextCursor || cursors.length > 1) && (
        <div className="public-people-pagination">
          <button
            type="button"
            disabled={busy || cursors.length < 2}
            onClick={() => void read("newer")}
          >
            较新原帖
          </button>
          <span className="muted">第{cursors.length}页</span>
          <button
            type="button"
            disabled={busy || !data.nextCursor}
            onClick={() => void read("older")}
          >
            {busy ? "正在读取…" : "更早原帖"}
          </button>
        </div>
      )}
      {sources && data && (
        <Dialog
          title="公开来源信息"
          className="feed-dialog"
          onClose={() => setSources(false)}
        >
          <div className="feed-fields">
            <p className="muted">
              仅展示已登记且获准公开的原页，保留范围可能不是完整历史。
            </p>
            <dl className="public-source-proof">
              <dt>快照观察</dt>
              <dd>{actualTime(data.updatedAt)}</dd>
              {(["trump", "duan"] as const)
                .filter((person) => author === "all" || person === author)
                .map((person) => (
                  <div key={person}>
                    <dt>{personName(person)}</dt>
                    <dd>{actualTime(data.updatedByAuthor[person])}</dd>
                  </div>
                ))}
            </dl>
          </div>
        </Dialog>
      )}
    </>
  );
  return expanded ? (
    <section className="public-people-panel" aria-label="公开人物原帖">
      {content}
    </section>
  ) : (
    <details
      className="public-people-panel"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>公开人物原帖</summary>
      {open && content}
    </details>
  );
}
function MediaLinks({
  images,
  media,
  label,
}: {
  images: string[] | undefined;
  media?: PublicPost["media"];
  label: string;
}) {
  const items = [
    ...(images || []).map((url) => ({ type: "image", url })),
    ...(media || []),
  ].filter(
    (item, index, all) =>
      external(item.url) &&
      all.findIndex((prior) => prior.url === item.url) === index,
  );
  return items.length ? (
    <div className="public-media-links">
      {items.map((item, index) => (
        <a
          key={item.url}
          href={external(item.url)!}
          target="_blank"
          rel="noreferrer noopener"
        >
          {item.type === "video" ? (
            <PlayCircle size={17} aria-hidden="true" />
          ) : (
            <Image size={17} aria-hidden="true" />
          )}
          <span>
            {item.type === "video" ? "查看原视频" : label} {index + 1}
          </span>
          <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      ))}
    </div>
  ) : null;
}
export const PublicOriginalPost = memo(function PublicOriginalPost({
  post,
}: {
  post: PublicPost;
}) {
  const [original, setOriginal] = useState(false),
    [sourceOpen, setSourceOpen] = useState(false);
  const primary = original ? post.text : post.textZh || post.text;
  return (
    <article
      className="feed-post public-original-post"
      aria-label={`${personName(post.author)}的公开原帖`}
    >
      <div className="public-person-avatar" aria-hidden="true">
        {personName(post.author).slice(0, 1)}
      </div>
      <div className="feed-post-content">
        <div className="public-original-heading">
          <div>
            <strong>{personName(post.author)}</strong>
            <span>
              {post.author === "trump" ? "@realDonaldTrump" : "@slowisquick"}
            </span>
            <time
              dateTime={post.date || undefined}
              title={post.date || undefined}
            >
              {actualTime(post.date)}
            </time>
          </div>
          <button
            type="button"
            className="feed-more"
            aria-label={`查看${personName(post.author)}原帖来源`}
            onClick={() => setSourceOpen(true)}
          >
            <Ellipsis size={19} />
          </button>
        </div>
        {post.replyTo && (
          <p className="public-original-context">回复 @{post.replyTo}</p>
        )}
        <p className="feed-plain-text">{primary}</p>
        <MediaLinks images={post.images} media={post.media} label="查看原图" />
        {post.quote && (
          <blockquote className="feed-quote">
            <strong>{post.quote.name}</strong>
            <p className="feed-plain-text">{post.quote.text}</p>
            <MediaLinks images={post.quote.images} label="查看引用原图" />
            {external(post.quote.url) && (
              <a
                className="public-original-link"
                href={external(post.quote.url)!}
                target="_blank"
                rel="noreferrer noopener"
              >
                查看引用原帖
                <ArrowUpRight size={14} />
              </a>
            )}
          </blockquote>
        )}
        <div className="public-original-links">
          {post.textZh && (
            <button
              type="button"
              aria-pressed={original}
              onClick={() => setOriginal((value) => !value)}
            >
              {original ? "中文译文" : "查看原文"}
            </button>
          )}
          {external(post.originalUrl) && (
            <a
              href={external(post.originalUrl)!}
              target="_blank"
              rel="noreferrer noopener"
            >
              打开原帖
              <ArrowUpRight size={14} />
            </a>
          )}
        </div>
        {!!post.comments?.length && (
          <details className="public-original-comments">
            <summary>公开评论 · {post.comments.length}条</summary>
            <p className="muted">已保留的评论，不代表全部评论。</p>
            {post.comments.map((comment) => (
              <div className="public-original-comment" key={comment.id}>
                <div>
                  <strong>{comment.name}</strong>
                  <time dateTime={comment.createdAt} title={comment.createdAt}>
                    {actualTime(comment.createdAt)}
                  </time>
                </div>
                {comment.replyTo && (
                  <p className="public-original-context">
                    回复 @{comment.replyTo}
                  </p>
                )}
                <p className="feed-plain-text">{comment.text}</p>
                {comment.likes !== undefined && (
                  <small>来源观察赞数 {comment.likes}</small>
                )}
              </div>
            ))}
          </details>
        )}
        {sourceOpen && (
          <Dialog
            title="原帖来源"
            className="feed-dialog"
            onClose={() => setSourceOpen(false)}
          >
            <div className="feed-fields">
              <div className="public-proof-title">
                <FileText size={20} />
                <strong>
                  {personName(post.author)} · {actualTime(post.date)}
                </strong>
              </div>
              <dl className="public-source-proof">
                <dt>来源版本</dt>
                <dd>{post.sourceEvidence.sourceRevision}</dd>
                <dt>保留原页</dt>
                <dd>{post.sourceEvidence.pageId}</dd>
                <dt>公开展示许可</dt>
                <dd>{post.sourceEvidence.licenseRevision}</dd>
              </dl>
            </div>
          </Dialog>
        )}
      </div>
    </article>
  );
});
