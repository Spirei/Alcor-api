import { LoadingPlaceholder } from "./loading-placeholder";
import { WorkspaceTabs, WorkspaceView } from "./workspace-ui";
import { SimpleLedger } from "./simple-ledger";
import { PersonalDataTransfer } from "./personal-data-transfer";
import {
  sourceWindowActive,
  sourceWindowLabel,
  sourceReadFailure,
  type SourceWindow,
} from "./source-window-view";
import { Activity as SourceActivity } from "react";
import { ResourceImportPanel } from "./resource-import";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot, isCurrentApiSession } from "./api-session";
import { PasswordField } from "./password-fields";
import { SelectMenu } from "./select-menu";
import { requestId } from "./request-id";
import {
  submissionDisposition,
  mayReleaseMissingReceipt,
} from "./portfolio-operation";
import {
  readLegacyImportRequest,
  retainLegacyImportRequest,
  releaseLegacyImportRequest,
  clearLegacyImportScope,
  sourceSessionMatches,
  sourceOperationLabel,
  sourcePermissionLabel,
  sourceFinancialReceiptLabel,
  sourceBlockerLabel,
  sourceOriginalBytes,
  SourceDownloadError,
  sourceUuid,
} from "./legacy-import-state";
import "./legacy-import.css";

type Grant = {
  id: string;
  source_alias: string;
  source_instance: string;
  source_owner: string;
  revision: number;
  state: string;
  effectiveState: string;
  migrationWindow?: SourceWindow;
};
type Source = {
  migrationWindow?: SourceWindow;
  alias: string;
  sourceInstance: string;
  owners: string[];
  kind: string;
};
type Target = {
  id: string;
  username: string;
  uid?: string | null;
  active: boolean;
};
type Manifest = {
  id: string;
  grantId: string;
  grantRevision: number;
  manifestSha256: string;
  rawSha256: string;
  createdAt: string;
  source: { instance: string; owner: string };
  coverage: Record<string, unknown>;
  blockerCount: number;
  blockers: unknown[];
  isHead: boolean;
  confirmedFinancialReceipts: number;
};
type Receipt = {
  requestId: string;
  state: string;
  manifestId?: string;
  manifestSha256?: string;
  grantId?: string;
  permissionState?: string;
  financialApplied?: boolean;
  reason?: string;
  failure?: string;
};
type Operation = {
  requestId: string;
  state: string;
  createdAt: string;
  result: Receipt;
};
type Page<T> = { items: T[]; nextCursor: string | null };
type ManifestPage = Page<Manifest> & {
  head: { id: string; manifestSha256: string; revision: number } | null;
};
const base = "/legacy-financial";

