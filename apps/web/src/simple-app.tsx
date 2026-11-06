import { requestResponse } from "./api-response.ts";
import { WorkspaceTabs } from "./workspace-ui";
import { ArrowLeft, Code2, Files, RefreshCw } from "lucide-react";
import { SelectMenu } from "./select-menu";
import { useConfirmationDialog } from "./confirm-dialog";
import { ledgerSection } from "./simple-app-view-model";
import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { requestId } from "./request-id";
import { SimplePages } from "./simple-app-pages";
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
    [confirm, setConfirm] = useState(false),
    [advanced, setAdvanced] = useState(false),
    [filesOpen, setFilesOpen] = useState(false),
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
    fileInput = useRef<HTMLInputElement>(null);
  alive.current = active && !locked;
  const storage = JSON.stringify([
    "simple-ledger",
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  const dirty = ledger !== null && encode(ledger) !== saved;
  const { ask, dialog } = useConfirmationDialog(
    storage + ":" + active + ":" + locked,
  );
  function forget() {
    epoch.current++;
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    setLedger(null);
    setRevision(null);
    setSaved("");
    setContext({});
    setCandidate([]);
    setSelected([]);
    setCandidateTargets({});
    setSource("");
    setImportGroup("");
    setExportGroup("");
    setConfirm(false);
    setAdvanced(false);
    setFilesOpen(false);
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
  useEffect(() => {
    if (!active) forget();
    else if (!document.hidden && !locked) void load();
  }, [active, locked]);
  useEffect(() => {
    const changed = () => {
      if (document.hidden) forget();
      else if (alive.current) void load();
    };
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  async function request(path: string, init: RequestInit = {}) {
    const controller = new AbortController();
    controllers.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      if (apiSessionSnapshot().csrf !== session.csrf)
        throw Error("当前登录身份已变化");
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
      if (apiSessionSnapshot().csrf !== session.csrf)
        throw Error("当前登录身份已变化");
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
  async function load() {
    if (!alive.current || document.hidden || inFlight.current) return;
    inFlight.current = true;
    const run = epoch.current;
    setBusy(true);
    setError("");
    try {
      const { value } = await request("");
      if (current(run)) {
        const next = object(value.ledger);
        setReadGeneration((value) => value + 1);
        setAdvanced(false);
        setAdvancedDraft("");
        setLedger(next);
        setSaved(encode(next));
        setRevision(revisionToken(value.revision));
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
        if (!pending) return;
        const { value } = await request(
          "/operations/" + pending + (action === "close" ? "/close" : ""),
          action === "close" ? { method: "POST", body: "{}" } : {},
        );
        if (current(run)) accept(value, pending);
        return;
      }
      if (pendingRef.current) throw Error("请先核对原请求");
      if (action === "save" && (!ledger || revision === null || !confirm))
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
    setNotice("修改仅在当前草稿，尚未保存");
  }
  function go(next: Page, data: Row = {}) {
    setPage(next);
    setContext(data);
    setError("");
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
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + (query.size ? "?" + query : ""),
    );
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
    <section className="simple-app panel workspace-ui">
      <header className="simple-ledger-header">
        <div>
          <h1>独立记账</h1>
          <p>家庭资产与投资规划</p>
        </div>
        <div className="module-actions">
          <button
            className="icon-button"
            aria-label="重新读取独立账本"
            disabled={busy || locked}
            onClick={async () => {
              if (
                !dirty ||
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
            value={
              [
                "weather",
                "calendar",
                "manage",
                "update",
                "summary",
                "settings",
                "help",
              ].includes(page) && !text(context.account)
                ? page
                : ""
            }
            variant="compact"
            disabled={!ledger || disabled}
            onChange={(next) => {
              if (next) go(next as Page);
            }}
            options={[
              { value: "", label: "账本工具" },
              { value: "weather", label: "财务晴雨表" },
              { value: "calendar", label: "记账日历" },
              { value: "manage", label: "家庭成员" },
              { value: "update", label: "更新资产" },
              { value: "summary", label: "投资汇总" },
              { value: "settings", label: "账本设置" },
              { value: "help", label: "计算说明" },
            ]}
          />
        </div>
      </header>
      {locked && <p role="alert">当前登录或权限已变化，请重新登录后读取。</p>}
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
          <WorkspaceTabs<string>
            label="独立账本页面"
            value={ledgerSection(page, text(context.account))}
            onChange={(next) => go(next as Page)}
            items={[
              { value: "home", label: "总览" },
              { value: "family", label: "家庭资产" },
              { value: "invest", label: "投资记账" },
              { value: "cashflow", label: "年度收支" },
            ]}
          />
          {!["home", "family", "invest", "cashflow"].includes(page) && (
            <button
              className="simple-back"
              onClick={() =>
                go(
                  page === "settings" && text(context.account)
                    ? "account"
                    : (ledgerSection(page, text(context.account)) as Page),
                  page === "settings" && text(context.account)
                    ? { account: context.account! }
                    : {},
                )
              }
            >
              <ArrowLeft size={16} />
              返回
              {page === "settings" && text(context.account)
                ? "投资账户"
                : {
                    family: "家庭资产",
                    invest: "投资记账",
                    cashflow: "年度收支",
                    home: "总览",
                  }[ledgerSection(page, text(context.account))] || "总览"}
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
                        (await ask("以此文件替换当前草稿？尚不会写入服务器。", {
                          title: "替换当前草稿",
                          confirmLabel: "替换草稿",
                        })) &&
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
                disabled={disabled || revision === null || !dirty || !confirm}
                onClick={() => void act("save")}
              >
                保存独立账本
              </button>
            </aside>
          )}
          {!dirty && (
            <p className="simple-saved-state">
              已保存
              {revision !== null ? ` · 版本 ${revision}` : " · 版本暂不可核对"}
            </p>
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
      {!ledger && !busy && <p>尚未读取账本；读取不会初始化资产或添加历史。</p>}
    </section>
  );
}
export { SourceNumber };
