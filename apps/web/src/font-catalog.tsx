import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { requestId } from "./request-id";
import { SelectMenu } from "./select-menu";
import { resourceSize } from "./resource-state";
import { sourceReadFailure, sourceWindowLabel } from "./source-window-view";
import { fontOperationId } from "./personal-font-state";
import type { FontGrantOption } from "./font-source-state";
import {
  catalogStatus,
  fontCatalogSources,
  fontCatalogHistory,
  fontCatalogPage,
  fontCatalogReceipt,
  readFontCatalogRequest,
  retainFontCatalogRequest,
  releaseFontCatalogRequest,
  clearFontCatalogRequest,
  type CatalogSource,
  type FontCatalogSummary,
  type FontCatalogPage,
  type FontCatalogReceipt,
} from "./font-catalog-state";
import "./font-catalog.css";
const base = "/personal-font-import";
type Props = {
  session: Session;
  active: boolean;
  blocked: boolean;
  options: FontGrantOption[];
  onRegister: (path: string, data: Record<string, unknown>) => void;
  onDenied: (reason: unknown) => void;
};
export function FontCatalogPanel(props: Props) {
  if (props.session.user.role !== "admin") return null;
  return (
    <CatalogSession
      key={JSON.stringify([
        props.session.instance_id,
        props.session.user.id,
        props.session.user.role,
        props.session.receipt_scope,
        props.session.csrf,
        props.session.expires_at,
      ])}
      {...props}
    />
  );
}
function CatalogSession({
  session,
  active,
  blocked,
  options,
  onRegister,
  onDenied,
}: Props) {
  const scope = JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  const [open, setOpen] = useState(false),
    [visible, setVisible] = useState(
      typeof document === "undefined" || !document.hidden,
    ),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [journalReady, setJournalReady] = useState(false),
    [locked, setLocked] = useState(false),
    [config, setConfig] = useState("");
  const [sources, setSources] = useState<CatalogSource[]>([]),
    [source, setSource] = useState(""),
    [maximum, setMaximum] = useState("1000"),
    [history, setHistory] = useState<FontCatalogSummary[]>([]),
    [nextHistory, setNextHistory] = useState<string | null>(null),
    [selected, setSelected] = useState(""),
    [page, setPage] = useState<FontCatalogPage | null>(null),
    [ordinal, setOrdinal] = useState<number | null>(null),
    [grant, setGrant] = useState(""),
    [evidence, setEvidence] = useState("");
  const [pending, setPending] = useState<string | null>(null),
    [lookup, setLookup] = useState(""),
    [receipt, setReceipt] = useState<FontCatalogReceipt | null>(null),
    [error, setError] = useState("");
  const binding = useRef(apiSessionSnapshot()),
    live = useRef(false),
    epoch = useRef(0),
    work = useRef<AbortController | null>(null),
    original = useRef<string | null>(null);
  const displayed = useCallback(
    () =>
      apiSessionSnapshot().epoch === binding.current.epoch &&
      apiSessionSnapshot().csrf === session.csrf,
    [session.csrf],
  );
  const pause = useCallback(() => {
    live.current = false;
    ++epoch.current;
    work.current?.abort();
    work.current = null;
    setPage(null);
    setHistory([]);
    setSources([]);
    setReceipt(null);
    setReady(false);
    setBusy(false);
    setOrdinal(null);
    if (!displayed()) {
      try {
        clearFontCatalogRequest(sessionStorage);
      } catch {}
      original.current = null;
      setPending(null);
      setLookup("");
    }
  }, [displayed]);
  const fail = useCallback(
    (reason: unknown) => {
      if (
        !displayed() ||
        (reason instanceof ApiError &&
          ([401, 403].includes(reason.status) ||
            reason.code === "session_changed"))
      ) {
        pause();
        setLocked(true);
        onDenied(reason);
      }
      setError(
        sourceReadFailure(reason instanceof Error ? reason.message : undefined),
      );
    },
    [displayed, onDenied, pause],
  );
  useLayoutEffect(() => {
    live.current = active && open && visible && !locked && displayed();
    return pause;
  }, [active, open, visible, locked, displayed, pause]);
  useEffect(() => {
    const f = () => {
      if (document.hidden) pause();
      setVisible(!document.hidden);
    };
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, [pause]);
  useEffect(() => {
    if (!live.current || !displayed()) return;
    try {
      const id = readFontCatalogRequest(sessionStorage, scope);
      original.current = id;
      setPending(id);
      if (id) setLookup(id);
      setJournalReady(true);
    } catch (reason) {
      setJournalReady(false);
      setLocked(true);
      fail(reason);
    }
  }, [active, open, visible, locked, scope, displayed, fail]);
  const load = useCallback(
    async (after?: string) => {
      if (!live.current || !displayed() || work.current) return;
      const generation = epoch.current,
        controller = new AbortController();
      work.current = controller;
      setBusy(true);
      setReady(false);
      try {
        const values = await Promise.allSettled([
          api<unknown>(base + "/catalog-sources", {
            signal: controller.signal,
          }),
          api<unknown>(base + "/catalogs" + (after ? "?after=" + after : ""), {
            signal: controller.signal,
          }),
        ]);
        if (
          !live.current ||
          !displayed() ||
          generation !== epoch.current ||
          controller.signal.aborted
        )
          return;
        for (const value of values)
          if (value.status === "rejected") throw value.reason;
        const s = fontCatalogSources(
            (values[0] as PromiseFulfilledResult<unknown>).value,
          ),
          h = fontCatalogHistory(
            (values[1] as PromiseFulfilledResult<unknown>).value,
          );
        setSources(s.items);
        setConfig(s.configuration.state);
        setHistory(h.items);
        setNextHistory(h.nextAfter);
        setPage(null);
        setOrdinal(null);
        setReady(true);
        setError("");
      } catch (reason) {
        if (
          live.current &&
          generation === epoch.current &&
          !controller.signal.aborted
        )
          fail(reason);
      } finally {
        if (work.current === controller) {
          work.current = null;
          if (generation === epoch.current) setBusy(false);
        }
      }
    },
    [displayed, fail],
  );
  useEffect(() => {
    if (active && open && visible && !locked) void load();
  }, [active, open, visible, locked, load]);
  async function readPage(id: string, after = -1) {
    if (!fontOperationId(id) || !live.current || !displayed() || work.current)
      return;
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    setPage(null);
    setOrdinal(null);
    try {
      const value = fontCatalogPage(
        await api<unknown>(base + "/catalogs/" + id + "?after=" + after, {
          signal: controller.signal,
        }),
      );
      if (live.current && displayed() && generation === epoch.current) {
        setPage(value);
        setSelected(id);
        setGrant("");
        setError("");
      }
    } catch (reason) {
      if (
        live.current &&
        generation === epoch.current &&
        !controller.signal.aborted
      )
        fail(reason);
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (generation === epoch.current) setBusy(false);
      }
    }
  }
  function known(raw: unknown, id: string) {
    const value = fontCatalogReceipt(raw, id);
    setReceipt(value);
    setLookup(id);
    setError("");
    if (value.state !== "reading" && original.current === id) {
      releaseFontCatalogRequest(sessionStorage, scope, id);
      original.current = null;
      setPending(null);
    }
    if (value.state === "completed" && value.catalogId) {
      setSelected(value.catalogId);
      setPage(null);
    }
  }
  async function capture() {
    if (
      !live.current ||
      !displayed() ||
      work.current ||
      original.current ||
      blocked ||
      !journalReady ||
      !ready ||
      !sources.some((s) => s.sourceAlias === source)
    )
      return;
    const id = requestId();
    try {
      retainFontCatalogRequest(sessionStorage, scope, id);
    } catch (reason) {
      fail(reason);
      return;
    }
    original.current = id;
    setPending(id);
    setLookup(id);
    setReceipt(null);
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    try {
      const raw = await api<unknown>(
        base + "/catalogs",
        {
          method: "POST",
          body: JSON.stringify({
            requestId: id,
            sourceAlias: source,
            maxEntries: Number(maximum),
          }),
          signal: controller.signal,
        },
        session.csrf,
      );
      if (live.current && displayed() && generation === epoch.current)
        known(raw, id);
    } catch (reason) {
      if (
        live.current &&
        generation === epoch.current &&
        !controller.signal.aborted
      )
        fail(reason);
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (generation === epoch.current) {
          setBusy(false);
          void load();
        }
      }
    }
  }
  async function query(close = false) {
    const id = original.current ?? lookup.trim();
    if (!fontOperationId(id) || !live.current || !displayed() || work.current)
      return;
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    try {
      const raw = await api<unknown>(
        base + "/catalog-operations/" + id + (close ? "/close" : ""),
        {
          ...(close
            ? {
                method: "POST",
                body: JSON.stringify({ expectedKind: "catalog" }),
              }
            : {}),
          signal: controller.signal,
        },
        close ? session.csrf : undefined,
      );
      if (live.current && displayed() && generation === epoch.current)
        known(raw, id);
    } catch (reason) {
      if (
        live.current &&
        generation === epoch.current &&
        !controller.signal.aborted
      ) {
        fail(reason);
        if (reason instanceof ApiError && reason.status === 404)
          setError("尚未查到原目录操作，可继续查询或显式关闭");
      }
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (generation === epoch.current) setBusy(false);
      }
    }
  }
  const disabled = !active || !open || !visible || locked || busy || !ready,
    chosen = page?.items.find((e) => e.ordinal === ordinal),
    grantOptions = options.filter((g) => g.sourceAlias === page?.sourceAlias),
    chosenGrant = grantOptions.find((g) => g.grantId === grant),
    chosenSource = sources.find((s) => s.sourceAlias === source);
  return (
    <details
      className="font-catalog-panel"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>来源目录清单</summary>
      {open && (
        <div className="font-catalog-body">
          <button
            type="button"
            disabled={!active || !visible || busy}
            onClick={() => {
              if (locked) {
                setLocked(false);
                setJournalReady(false);
              } else void load();
            }}
          >
            重新读取目录状态
          </button>
          {error && <p role="alert">{error}</p>}
          {config === "not_configured" && <p>尚未配置旧字体来源</p>}
          {config === "unavailable" && <p>旧字体来源配置不可用</p>}
          <SelectMenu
            label="已登记字体来源"
            value={source}
            options={[
              { value: "", label: "选择来源" },
              ...sources.map((s) => ({
                value: s.sourceAlias,
                label: s.sourceAlias,
              })),
            ]}
            disabled={disabled || blocked || !!pending}
            variant="field"
            onChange={setSource}
          />
          {chosenSource && <p>{sourceWindowLabel(chosenSource.window)}</p>}
          <SelectMenu
            label="读取上限"
            value={maximum}
            options={[
              { value: "1000", label: "1000 项" },
              { value: "5000", label: "5000 项" },
            ]}
            disabled={disabled || blocked || !!pending}
            variant="field"
            onChange={setMaximum}
          />
          <button
            type="button"
            disabled={
              disabled ||
              blocked ||
              !!pending ||
              !journalReady ||
              chosenSource?.window.state !== "active"
            }
            onClick={() => void capture()}
          >
            读取目录清单
          </button>
          <SelectMenu
            label="已保存目录清单"
            value={selected}
            options={[
              { value: "", label: "选择目录清单" },
              ...history.map((h) => ({
                value: h.id,
                label: h.sourceAlias + " · " + h.counts.knownItems + " 项",
              })),
            ]}
            disabled={disabled}
            variant="field"
            onChange={(v) => {
              setSelected(v);
              setPage(null);
              setOrdinal(null);
            }}
          />
          <div>
            <button
              type="button"
              disabled={disabled || !fontOperationId(selected)}
              onClick={() => void readPage(selected)}
            >
              查看清单
            </button>
            <button
              type="button"
              disabled={disabled || !nextHistory}
              onClick={() => void load(nextHistory!)}
            >
              更早清单
            </button>
          </div>
          {page && (
            <>
              <p>
                文件 {page.counts.knownItems} · 未分配 {page.counts.unassigned}{" "}
                · 待本人确认 {page.counts.pendingConfirmation} · 已归档{" "}
                {page.counts.archived} · 已映射 {page.counts.mapped}
              </p>
              {page.truncated && (
                <p role="status">目录已截断，仅列出已读取项</p>
              )}
              {page.changed && <p role="status">目录在读取期间发生变化</p>}
              {page.ignored > 0 && <p>已跳过 {page.ignored} 个非字体目录项</p>}
              {page.instanceReenrollmentRequired && (
                <p>此恢复清单尚未在本实例重新登记取数权限</p>
              )}
              <ol className="font-catalog-items">
                {page.items.map((item) => (
                  <li key={item.ordinal}>
                    <span className="font-catalog-id">{item.originalId}</span>
                    <span>
                      {item.size === null
                        ? "大小未知"
                        : resourceSize(item.size)}
                    </span>
                    <p>{catalogStatus(item)}</p>
                    {item.metadataState === "candidate" &&
                      item.assignmentState === "unassigned" && (
                        <button
                          type="button"
                          disabled={
                            disabled ||
                            blocked ||
                            page.instanceReenrollmentRequired
                          }
                          onClick={() => {
                            setOrdinal(item.ordinal);
                            setEvidence("");
                          }}
                        >
                          选择登记
                        </button>
                      )}
                  </li>
                ))}
              </ol>
              {page.nextAfter !== null && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void readPage(page.id, page.nextAfter!)}
                >
                  下一段目录项
                </button>
              )}
              {chosen && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (chosenGrant && !blocked)
                      onRegister(
                        "/catalogs/" +
                          page.id +
                          "/entries/" +
                          chosen.ordinal +
                          "/registrations",
                        {
                          grantId: chosenGrant.grantId,
                          grantRevision: chosenGrant.grantRevision,
                          evidenceRef: evidence.trim(),
                        },
                      );
                  }}
                >
                  <p className="font-catalog-id">{chosen.originalId}</p>
                  <SelectMenu
                    label="来源账号与目标"
                    value={grant}
                    options={[
                      { value: "", label: "选择已授权来源账号" },
                      ...grantOptions.map((g) => ({
                        value: g.grantId,
                        label: g.sourceOwner + " · " + g.username,
                      })),
                    ]}
                    disabled={disabled || blocked}
                    variant="field"
                    onChange={setGrant}
                  />
                  <label>
                    归属凭据
                    <input
                      value={evidence}
                      maxLength={128}
                      disabled={disabled || blocked}
                      onChange={(e) => setEvidence(e.target.value)}
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={
                      disabled || blocked || !chosenGrant || !evidence.trim()
                    }
                  >
                    登记待本人确认
                  </button>
                </form>
              )}
            </>
          )}
          {receipt && (
            <p role="status">
              {receipt.state === "reading"
                ? "原目录操作处理中"
                : receipt.state === "completed"
                  ? "目录清单已保存，字体原件尚未读取"
                  : receipt.canceled
                    ? "原目录操作已关闭"
                    : sourceReadFailure(receipt.message ?? receipt.reason)}
            </p>
          )}
          <label>
            原目录操作编号
            <input
              value={pending ?? lookup}
              disabled={busy || !!pending}
              spellCheck={false}
              onChange={(e) => setLookup(e.target.value)}
            />
          </label>
          <div>
            <button
              type="button"
              disabled={
                !active ||
                !visible ||
                locked ||
                busy ||
                !fontOperationId(pending ?? lookup.trim())
              }
              onClick={() => void query()}
            >
              查询原目录操作
            </button>
            <button
              type="button"
              disabled={
                !active ||
                !visible ||
                locked ||
                busy ||
                !fontOperationId(pending ?? lookup.trim())
              }
              onClick={() => void query(true)}
            >
              关闭原目录操作
            </button>
          </div>
        </div>
      )}
    </details>
  );
}
