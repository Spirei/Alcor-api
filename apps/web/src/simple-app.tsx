import { requestResponse } from "./api-response.ts";
import {
  ArrowLeft,
  ArrowUpRight,
  Code2,
  Files,
  MoreHorizontal,
  Moon,
  RefreshCw,
  Sun,
} from "lucide-react";
import { LoadingPlaceholder } from "./loading-placeholder";
import { SelectMenu } from "./select-menu";
import { useConfirmationDialog } from "./confirm-dialog";
import { ledgerSection } from "./simple-app-view-model";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { requestId } from "./request-id";
import { SimplePages } from "./simple-app-pages";
import { SimpleLedgerNavigation } from "./simple-app-navigation";
import { SimpleBenchmark } from "./simple-app-benchmark";
import {
  decode,
  encode,
  object,
  rows,
  text,
  typedPatch,
  revisionToken,
  pages as routeNames,
  SourceNumber,
  type Row,
  type Page,
} from "./simple-app-model";
import "./simple-app.css";
const base = "/api/account/simple-ledger";
function initialRoute() {
  const query =
      typeof window === "undefined"
        ? new URLSearchParams()
        : new URLSearchParams(window.location.search),
    name = query.get("page");
  const context: Row = {};
  for (const [key, param] of [
    ["cat", "cat"],
    ["itemId", "item"],
    ["account", "account"],
    ["summaryId", "summary"],
    ["group", "group"],
  ]) {
    const value = query.get(param);
    if (value && value.length < 200) context[key] = value;
  }
  return {
    page: routeNames.includes(name as Page) ? (name as Page) : ("home" as Page),
    context,
  };
}