export function LegacyImportPage({
  session,
  active = true,
}: {
  session: Session;
  active?: boolean;
}) {
  const scope = JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  return <ImportKinds key={scope} {...{ session, active, scope }} />;
}
function ImportKinds({
  session,
  active,
  scope,
}: {
  session: Session;
  active: boolean;
  scope: string;
}) {
  const [kind, setKind] = useState("financial");
  return (
    <section className="legacy-import-page">
      <header className="page-heading">
        <h1>旧数据导入</h1>
      </header>
      <div
        role="tablist"
        aria-label="导入类型"
        className="import-actions workspace-tabs"
        onKeyDown={(event) => {
          const keys = ["financial", "resources", "personal", "simple"];
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const index = keys.indexOf(kind),
              next =
                event.key === "Home"
                  ? keys[0]
                  : event.key === "End"
                    ? keys[3]
                    : keys[(index + (event.key === "ArrowRight" ? 1 : 3)) % 4];
            setKind(next);
            document.getElementById("import-" + next + "-tab")?.focus();
          }
        }}
      >
        {[
          ["financial", "金融来源"],
          ["resources", "资源来源"],
          ["personal", "个人 JSON"],
          ["simple", "独立轻量账本"],
        ].map(([key, label]) => (
          <button
            key={key}
            id={"import-" + key + "-tab"}
            role="tab"
            aria-controls={"import-" + key + "-panel"}
            aria-selected={kind === key}
            aria-current={kind === key ? "page" : undefined}
            tabIndex={kind === key ? 0 : -1}
            className={kind === key ? "button" : "button secondary"}
            onClick={() => setKind(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <SourceActivity
        mode={kind === "financial" && active ? "visible" : "hidden"}
      >
        <div
          id="import-financial-panel"
          role="tabpanel"
          aria-labelledby="import-financial-tab"
        >
          <ImportSession
            session={session}
            active={active && kind === "financial"}
            scope={scope}
          />
        </div>
      </SourceActivity>
      <SourceActivity
        mode={kind === "resources" && active ? "visible" : "hidden"}
      >
        <div
          id="import-resources-panel"
          role="tabpanel"
          aria-labelledby="import-resources-tab"
        >
          <ResourceImportPanel
            session={session}
            active={active && kind === "resources"}
            scope={scope}
          />
        </div>
      </SourceActivity>
      <SourceActivity
        mode={kind === "personal" && active ? "visible" : "hidden"}
      >
        <div
          id="import-personal-panel"
          role="tabpanel"
          aria-labelledby="import-personal-tab"
        >
          <PersonalDataTransfer
            session={session}
            active={active && kind === "personal"}
          />
        </div>
      </SourceActivity>
      <SourceActivity mode={kind === "simple" && active ? "visible" : "hidden"}>
        <div
          id="import-simple-panel"
          role="tabpanel"
          aria-labelledby="import-simple-tab"
        >
          <SimpleLedger
            session={session}
            active={active && kind === "simple"}
          />
        </div>
      </SourceActivity>
    </section>
  );
}

function ImportSession({
  session,
  active,
  scope,
}: {
  session: Session;
  active: boolean;
  scope: string;
}) {
  const [stage, setStage] = useState("consent");
  const [visible, setVisible] = useState(!document.hidden),
    [locked, setLocked] = useState(false),
    [reload, setReload] = useState(0);
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState("");
  const [grants, setGrants] = useState<Grant[]>([]),
    [sources, setSources] = useState<Source[]>([]),
    [targets, setTargets] = useState<Target[]>([]);
  const [alias, setAlias] = useState(""),
    [sourceOwner, setSourceOwner] = useState(""),
    [target, setTarget] = useState(session.user.id),
    [targetQuery, setTargetQuery] = useState("");
  const [selectedGrant, setSelectedGrant] = useState(""),
    [pending, setPending] = useState<string | null>(null),
    [journalReady, setJournalReady] = useState(false);
  const [manifestPage, setManifestPage] = useState<ManifestPage | null>(null),
    [operationPage, setOperationPage] = useState<Page<Operation> | null>(null);
  const [manifestCursors, setManifestCursors] = useState<string[]>([]),
    [operationCursors, setOperationCursors] = useState<string[]>([]);
  const [detail, setDetail] = useState<{ id: string; value: unknown } | null>(
      null,
    ),
    [secretVersion, setSecretVersion] = useState(0);
  const live = useRef(false),
    epoch = useRef(0),
    reads = useRef(0),
    original = useRef<string | null>(null),
    rejectedStatus = useRef<number | undefined>(undefined);
  const secretForm = useRef<HTMLFormElement>(null),
    posting = useRef(false),
    request = useRef<AbortController | null>(null),
    download = useRef<AbortController | null>(null),
    objectUrl = useRef<string | null>(null);
  const displayed = useCallback(
    () => sourceSessionMatches(session.csrf, apiSessionSnapshot()),
    [session.csrf],
  );
  const selectedId = useRef(selectedGrant),
    selectedBinding = useRef("");
  selectedId.current = selectedGrant;
  const clearSensitive = useCallback(() => {
    for (const input of secretForm.current?.querySelectorAll("input") || [])
      input.value = "";
    setSecretVersion((v) => v + 1);
    setDetail(null);
    download.current?.abort();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  }, []);
  const fail = useCallback(
    (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "读取失败");
      if (
        ((reason instanceof ApiError ||
          reason instanceof SourceDownloadError) &&
          [401, 403].includes(reason.status)) ||
        (reason instanceof ApiError && reason.code === "session_changed")
      ) {
        live.current = false;
        ++epoch.current;
        ++reads.current;
        clearSensitive();
        setLocked(true);
        setReady(false);
        setBusy(false);
        setGrants([]);
        setSources([]);
        setTargets([]);
        setManifestPage(null);
        setOperationPage(null);
        setAlias("");
        setSourceOwner("");
        setTarget(session.user.id);
        setTargetQuery("");
        setSelectedGrant("");
        setManifestCursors([]);
        setOperationCursors([]);
        setResult("");
        try {
          clearLegacyImportScope(sessionStorage, scope);
        } catch {}
        original.current = null;
        setPending(null);
        if (reason.status === 401)
          window.dispatchEvent(new Event("alcor:session-expired"));
      }
    },
    [clearSensitive, session.user.id, scope],
  );
  useEffect(() => {
    const change = () => {
      if (document.hidden) {
        ++epoch.current;
        ++reads.current;
        clearSensitive();
        request.current?.abort();
      }
      setVisible(!document.hidden);
    };
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, [clearSensitive]);
  useLayoutEffect(() => {
    live.current = active && visible && !locked && displayed();
    ++epoch.current;
    return () => {
      live.current = false;
      ++epoch.current;
      ++reads.current;
      clearSensitive();
      request.current?.abort();
      setBusy(false);
    };
  }, [active, visible, locked, reload, clearSensitive, displayed]);
  useEffect(() => {
    try {
      if (!displayed()) return;
      const id = readLegacyImportRequest(sessionStorage, scope);
      original.current = id;
      setPending(id);
      setJournalReady(true);
    } catch (reason) {
      setJournalReady(false);
      setLocked(true);
      fail(reason);
    }
  }, [scope, fail, displayed, reload]);
  const load = useCallback(async () => {
    if (!live.current || !displayed()) return;
    const generation = epoch.current,
      read = ++reads.current;
    const current = () =>
      live.current &&
      displayed() &&
      epoch.current === generation &&
      reads.current === read;
    setReady(false);
    setError("");
    setDetail(null);
    const manifests = new URLSearchParams({ limit: "20" }),
      operations = new URLSearchParams({ limit: "20" });
    if (manifestCursors.length)
      manifests.set("cursor", manifestCursors[manifestCursors.length - 1]);
    if (operationCursors.length)
      operations.set("cursor", operationCursors[operationCursors.length - 1]);
    try {
      const [own, history, ops, options, users] = await Promise.all([
        api<{ items: Grant[] }>(base + "/authorizations"),
        api<ManifestPage>(base + "/manifests?" + manifests),
        api<Page<Operation>>(base + "/operations?" + operations),
        session.user.role === "admin"
          ? api<{ items: Source[] }>(base + "/registration-options")
          : Promise.resolve({ items: [] as Source[] }),
        session.user.role === "admin"
          ? api<{ items: Target[] }>(
              "/users?q=" + encodeURIComponent(targetQuery),
            )
          : Promise.resolve({ items: [] as Target[] }),
      ]);
      if (!current()) return;
      const freshSelected =
        own.items.find((g) => g.id === selectedId.current) || own.items[0];
      const binding = freshSelected
        ? JSON.stringify([
            freshSelected.id,
            freshSelected.revision,
            freshSelected.state,
            freshSelected.effectiveState,
          ])
        : "";
      if (selectedBinding.current && selectedBinding.current !== binding)
        clearSensitive();
      selectedBinding.current = binding;
      setGrants(own.items);
      setManifestPage(history);
      setOperationPage(ops);
      setSources(options.items);
      setTargets(users.items.filter((u) => u.active));
      setSelectedGrant((old) => old || own.items[0]?.id || "");
      setReady(true);
      setError("");
    } catch (reason) {
      if (
        generation === epoch.current &&
        displayed() &&
        (current() ||
          (reason instanceof ApiError && [401, 403].includes(reason.status)))
      )
        fail(reason);
    }
  }, [
    manifestCursors,
    operationCursors,
    targetQuery,
    session.user.role,
    fail,
    displayed,
    clearSensitive,
  ]);
  useEffect(() => {
    if (active && visible && !locked) void load();
  }, [active, visible, locked, reload, load]);
  const terminal = useCallback(
    (receipt: Receipt) => {
      if (
        !sourceUuid(receipt.requestId) ||
        !["completed", "failed", "reading"].includes(receipt.state)
      )
        throw new Error("原操作回执无法核对");
      if (receipt.state === "reading") {
        setResult("来源读取尚未确认");
        return;
      }
      releaseLegacyImportRequest(sessionStorage, scope, receipt.requestId);
      original.current = null;
      setPending(null);
      rejectedStatus.current = undefined;
      if (receipt.state === "failed") {
        setError(sourceReadFailure(receipt.reason || receipt.failure));
        return;
      }
      setError("");
      setResult(
        receipt.manifestId
          ? "来源快照已保存"
          : receipt.permissionState
            ? sourcePermissionLabel(receipt.permissionState)
            : "来源操作已完成",
      );
    },
    [scope],
  );
  async function submit(path: string, data: Record<string, unknown>) {
    if (
      !live.current ||
      !displayed() ||
      posting.current ||
      original.current ||
      !journalReady ||
      !ready
    )
      return;
    const id = requestId(),
      generation = epoch.current;
    const current = () =>
      live.current && displayed() && generation === epoch.current;
    try {
      retainLegacyImportRequest(sessionStorage, scope, id);
    } catch (reason) {
      fail(reason);
      return;
    }
    original.current = id;
    setPending(id);
    posting.current = true;
    setBusy(true);
    setResult("");
    setError("");
    const controller = new AbortController();
    request.current = controller;
    clearSensitive();
    try {
      const receipt = await api<Receipt>(
        path,
        {
          method: "POST",
          body: JSON.stringify({ ...data, requestId: id }),
          signal: controller.signal,
        },
        session.csrf,
        60000,
      );
      if (!current()) return;
      if (receipt.requestId !== id) throw new Error("原操作编号与回执不符");
      terminal(receipt);
      await load();
      if (current() && receipt.state === "failed")
        setError(sourceReadFailure(receipt.reason || receipt.failure));
    } catch (reason) {
      if (!current()) return;
      rejectedStatus.current =
        reason instanceof ApiError ? reason.status : undefined;
      if (submissionDisposition(rejectedStatus.current) === "rejected") {
        releaseLegacyImportRequest(sessionStorage, scope, id);
        original.current = null;
        setPending(null);
      }
      fail(reason);
    } finally {
      posting.current = false;
      if (request.current === controller) request.current = null;
      if (current()) setBusy(false);
    }
  }
  async function check(id = original.current) {
    if (!id || !live.current || !displayed() || busy || !sourceUuid(id)) return;
    const generation = epoch.current;
    setBusy(true);
    setError("");
    try {
      const receipt = await api<Receipt>(base + "/operations/" + id);
      if (!live.current || !displayed() || generation !== epoch.current) return;
      if (receipt.requestId !== id) throw new Error("原操作编号与回执不符");
      if (id === original.current) terminal(receipt);
      else setResult(sourceOperationLabel(receipt.state));
      await load();
      if (
        live.current &&
        displayed() &&
        generation === epoch.current &&
        receipt.state === "failed"
      )
        setError(sourceReadFailure(receipt.reason || receipt.failure));
    } catch (reason) {
      if (live.current && displayed() && generation === epoch.current) {
        if (
          reason instanceof ApiError &&
          reason.status === 404 &&
          id === original.current &&
          mayReleaseMissingReceipt(rejectedStatus.current)
        ) {
          releaseLegacyImportRequest(sessionStorage, scope, id);
          original.current = null;
          setPending(null);
        }
        fail(reason);
      }
    } finally {
      if (live.current && displayed() && generation === epoch.current)
        setBusy(false);
    }
  }
  async function show(item: Manifest) {
    if (!live.current || !displayed() || busy) return;
    const generation = epoch.current;
    setBusy(true);
    setDetail(null);
    try {
      const value = await api<unknown>(base + "/manifests/" + item.id);
      if (live.current && displayed() && generation === epoch.current)
        setDetail({ id: item.id, value });
    } catch (reason) {
      if (live.current && displayed() && generation === epoch.current)
        fail(reason);
    } finally {
      if (live.current && displayed() && generation === epoch.current)
        setBusy(false);
    }
  }
  async function downloadRaw(item: Manifest) {
    if (!live.current || !displayed() || busy) return;
    const generation = epoch.current,
      binding = apiSessionSnapshot(),
      controller = new AbortController();
    download.current = controller;
    setBusy(true);
    setError("");
    const current = () =>
      live.current &&
      displayed() &&
      generation === epoch.current &&
      isCurrentApiSession(binding);
    try {
      const blob = await sourceOriginalBytes(
        item.id,
        item.rawSha256,
        { csrf: session.csrf, current },
        controller.signal,
      );
      if (!current()) return;
      const url = URL.createObjectURL(blob);
      objectUrl.current = url;
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `source-${item.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      objectUrl.current = null;
    } catch (reason) {
      if (current()) fail(reason);
    } finally {
      if (download.current === controller) download.current = null;
      if (current()) setBusy(false);
    }
  }
  const selected = grants.find((g) => g.id === selectedGrant),
    source = sources.find((s) => s.alias === alias);
  const blocked = busy || !!pending || !ready || locked || !journalReady;
  const targetOptions = [
    { value: session.user.id, label: session.user.username },
    ...targets
      .filter((t) => t.id !== session.user.id)
      .map((t) => ({
        value: t.id,
        label: `${t.username}${t.uid ? " · " + t.uid : ""}`,
      })),
  ];
  if (!targetOptions.some((t) => t.value === target))
    targetOptions.push({ value: target, label: "账号待核对 · " + target });
  return (
    <section className="legacy-import-page">
      <header className="page-heading">
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            setLocked(false);
            setReload((v) => v + 1);
          }}
        >
          重新读取
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {result && <p role="status">{result}</p>}
      {pending && (
        <div className="import-pending" role="status">
          <p>等待原操作结果</p>
          <p className="import-id">{pending}</p>
          <button
            className="button"
            disabled={busy || locked}
            onClick={() => void check()}
          >
            查询原操作
          </button>
        </div>
      )}
      {!ready ? (
        locked ? (
          <p role="status">当前内容已撤下</p>
        ) : !error ? (
          <LoadingPlaceholder />
        ) : null
      ) : (
        <>
          <WorkspaceTabs
            label="金融来源流程"
            value={stage}
            disabled={busy || !!pending}
            onChange={(value) => {
              clearSensitive();
              setStage(value);
            }}
            items={[
              { value: "consent", label: "1 · 来源与授权" },
              { value: "snapshots", label: "2 · 快照与核对" },
              { value: "operations", label: "3 · 操作回执" },
            ]}
          />
          <WorkspaceView active={stage === "consent"} label="来源与授权">
            {session.user.role === "admin" && (
              <section className="import-block">
                <h2>登记来源</h2>
                {source && <p>{sourceWindowLabel(source.migrationWindow)}</p>}
                {sources.length === 0 ? (
                  <p className="import-empty">暂无已登记的旧来源</p>
                ) : (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submit(base + "/authorizations", {
                        sourceAlias: alias,
                        sourceOwner,
                        targetUserId: target,
                      });
                    }}
                  >
                    <div className="import-fields">
                      <label>
                        旧来源
                        <SelectMenu
                          label="旧来源"
                          variant="field"
                          value={alias}
                          options={[
                            { value: "", label: "选择来源" },
                            ...sources.map((s) => ({
                              value: s.alias,
                              label: `${s.alias} · ${s.sourceInstance}`,
                            })),
                            ...(!source && alias
                              ? [
                                  {
                                    value: alias,
                                    label: "来源待核对 · " + alias,
                                  },
                                ]
                              : []),
                          ]}
                          onChange={(value) => {
                            setAlias(value);
                            setSourceOwner("");
                          }}
                          disabled={blocked}
                        />
                      </label>
                      <label>
                        来源账号
                        <SelectMenu
                          label="来源账号"
                          variant="field"
                          value={sourceOwner}
                          options={[
                            { value: "", label: "选择来源账号" },
                            ...(source?.owners || []).map((value) => ({
                              value,
                              label: value,
                            })),
                            ...(sourceOwner &&
                            !source?.owners.includes(sourceOwner)
                              ? [
                                  {
                                    value: sourceOwner,
                                    label: "来源账号待核对 · " + sourceOwner,
                                  },
                                ]
                              : []),
                          ]}
                          onChange={setSourceOwner}
                          disabled={blocked || !source}
                        />
                      </label>
                      <label>
                        查找目标账号
                        <input
                          value={targetQuery}
                          onChange={(event) =>
                            setTargetQuery(event.target.value)
                          }
                          disabled={busy}
                        />
                      </label>
                      <label>
                        目标账号
                        <SelectMenu
                          label="目标账号"
                          variant="field"
                          value={target}
                          options={targetOptions}
                          onChange={setTarget}
                          disabled={blocked}
                        />
                      </label>
                    </div>
                    <div className="import-actions">
                      <button
                        className="button"
                        disabled={
                          blocked || !source?.owners.includes(sourceOwner)
                        }
                      >
                        登记
                      </button>
                    </div>
                  </form>
                )}
              </section>
            )}
            <section className="import-block">
              <h2>本人授权</h2>
              {!grants.length ? (
                <p className="import-empty">暂无本人来源授权</p>
              ) : (
                <>
                  <SelectMenu
                    label="本人来源授权"
                    value={selectedGrant}
                    options={grants.map((g) => ({
                      value: g.id,
                      label: `${g.source_alias} · ${g.source_owner}`,
                    }))}
                    onChange={(value) => {
                      setSelectedGrant(value);
                      clearSensitive();
                    }}
                    disabled={busy}
                  />
                  {selected && (
                    <>
                      <p>
                        {sourcePermissionLabel(selected.state)} ·{" "}
                        {sourceWindowLabel(selected.migrationWindow)}
                      </p>
                      {selected.effectiveState ===
                        "instance_reenrollment_required" && (
                        <p>{sourcePermissionLabel(selected.effectiveState)}</p>
                      )}
                      <p className="import-id">
                        {selected.source_instance} · 修订 {selected.revision}
                      </p>
                      {["pending_owner", "active"].includes(selected.state) && (
                        <SourceConsentForm
                          key={secretVersion + selected.id}
                          formRef={secretForm}
                          disabled={
                            blocked ||
                            (selected.state === "pending_owner" &&
                              !sourceWindowActive(selected.migrationWindow))
                          }
                          approve={selected.state === "pending_owner"}
                          onSubmit={(approve, password, code) =>
                            void submit(
                              `${base}/authorizations/${selected.id}/consent`,
                              {
                                revision: selected.revision,
                                approve,
                                password,
                                code,
                              },
                            )
                          }
                        />
                      )}
                    </>
                  )}
                </>
              )}
            </section>
          </WorkspaceView>
          <WorkspaceView active={stage === "snapshots"} label="快照与核对">
            <section className="import-block">
              <h2>来源快照</h2>
              <div className="import-actions">
                <button
                  className="button"
                  disabled={
                    blocked ||
                    !selected ||
                    selected.effectiveState !== "active" ||
                    !sourceWindowActive(selected.migrationWindow)
                  }
                  onClick={() =>
                    selected &&
                    void submit(
                      `${base}/authorizations/${selected.id}/snapshots`,
                      {
                        grantRevision: selected.revision,
                        predecessorHash:
                          manifestPage?.head?.manifestSha256 ?? null,
                      },
                    )
                  }
                >
                  导出快照
                </button>
              </div>
              {!manifestPage?.items.length ? (
                <p className="import-empty">暂无来源快照</p>
              ) : (
                <div className="import-list">
                  {manifestPage.items.map((item) => (
                    <article className="import-row" key={item.id}>
                      <div>
                        <p>
                          {item.source.instance} · {item.source.owner}
                        </p>
                        <p>{new Date(item.createdAt).toLocaleString()}</p>
                        <p>来源快照已保存{item.isHead ? " · 当前前驱" : ""}</p>
                        <p>
                          {sourceFinancialReceiptLabel(
                            item.confirmedFinancialReceipts,
                          )}
                        </p>
                        {item.blockerCount > 0 && (
                          <div role="status">
                            <p>来源阻断 {item.blockerCount} 项</p>
                            <ul>
                              {item.blockers
                                .slice(0, 5)
                                .map((blocker, index) => (
                                  <li key={index}>
                                    {sourceBlockerLabel(blocker)}
                                  </li>
                                ))}
                            </ul>
                          </div>
                        )}
                        <p className="import-id">{item.id}</p>
                        {detail?.id === item.id && (
                          <details open>
                            <summary>来源核对</summary>
                            <pre>{JSON.stringify(detail.value, null, 2)}</pre>
                          </details>
                        )}
                      </div>
                      <div className="import-actions">
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => void show(item)}
                        >
                          核对来源
                        </button>
                        <button
                          className="button secondary"
                          disabled={busy}
                          onClick={() => void downloadRaw(item)}
                        >
                          下载原快照
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              <div className="import-actions">
                <button
                  className="button secondary"
                  disabled={!manifestCursors.length || busy}
                  onClick={() => setManifestCursors((p) => p.slice(0, -1))}
                >
                  上一页
                </button>
                <button
                  className="button secondary"
                  disabled={!manifestPage?.nextCursor || busy}
                  onClick={() =>
                    manifestPage?.nextCursor &&
                    setManifestCursors((p) => [...p, manifestPage.nextCursor!])
                  }
                >
                  下一页
                </button>
              </div>
            </section>
          </WorkspaceView>
          <WorkspaceView active={stage === "operations"} label="操作回执">
            <section className="import-block">
              <h2>操作记录</h2>
              {!operationPage?.items.length ? (
                <p className="import-empty">暂无来源操作</p>
              ) : (
                operationPage.items.map((item) => (
                  <article className="import-row" key={item.requestId}>
                    <div>
                      <p>{sourceOperationLabel(item.state)}</p>
                      <p className="import-id">{item.requestId}</p>
                      <p>{new Date(item.createdAt).toLocaleString()}</p>
                      {item.result.failure && (
                        <p role="status">
                          {item.result.reason || item.result.failure}
                        </p>
                      )}
                    </div>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void check(item.requestId)}
                    >
                      查询原操作
                    </button>
                  </article>
                ))
              )}
              <div className="import-actions">
                <button
                  className="button secondary"
                  disabled={!operationCursors.length || busy}
                  onClick={() => setOperationCursors((p) => p.slice(0, -1))}
                >
                  上一页
                </button>
                <button
                  className="button secondary"
                  disabled={!operationPage?.nextCursor || busy}
                  onClick={() =>
                    operationPage?.nextCursor &&
                    setOperationCursors((p) => [
                      ...p,
                      operationPage.nextCursor!,
                    ])
                  }
                >
                  下一页
                </button>
              </div>
            </section>
          </WorkspaceView>
        </>
      )}
    </section>
  );
}

export function SourceConsentForm({
  idPrefix = "source-consent",
  formRef,
  disabled,
  approve,
  onSubmit,
}: {
  idPrefix?: string;
  formRef: React.RefObject<HTMLFormElement | null>;
  disabled: boolean;
  approve: boolean;
  onSubmit: (approve: boolean, password: string, code: string) => void;
}) {
  const [password, setPassword] = useState(""),
    [code, setCode] = useState("");
  useLayoutEffect(
    () => () => {
      setPassword("");
      setCode("");
      for (const input of formRef.current?.querySelectorAll("input") || [])
        input.value = "";
    },
    [formRef],
  );
  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(approve, password, code);
        setPassword("");
        setCode("");
      }}
    >
      <div className="import-fields">
        <label htmlFor={idPrefix + "-password"}>
          当前密码
          <PasswordField
            id={idPrefix + "-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            disabled={disabled}
          />
        </label>
        <label htmlFor={idPrefix + "-code"}>
          验证码
          <input
            id={idPrefix + "-code"}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={32}
            disabled={disabled}
          />
        </label>
      </div>
      <div className="import-actions">
        <button className="button" disabled={disabled || !password}>
          {approve ? "同意来源读取" : "撤销来源读取"}
        </button>
      </div>
    </form>
  );
}