export function SimpleApp({
  session,
  active = true,
}: {
  session: Session;
  active?: boolean;
}) {
  return (
    <SimpleAppEditor
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
function SimpleAppEditor({
  session,
  active,
}: {
  session: Session;
  active: boolean;
}) {
  const navigate = useNavigate();
  const [ledger, setLedger] = useState<Row | null>(null),
    [revision, setRevision] = useState<string | null>(null),
    [saved, setSaved] = useState(""),
    [page, setPage] = useState<Page>(() => initialRoute().page),
    [context, setContext] = useState<Row>(() => initialRoute().context),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState<string | null>(null),
    [locked, setLocked] = useState(false),
    [remoteChanged, setRemoteChanged] = useState(false),
    [syncUnavailable, setSyncUnavailable] = useState(false),
    [localTheme, setLocalTheme] = useState<"light" | "dark">(() => {
      try {
        return localStorage.getItem("alcor-simple-theme") === "dark"
          ? "dark"
          : "light";
      } catch {
        return "light";
      }
    }),
    [confirm, setConfirm] = useState(false),
    [advanced, setAdvanced] = useState(false),
    [filesOpen, setFilesOpen] = useState(false),
    [formEditing, setFormEditing] = useState(false),
    [filters, setFilters] = useState({
      member: "",
      investment: "",
      archived: false,
    }),
    [advancedDraft, setAdvancedDraft] = useState(""),
    [readGeneration, setReadGeneration] = useState(0),
    [candidate, setCandidate] = useState<Row[]>([]),
    [source, setSource] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [importGroup, setImportGroup] = useState(""),
    [exportGroup, setExportGroup] = useState(""),
    [candidateTargets, setCandidateTargets] = useState<Record<string, string>>(
      {},
    );
  const inFlight = useRef(false),
    pendingRef = useRef<string | null>(null),
    epoch = useRef(0),
    controllers = useRef(new Set<AbortController>()),
    alive = useRef(active),
    fileInput = useRef<HTMLInputElement>(null),
    body = useRef<HTMLDivElement>(null),
    scrollPositions = useRef(new Map<string, number>());
  const navigation = useRef<SimpleLedgerNavigation | null>(null);
  const revisionProbe = useRef(false),
    revisionFailures = useRef(0);
  alive.current = active && !locked;
  const storage = JSON.stringify([
    "simple-ledger",
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  const dirty = ledger !== null && encode(ledger) !== saved;
  const editorState = useRef({
    ledger,
    saved,
    revision,
    dirty,
    page,
    context,
    formEditing,
    filesOpen,
  });
  editorState.current = {
    ledger,
    saved,
    revision,
    dirty,
    page,
    context,
    formEditing,
    filesOpen,
  };
  const { ask, dialog } = useConfirmationDialog(
    storage + ":" + active + ":" + locked,
  );
  useEffect(() => {
    try {
      localStorage.setItem("alcor-simple-theme", localTheme);
    } catch {
      /* Appearance preference is optional. */
    }
  }, [localTheme]);
  function forget() {
    epoch.current++;
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    setLedger(null);
    setRevision(null);
    setRemoteChanged(false);
    setSyncUnavailable(false);
    setSaved("");
    setContext({});
    setCandidate([]);
    setSelected([]);
    setCandidateTargets({});
    setSource("");
    setPending(null);
    pendingRef.current = null;
    setImportGroup("");
    setExportGroup("");
    setConfirm(false);
    setAdvanced(false);
    setFilesOpen(false);
    setFilters({ member: "", investment: "", archived: false });
    setAdvancedDraft("");
    setBusy(false);
    inFlight.current = false;
    setError("");
    setNotice("");
    if (fileInput.current) fileInput.current.value = "";
  }
  function remember(id: string | null) {
    if (id) sessionStorage.setItem(storage, id);
    else sessionStorage.removeItem(storage);
    pendingRef.current = id;
    setPending(id);
  }
  const current = (run: number) =>
    alive.current && !document.hidden && epoch.current === run;
  useEffect(() => {
    try {
      const value = sessionStorage.getItem(storage);
      if (value && /^[a-f0-9-]{36}$/i.test(value)) {
        pendingRef.current = value;
        setPending(value);
      }
    } catch {
      setError("浏览器未允许保留原请求编号，保存暂不可用");
      setLocked(true);
    }
    return () => {
      epoch.current++;
      controllers.current.forEach((c) => c.abort());
    };
  }, [storage]);
  function pause() {
    epoch.current++;
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    inFlight.current = false;
    setBusy(false);
    setConfirm(false);
  }
  useEffect(() => {
    if (!active) pause();
    else if (!document.hidden && !locked) {
      if (pendingRef.current) void act("query");
      else void load(true);
    }
    return () => pause();
  }, [active, locked]);
  useEffect(() => {
    const changed = () => {
      if (document.hidden) pause();
      else if (alive.current) {
        if (pendingRef.current) void act("query");
        else if (editorState.current.ledger) void checkRevision();
        else void load(true);
      }
    };
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    const leaving = (event: BeforeUnloadEvent) => {
      const state = editorState.current;
      if (
        state.dirty ||
        state.formEditing ||
        ["addItem", "editItem", "addInvest", "addSummary"].includes(state.page)
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leaving);
    return () => window.removeEventListener("beforeunload", leaving);
  }, []);
  useEffect(() => {
    if (!active || locked) return;
    const timer = window.setInterval(() => void checkRevision(), 15000);
    return () => window.clearInterval(timer);
  }, [active, locked]);
  useEffect(() => {
    const guard = new SimpleLedgerNavigation({
      read: () => ({
        url:
          window.location.pathname +
          window.location.search +
          window.location.hash,
        state: window.history.state,
      }),
      replace: (state, url) => window.history.replaceState(state, "", url),
      push: (state, url) => {
        void navigate(url, { state: state.usr ?? null });
        window.history.replaceState(
          {
            ...window.history.state,
            ...Object.fromEntries(
              Object.entries(state).filter(([key]) =>
                key.startsWith("alcorSimpleLedger"),
              ),
            ),
          },
          "",
          url,
        );
      },
      move: (delta) => window.history.go(delta),
      guarded: (url) =>
        editorState.current.formEditing ||
        (editorState.current.dirty &&
          !["/simple", "/simple-app"].includes(
            new URL(url, window.location.origin).pathname,
          )),
      active: () => alive.current && !document.hidden,
      confirm: () =>
        ask("当前有未保存的修改，放弃并离开当前页面？", {
          title: "离开账本页面",
          confirmLabel: "放弃并离开",
        }),
      apply: () => {
        if (!["/simple", "/simple-app"].includes(window.location.pathname))
          return;
        const next = initialRoute();
        setPage(next.page);
        setContext(next.context);
        setError("");
      },
    });
    navigation.current = guard;
    const changed = (event: PopStateEvent) => {
      if (guard.pop()) event.stopImmediatePropagation();
    };
    window.addEventListener("popstate", changed, true);
    return () => {
      window.removeEventListener("popstate", changed, true);
      guard.dispose();
      if (navigation.current === guard) navigation.current = null;
    };
  }, []);
  useEffect(() => {
    const key = page + ":" + encode(context),
      scroll = body.current;
    if (scroll) scroll.scrollTop = scrollPositions.current.get(key) ?? 0;
    return () => {
      if (scroll) scrollPositions.current.set(key, scroll.scrollTop);
    };
  }, [page, encode(context)]);
  async function request(path: string, init: RequestInit = {}) {
    const controller = new AbortController();
    controllers.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      if (apiSessionSnapshot().csrf !== session.csrf) {
        forget();
        setLocked(true);
        throw Error("当前登录身份已变化");
      }
      const headers = new Headers(init.headers);
      headers.set("x-csrf-token", session.csrf);
      headers.set("x-simple-ledger-user", session.user.id);
      if (typeof init.body === "string")
        headers.set("content-type", "application/json");
      const response = await requestResponse(base + path, {
        ...init,
        headers,
        signal: controller.signal,
        credentials: "same-origin",
        cache: "no-store",
      });
      const raw = await response.text();
      if (
        apiSessionSnapshot().csrf !== session.csrf ||
        response.headers.get("X-Alcor-Session-Changed") === "true"
      ) {
        forget();
        setLocked(true);
        throw Error("当前登录身份已变化");
      }
      if ([401, 403].includes(response.status)) {
        forget();
        setLocked(true);
        throw Error("登录或权限已变化，请重新登录后读取");
      }
      const value = object(decode(raw));
      if (!response.ok && text(value.state) !== "rejected") {
        const detail =
          typeof value.detail === "string"
            ? value.detail
            : text(object(value.error).message) ||
              text(value.error) ||
              "请求未完成";
        if (
          response.status === 409 &&
          detail === "当前账号已切换，请刷新后重试"
        ) {
          forget();
          setLocked(true);
        }
        const failure = Object.assign(Error(detail), {
          status: response.status,
        });
        throw failure;
      }
      return { value, raw, status: response.status };
    } finally {
      clearTimeout(timeout);
      controllers.current.delete(controller);
    }
  }
  function accept(value: Row, id: string) {
    if (text(value.requestId) !== id)
      throw Error("返回编号不一致，请核对原请求");
    const state = text(value.state);
    if (state === "completed") {
      const next = object(value.ledger);
      setReadGeneration((value) => value + 1);
      setAdvanced(false);
      setAdvancedDraft("");
      setLedger(next);
      setSaved(encode(next));
      setRevision(revisionToken(value.revision));
      setRemoteChanged(false);
      setConfirm(false);
      remember(null);
      setNotice("独立账本已保存；未写入券商或实际现金账本");
    } else if (state === "parsed") {
      setCandidate(rows(value.invest));
      setCandidateTargets({});
      setSelected([]);
      setSource(id);
      remember(null);
      setNotice("文件已解析，原件保留；请选择实际要加入的投资账户");
    } else if (state === "closed" || state === "rejected") {
      remember(null);
      setConfirm(false);
      setCandidate([]);
      setSelected([]);
      setCandidateTargets({});
      setSource(state === "rejected" ? id : "");
      setNotice(
        state === "closed"
          ? "原请求已关闭，未执行"
          : "文件未解析成功，原件已保留，账本未改变",
      );
    } else setNotice("结果尚未核实，请只查询或关闭原编号");
  }
  async function load(preserveDraft = false) {
    if (!alive.current || document.hidden || inFlight.current) return;
    inFlight.current = true;
    const run = epoch.current;
    setBusy(true);
    setError("");
    try {
      const { value } = await request("");
      if (current(run)) {
        const next = object(value.ledger);
        const state = editorState.current,
          nextRevision = revisionToken(value.revision);
        if (preserveDraft && state.ledger) {
          if (nextRevision === state.revision) return;
          if (
            state.dirty ||
            state.formEditing ||
            state.filesOpen ||
            [
              "addItem",
              "editItem",
              "addInvest",
              "addSummary",
              "settings",
            ].includes(state.page)
          ) {
            setRemoteChanged(true);
            setConfirm(false);
            setError(
              "其他端已更新账本。当前草稿已保留，请核对后重新读取，避免覆盖其他端的修改。",
            );
            return;
          }
        }
        setReadGeneration((value) => value + 1);
        setAdvanced(false);
        setAdvancedDraft("");
        setLedger(next);
        setSaved(encode(next));
        setRevision(nextRevision);
        setRemoteChanged(false);
        setConfirm(false);
        setNotice("");
      }
    } catch (e) {
      if (current(run)) setError(e instanceof Error ? e.message : "读取失败");
    } finally {
      if (current(run)) {
        setBusy(false);
        inFlight.current = false;
      }
    }
  }
  async function checkRevision() {
    if (
      !alive.current ||
      document.hidden ||
      inFlight.current ||
      revisionProbe.current
    )
      return;
    if (pendingRef.current) {
      void act("query");
      return;
    }
    if (!editorState.current.ledger) return;
    revisionProbe.current = true;
    const run = epoch.current;
    try {
      const { value } = await request("/revision"),
        next = revisionToken(value.revision);
      if (!current(run)) return;
      if (next === null) throw Error("账本版本暂不可核对");
      revisionFailures.current = 0;
      setSyncUnavailable(false);
      if (next !== editorState.current.revision) await load(true);
    } catch {
      if (current(run) && ++revisionFailures.current >= 3)
        setSyncUnavailable(true);
    } finally {
      revisionProbe.current = false;
    }
  }
  async function act(
    action: "save" | "query" | "close" | "import",
    file?: File,
  ) {
    if (!alive.current || inFlight.current || document.hidden) return;
    inFlight.current = true;
    const run = epoch.current;
    setBusy(true);
    setError("");
    try {
      if (action === "query" || action === "close") {
        const originalId = pendingRef.current;
        if (!originalId) return;
        const { value } = await request(
          "/operations/" + originalId + (action === "close" ? "/close" : ""),
          action === "close" ? { method: "POST", body: "{}" } : {},
        );
        if (current(run)) accept(value, originalId);
        return;
      }
      if (pendingRef.current) throw Error("请先核对原请求");
      if (
        action === "save" &&
        (!ledger || revision === null || !confirm || remoteChanged)
      )
        throw Error("请先核对修改并明确确认保存");
      if (
        action === "import" &&
        (!file ||
          file.size > 10 * 1024 * 1024 ||
          !file.name.toLowerCase().endsWith(".xlsx"))
      )
        throw Error("请选择不超过10MiB的XLSX文件");
      if (action === "import") {
        setCandidate([]);
        setSelected([]);
        setCandidateTargets({});
        setSource("");
      }
      const id = requestId();
      remember(id);
      let init: RequestInit;
      if (action === "save") {
        const raw = encode(ledger!);
        if (new TextEncoder().encode(raw).length > 2 * 1024 * 1024) {
          remember(null);
          throw Error("账本超过2MiB");
        }
        init = {
          method: "PUT",
          body:
            '{"requestId":' +
            JSON.stringify(id) +
            ',"expectedRevision":' +
            revision +
            ',"ledger":' +
            raw +
            "}",
        };
      } else {
        const data = new FormData();
        data.set("requestId", id);
        data.set("file", file!);
        init = { method: "POST", body: data };
        if (fileInput.current) fileInput.current.value = "";
      }
      const { value } = await request(
        action === "save" ? "" : "/tool/import",
        init,
      );
      if (current(run)) accept(value, id);
    } catch (e) {
      if (current(run)) {
        const status = (e as { status?: number }).status;
        if (status && [400, 413, 422, 429].includes(status)) remember(null);
        setError(e instanceof Error ? e.message : "请求未完成；仅核对原编号");
      }
    } finally {
      if (current(run)) {
        setBusy(false);
        inFlight.current = false;
      }
    }
  }
  function patch(next: Row) {
    setLedger(next);
    setConfirm(false);
    setNotice("");
  }
  function go(next: Page, data: Row = {}) {
    const query = new URLSearchParams();
    if (next !== "home") query.set("page", next);
    for (const [key, param] of [
      ["cat", "cat"],
      ["itemId", "item"],
      ["account", "account"],
      ["summaryId", "summary"],
      ["group", "group"],
    ])
      if (text(data[key])) query.set(param, text(data[key]));
    const url = window.location.pathname + (query.size ? "?" + query : "");
    if (navigation.current) {
      if (!navigation.current.push(url)) return;
    } else window.history.pushState(window.history.state, "", url);
    setPage(next);
    setContext(data);
    setError("");
  }
  function download(raw: Blob, name: string) {
    const url = URL.createObjectURL(raw),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function exportXlsx() {
    if (inFlight.current || pendingRef.current) return;
    inFlight.current = true;
    const run = epoch.current;
    setBusy(true);
    try {
      const controller = new AbortController();
      controllers.current.add(controller);
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        if (apiSessionSnapshot().csrf !== session.csrf) {
          forget();
          setLocked(true);
          throw Error("当前登录身份已变化");
        }
        const response = await requestResponse(base + "/tool/export", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "x-csrf-token": session.csrf,
            "x-simple-ledger-user": session.user.id,
            "content-type": "application/json",
          },
          body: exportGroup
            ? '{"invest":' +
              encode(
                rows(ledger?.invest).filter(
                  (row) => text(row.group) === exportGroup,
                ),
              ) +
              "}"
            : "{}",
          signal: controller.signal,
        });
        if (
          [401, 403].includes(response.status) ||
          response.headers.get("X-Alcor-Session-Changed") === "true" ||
          apiSessionSnapshot().csrf !== session.csrf
        ) {
          forget();
          setLocked(true);
          throw Error("登录或权限已变化，请重新登录后读取");
        }
        if (!response.ok) throw Error("XLSX导出失败，请核对当前登录");
        const blob = await response.blob();
        if (apiSessionSnapshot().csrf !== session.csrf) {
          forget();
          setLocked(true);
          throw Error("当前登录身份已变化");
        }
        if (current(run)) download(blob, "independent-investments.xlsx");
      } finally {
        clearTimeout(timeout);
        controllers.current.delete(controller);
      }
    } catch (e) {
      if (current(run)) setError(e instanceof Error ? e.message : "导出失败");
    } finally {
      if (current(run)) {
        setBusy(false);
        inFlight.current = false;
      }
    }
  }
  function applyCandidates() {
    if (!ledger || !selected.length) return;
    try {
      let next = { ...ledger };
      for (const index of selected) {
        const row = candidate[Number(index)],
          target = candidateTargets[index];
        if (!row || !target)
          throw Error("请为每个所选候选明确选择新建或目标账户");
        if (target === "__new") {
          next = {
            ...next,
            invest: [
              ...(Array.isArray(next.invest) ? next.invest : []),
              {
                ...row,
                id: requestId(),
                ...(importGroup ? { group: importGroup } : {}),
                ...(source
                  ? { importSourceRequestId: source }
                  : { importAuthority: "owner_selected_json_candidate" }),
              },
            ],
          };
          continue;
        }
        const original = rows(next.invest).find((r) => text(r.id) === target);
        if (!original) throw Error("目标账户已变化，请重新选择");
        if (!text(row.cur) || text(row.cur) !== text(original.cur))
          throw Error("合并历史须明确相同原币；不跨币换算或猜币种");
        if (original.hist !== undefined && !Array.isArray(original.hist))
          throw Error("目标原历史无法识别，不能覆盖");
        if (row.hist !== undefined && !Array.isArray(row.hist))
          throw Error("候选原历史无法识别，不能丢弃");
        const history = [
            ...(Array.isArray(original.hist) ? original.hist : []),
          ],
          counts = new Map<string, number>();
        for (const item of history) {
          const key = encode(item);
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        for (const item of Array.isArray(row.hist) ? row.hist : []) {
          const key = encode(item),
            count = counts.get(key) || 0;
          if (count) counts.set(key, count - 1);
          else history.push(item);
        }
        next = {
          ...next,
          invest: (Array.isArray(next.invest) ? next.invest : []).map((item) =>
            text(object(item).id) === target
              ? {
                  ...original,
                  hist: history,
                  ...(source
                    ? { importSourceRequestId: source }
                    : { importAuthority: "owner_selected_json_candidate" }),
                }
              : item,
          ),
        };
      }
      patch(next);
      setCandidate([]);
      setSelected([]);
      setCandidateTargets({});
      setNotice(
        "明确选择已加入草稿；已有账户仅合并原历史，当前金额和累计资金流未覆盖，请核对后保存",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "候选未应用");
    }
  }

  const disabled = busy || !!pending || locked || !active;
  return (
    <section
      className="simple-app panel workspace-ui"
      data-ledger-theme={localTheme}
      aria-label="独立记账"
    >
      <header className="simple-ledger-header">
        <a
          className="simple-return"
          href="/portfolio"
          aria-label="返回资产记录"
          title="返回资产记录"
          onClick={async (event) => {
            const state = editorState.current;
            if (
              state.dirty ||
              state.formEditing ||
              ["addItem", "editItem", "addInvest", "addSummary"].includes(
                state.page,
              )
            ) {
              event.preventDefault();
              if (
                await ask("当前有未保存的修改，放弃并返回资产记录？", {
                  title: "返回资产记录",
                  confirmLabel: "放弃并返回",
                })
              ) {
                setLedger(null);
                editorState.current = {
                  ...state,
                  dirty: false,
                  formEditing: false,
                  page: "home",
                };
                window.location.assign("/portfolio");
              }
            }
          }}
        >
          <ArrowUpRight size={19} />
        </a>
        <div className="module-actions">
          <button
            className="icon-button"
            aria-label="重新读取独立账本"
            disabled={busy || locked}
            onClick={async () => {
              if (
                !(
                  dirty ||
                  formEditing ||
                  ["addItem", "editItem", "addInvest", "addSummary"].includes(
                    page,
                  )
                ) ||
                (await ask("放弃未保存草稿并重新读取？", {
                  title: "重新读取账本",
                  confirmLabel: "放弃并读取",
                }))
              )
                void load();
            }}
          >
            <RefreshCw size={18} className={busy ? "spinning" : ""} />
          </button>
          <button
            className="icon-button"
            aria-label="账本文件与投资候选"
            aria-expanded={filesOpen}
            disabled={!ledger || disabled}
            onClick={() => setFilesOpen(!filesOpen)}
          >
            <Files size={18} />
          </button>
          <SelectMenu
            label="账本工具"
            value=""
            variant="compact"
            triggerIcon={<MoreHorizontal size={19} />}
            disabled={!ledger || disabled}
            onChange={async (next) => {
              if (
                next &&
                (!formEditing ||
                  (await ask("当前表单有未加入账本的修改，放弃并切换？", {
                    title: "切换账本页面",
                    confirmLabel: "放弃并切换",
                  })))
              )
                go(next as Page);
            }}
            options={[
              { value: "", label: "账本工具" },
              { value: "home", label: "家庭财务总览" },
              { value: "family", label: "家庭资产" },
              { value: "invest", label: "投资记账" },
              { value: "cashflow", label: "年度现金流" },
              { value: "weather", label: "财务晴雨表" },
              { value: "calendar", label: "记账日历" },
              { value: "manage", label: "家庭成员" },
              { value: "update", label: "更新资产" },
              { value: "summary", label: "投资汇总" },
              { value: "settings", label: "账本设置" },
              { value: "help", label: "计算说明" },
            ]}
          />
          <button
            className="icon-button"
            aria-label="切换独立账本浅色深色"
            onClick={() =>
              setLocalTheme((theme) =>
                (theme ?? document.documentElement.dataset.theme) === "dark"
                  ? "light"
                  : "dark",
              )
            }
          >
            {localTheme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </div>
      </header>
      <div
        className="simple-ledger-body"
        ref={body}
        onScroll={(event) =>
          scrollPositions.current.set(
            page + ":" + encode(context),
            event.currentTarget.scrollTop,
          )
        }
      >
        {locked && <p role="alert">当前登录或权限已变化，请重新登录后读取。</p>}
        {syncUnavailable && !locked && (
          <p className="simple-sync-state" role="status">
            账本同步暂不可用{" "}
            <button onClick={() => void checkRevision()}>重新核对</button>
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {pending && (
          <aside>
            <p>原请求 {pending}，不会自动重发</p>
            <button disabled={busy} onClick={() => void act("query")}>
              查询原编号
            </button>
            <button disabled={busy} onClick={() => void act("close")}>
              关闭原编号
            </button>
          </aside>
        )}
        {ledger && (
          <>
            {page !== "home" && (
              <button
                className="simple-back"
                onClick={async () => {
                  if (
                    formEditing &&
                    !(await ask("当前表单有未加入账本的修改，放弃并返回？", {
                      title: "返回上一页",
                      confirmLabel: "放弃并返回",
                    }))
                  )
                    return;
                  go(
                    page === "settings" && text(context.account)
                      ? "account"
                      : ["family", "invest", "cashflow"].includes(page)
                        ? "home"
                        : page === "editItem" || page === "addItem"
                          ? "update"
                          : (ledgerSection(
                              page,
                              text(context.account),
                            ) as Page),
                    page === "settings" && text(context.account)
                      ? { account: context.account! }
                      : page === "editItem" || page === "addItem"
                        ? { cat: context.cat ?? "cash" }
                        : {},
                  );
                }}
              >
                <ArrowLeft size={16} />
                <span>返回</span>
              </button>
            )}
            <fieldset disabled={disabled} className="simple-page-content">
              <SimplePages
                key={readGeneration}
                ledger={ledger}
                page={page}
                context={context}
                patch={(next) => patch(typedPatch(ledger, next))}
                go={go}
                onEditingChange={setFormEditing}
                filters={filters}
                onFiltersChange={setFilters}
              />
            </fieldset>
            {(page === "account" || page === "summary") && (
              <SimpleBenchmark active={active && !locked && !document.hidden} />
            )}

            {filesOpen && (
              <section className="simple-tools" aria-label="账本文件与投资候选">
                <h3>账本文件与投资候选</h3>
                <button
                  className="simple-code-link"
                  disabled={!ledger || disabled}
                  onClick={() => {
                    setAdvanced(!advanced);
                    setAdvancedDraft(ledger ? encode(ledger) : "");
                  }}
                >
                  <Code2 size={16} />
                  高级完整 JSON 草稿
                </button>
                <p>
                  JSON为当前完整独立账本；XLSX导出已保存投资数据。导入仅加入明确选择的新账户，不覆盖原历史。
                </p>
                <button
                  disabled={disabled}
                  onClick={() =>
                    download(
                      new Blob([encode(ledger)], { type: "application/json" }),
                      "independent-ledger.json",
                    )
                  }
                >
                  下载完整草稿 JSON
                </button>
                <label>
                  投资导出范围
                  <select
                    value={exportGroup}
                    onChange={(e) => setExportGroup(e.target.value)}
                  >
                    <option value="">全部已保存投资</option>
                    {[
                      ...new Set(
                        rows(ledger.invest)
                          .map((row) => text(row.group))
                          .filter(Boolean),
                      ),
                    ].map((group) => (
                      <option key={group}>{group}</option>
                    ))}
                  </select>
                </label>
                <button
                  disabled={disabled || dirty}
                  onClick={() => void exportXlsx()}
                >
                  导出所选投资 XLSX
                </button>
                <button
                  disabled={disabled}
                  onClick={() =>
                    download(
                      new Blob(
                        [
                          encode({
                            format: "independent-investment-group",
                            group: exportGroup,
                            invest: exportGroup
                              ? rows(ledger.invest).filter(
                                  (row) => text(row.group) === exportGroup,
                                )
                              : (ledger.invest ?? []),
                          }),
                        ],
                        { type: "application/json" },
                      ),
                      "independent-investment-group.json",
                    )
                  }
                >
                  导出所选投资 JSON
                </button>
                <label>
                  打开完整 JSON 草稿
                  <input
                    disabled={disabled}
                    type="file"
                    accept=".json,application/json"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      setCandidate([]);
                      setSelected([]);
                      setCandidateTargets({});
                      setSource("");
                      if (!file) return;
                      if (file.size > 2 * 1024 * 1024) {
                        setError("JSON超过2MiB");
                        return;
                      }
                      const run = epoch.current;
                      try {
                        const raw = await file.text(),
                          next = object(decode(raw));
                        if (
                          Array.isArray(next.invest) &&
                          !Array.isArray(next.cash)
                        ) {
                          if (current(run)) {
                            setCandidate(rows(next.invest));
                            setCandidateTargets({});
                            setSource("");
                            setSelected([]);
                            setNotice(
                              "投资JSON候选仅在内存；确认加入后随账本版本留存，不宣称已保存原始上传字节",
                            );
                          }
                          return;
                        }
                        if (
                          !Array.isArray(next.invest) ||
                          !Array.isArray(next.cash)
                        )
                          throw Error("文件不是完整独立账本");
                        if (
                          current(run) &&
                          (await ask(
                            "以此文件替换当前草稿？尚不会写入服务器。",
                            {
                              title: "替换当前草稿",
                              confirmLabel: "替换草稿",
                            },
                          )) &&
                          current(run)
                        )
                          patch(next);
                      } catch (reason) {
                        setError(
                          reason instanceof Error ? reason.message : "文件无效",
                        );
                      }
                    }}
                  />
                </label>
                <label>
                  解析投资 XLSX
                  <input
                    ref={fileInput}
                    disabled={disabled}
                    type="file"
                    accept=".xlsx"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void act("import", file);
                    }}
                  />
                </label>
                {source && (
                  <a href={base + "/originals/" + source} download>
                    下载本次保留原件
                  </a>
                )}
                {candidate.length > 0 && (
                  <>
                    <label>
                      明确加入账本组（可留空）
                      <input
                        value={importGroup}
                        onChange={(e) => setImportGroup(e.target.value)}
                      />
                    </label>
                    {candidate.map((row, i) => (
                      <div key={i}>
                        <label>
                          <input
                            type="checkbox"
                            checked={selected.includes(String(i))}
                            onChange={(e) =>
                              setSelected(
                                e.target.checked
                                  ? [...selected, String(i)]
                                  : selected.filter((v) => v !== String(i)),
                              )
                            }
                          />
                          {text(row.name) || "未命名"} ·{" "}
                          {text(row.amount) || "金额未知"}{" "}
                          {text(row.cur) || "币种未知"} · 原历史{" "}
                          {rows(row.hist).length} 条
                        </label>
                        <label>
                          明确处理方式
                          <select
                            disabled={disabled || !selected.includes(String(i))}
                            value={candidateTargets[String(i)] || ""}
                            onChange={(e) =>
                              setCandidateTargets({
                                ...candidateTargets,
                                [String(i)]: e.target.value,
                              })
                            }
                          >
                            <option value="">请选择</option>
                            <option value="__new">作为新账户加入</option>
                            {rows(ledger.invest)
                              .filter((existing) => text(existing.id))
                              .map((existing) => (
                                <option
                                  key={text(existing.id)}
                                  value={text(existing.id)}
                                >
                                  仅合并历史至：{text(existing.name)}（
                                  {text(existing.cur) || "币种未知"}）
                                </option>
                              ))}
                          </select>
                        </label>
                      </div>
                    ))}
                    <p>
                      已有账户只合并字面相同原观察的多重集合；同日不同值保留，不按名称猜归属，不覆盖当前金额。
                    </p>
                    <button
                      disabled={disabled || !selected.length}
                      onClick={applyCandidates}
                    >
                      将明确映射候选加入草稿
                    </button>
                  </>
                )}
              </section>
            )}
            {dirty && (
              <aside className="simple-save">
                <p>
                  {revision === null
                    ? "无法安全确认版本，禁止保存"
                    : "草稿有未保存修改"}
                </p>
                <label>
                  <input
                    disabled={disabled || !dirty}
                    type="checkbox"
                    checked={confirm}
                    onChange={(e) => setConfirm(e.target.checked)}
                  />
                  已核对完整草稿，明确保存至独立账本
                </label>
                <button
                  disabled={
                    disabled ||
                    revision === null ||
                    !dirty ||
                    !confirm ||
                    remoteChanged
                  }
                  onClick={() => void act("save")}
                >
                  保存独立账本
                </button>
              </aside>
            )}
            {advanced && filesOpen && (
              <section className="simple-tools">
                <h3>高级完整 JSON 草稿</h3>
                <p>
                  此处不另发保存请求；应用后仍需上方明确确认与同版本保存。未识别数字token原样保留。
                </p>
                <textarea
                  aria-label="高级完整JSON草稿"
                  rows={18}
                  spellCheck={false}
                  disabled={disabled}
                  value={advancedDraft}
                  onChange={(e) => setAdvancedDraft(e.target.value)}
                />
                <button
                  disabled={disabled}
                  onClick={() => {
                    try {
                      const next = object(decode(advancedDraft));
                      if (
                        !Array.isArray(next.cash) ||
                        !Array.isArray(next.invest)
                      )
                        throw Error("须为完整独立账本对象");
                      patch(next);
                      setAdvanced(false);
                      setAdvancedDraft("");
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "JSON无效");
                    }
                  }}
                >
                  仅应用至同一草稿
                </button>
              </section>
            )}
          </>
        )}
        {dialog}
        {!ledger && busy && <LoadingPlaceholder label="正在读取独立账本" />}
        {!ledger && !busy && !error && !locked && (
          <div className="simple-empty">
            <p>账本尚未读取</p>
            <button onClick={() => void load()}>重新读取</button>
          </div>
        )}
      </div>
    </section>
  );
}
export { SourceNumber };
