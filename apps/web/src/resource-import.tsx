import { sourceWindowActive, sourceWindowLabel, sourceReadFailure, type SourceWindow } from "./source-window-view";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { SourceConsentForm } from "./legacy-import";
import {
  sourceSessionMatches,
  sourcePermissionLabel,
} from "./legacy-import-state";
import { resourceSize } from "./resource-state";
import { requestId } from "./request-id";
import { SelectMenu } from "./select-menu";
import {
  submissionDisposition,
  mayReleaseMissingReceipt,
} from "./portfolio-operation";
import {
  readResourceImportRequest,
  retainResourceImportRequest,
  releaseResourceImportRequest,
  resourceImportPhase,
  resourceSegment,
  type ResourceImportProof,
} from "./resource-import-state";

type Grant = {
  id: string;
  sourceAlias: string;
  sourceOwner: string;
  sourceInstance: string;
  state: string;
  effective: boolean;
  migrationWindow?: SourceWindow;
  revision: number;
};
type Source = {
  migrationWindow?: SourceWindow;
  alias: string;
  sourceInstance: string;
  owners: { sourceOwner: string; targetUserId: string; targetName: string }[];
  unclaimedOwnerCount: number;
};
type Count = { kind: string; state: string; count: number };
type Manifest = {
  id: string;
  consentId: string;
  consentRevision: number;
  state: string;
  remaining: number;
  counts: Count[];
  targetImportCompleted: boolean;
  manifest: { recordCount: number; rawBytes: number } | null;
};
type Entry = {
  seq: number;
  kind: string;
  source_id: string;
  state: string;
  reason: string | null;
  normalized: { name?: string; size_bytes?: number } | null;
};
type Detail = {
  id: string;
  state: string;
  remaining: number;
  counts: Count[];
  targetImportCompleted: boolean;
  items: Entry[];
  nextAfter: number | null;
};
type Receipt = {
  requestId: string;
  state: string;
  manifestId?: string;
  reason?: string;
  targetImportCompleted?: boolean;
  remaining?: number;
  metadataComplete?: boolean;
  outcomes?: { seq: number; state: string; reason: string | null }[];
};
const base = "/resource-import";

export function ResourceImportPanel({
  session,
  active,
  scope,
}: {
  session: Session;
  active: boolean;
  scope: string;
}) {
  const [visible, setVisible] = useState(!document.hidden),
    [locked, setLocked] = useState(false),
    [reload, setReload] = useState(0),
    [ready, setReady] = useState(false);
  const [grants, setGrants] = useState<Grant[]>([]),
    [sources, setSources] = useState<Source[]>([]),
    [manifests, setManifests] = useState<Manifest[]>([]),
    [operations, setOperations] = useState<
      { requestId: string; result: Receipt }[]
    >([]);
  const [alias, setAlias] = useState(""),
    [owner, setOwner] = useState(""),
    [grantId, setGrantId] = useState(""),
    [manifestId, setManifestId] = useState("");
  const [manifestCursors, setManifestCursors] = useState<string[]>([]),
    [operationCursors, setOperationCursors] = useState<string[]>([]),
    [nextManifest, setNextManifest] = useState<string | null>(null),
    [nextOperation, setNextOperation] = useState<string | null>(null),
    [afters, setAfters] = useState<number[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null),
    [proof, setProof] = useState<ResourceImportProof | null>(null),
    [count, setCount] = useState("8"),
    [secretVersion, setSecretVersion] = useState(0);
  const [pending, setPending] = useState<string | null>(null),
    [observed, setObserved] = useState<Receipt | null>(null),
    [journalReady, setJournalReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [result, setResult] = useState("");
  const live = useRef(false),
    epoch = useRef(0),
    listRead = useRef(0),
    detailRead = useRef(0),
    original = useRef<string | null>(null),
    posting = useRef(false),
    rejected = useRef<number | undefined>(undefined),
    controller = useRef<AbortController | null>(null),
    form = useRef<HTMLFormElement>(null);
  const selectedManifestRef = useRef(manifestId),
    proofSequence = useRef(0);
  selectedManifestRef.current = manifestId;
  const displayed = useCallback(
    () => sourceSessionMatches(session.csrf, apiSessionSnapshot()),
    [session.csrf],
  );
  const clearSensitive = useCallback(() => {
    ++proofSequence.current;
    for (const input of form.current?.querySelectorAll("input") || [])
      input.value = "";
    setSecretVersion((v) => v + 1);
    setProof(null);
  }, []);
  function fail(reason: unknown) {
    setError(reason instanceof Error ? reason.message : "资源来源读取失败");
    if (
      reason instanceof ApiError &&
      ([401, 403].includes(reason.status) || reason.code === "session_changed")
    ) {
      live.current = false;
      ++epoch.current;
      clearSensitive();
      setLocked(true);
      setReady(false);
      setBusy(false);
      setGrants([]);
      setSources([]);
      setManifests([]);
      setOperations([]);
      setDetail(null);
      setAlias("");
      setOwner("");
      setGrantId("");
      setManifestId("");
      setAfters([]);
      setManifestCursors([]);
      setOperationCursors([]);
      if (original.current)
        releaseResourceImportRequest(sessionStorage, scope, original.current);
      original.current = null;
      setPending(null);
    }
  }
  useEffect(() => {
    const change = () => {
      if (document.hidden) {
        ++epoch.current;
        clearSensitive();
        controller.current?.abort();
        setObserved(null);
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
      clearSensitive();
      controller.current?.abort();
      setObserved(null);
      setBusy(false);
    };
  }, [active, visible, locked, displayed, clearSensitive]);
  useEffect(() => {
    if (!displayed()) return;
    try {
      const id = readResourceImportRequest(sessionStorage, scope);
      original.current = id;
      setPending(id);
      setJournalReady(true);
    } catch (reason) {
      setJournalReady(false);
      setLocked(true);
      fail(reason);
    }
  }, [scope, displayed, reload]);
  const current = (generation: number) =>
    live.current && displayed() && generation === epoch.current;
  async function load() {
    if (!live.current || !displayed()) return;
    const generation = epoch.current,
      read = ++listRead.current;
    setReady(false);
    try {
      const [gs, ms, os, ss] = await Promise.all([
        api<{ items: Grant[] }>(base + "/authorizations"),
        api<{ items: Manifest[]; nextCursor: string | null }>(
          base +
            "/manifests?limit=20" +
            (manifestCursors.length ? "&cursor=" + manifestCursors.at(-1) : ""),
        ),
        api<{
          items: { requestId: string; result: Receipt }[];
          nextCursor: string | null;
        }>(
          base +
            "/operations?limit=20" +
            (operationCursors.length
              ? "&cursor=" + operationCursors.at(-1)
              : ""),
        ),
        session.user.role === "admin"
          ? api<{ items: Source[] }>(base + "/registration-options")
          : Promise.resolve({ items: [] as Source[] }),
      ]);
      if (!current(generation) || read !== listRead.current) return;
      setGrants(gs.items);
      setManifests(ms.items);
      setOperations(os.items);
      setSources(ss.items);
      setNextManifest(ms.nextCursor);
      setNextOperation(os.nextCursor);
      setGrantId((old) => old || gs.items[0]?.id || "");
      const choice = ms.items.some((m) => m.id === selectedManifestRef.current)
        ? selectedManifestRef.current
        : ms.items[0]?.id || "";
      if (choice !== selectedManifestRef.current) setAfters([]);
      setManifestId(choice);
      setReady(true);
    } catch (reason) {
      if (current(generation) && read === listRead.current) fail(reason);
    }
  }
  useEffect(() => {
    if (active && visible && !locked) void load();
  }, [active, visible, locked, reload, manifestCursors, operationCursors]);
  async function inspect() {
    if (!live.current || !displayed() || !manifestId) return;
    const generation = epoch.current,
      read = ++detailRead.current;
    setDetail(null);
    setProof(null);
    try {
      const value = await api<Detail>(
        base +
          "/manifests/" +
          manifestId +
          (afters.length ? "?after=" + afters.at(-1) : ""),
      );
      if (current(generation) && read === detailRead.current) setDetail(value);
    } catch (reason) {
      if (current(generation) && read === detailRead.current) fail(reason);
    }
  }
  useEffect(() => {
    if (active && visible && !locked) void inspect();
  }, [active, visible, locked, reload, manifestId, afters]);
  const selected = grants.find((g) => g.id === grantId),
    selectedManifest = manifests.find((m) => m.id === manifestId),
    manifestGrant = grants.find((g) => g.id === selectedManifest?.consentId);
  const grantBinding = JSON.stringify(
    grants.map((g) => [g.id, g.revision, g.state, g.effective]),
  );
  useLayoutEffect(() => {
    clearSensitive();
  }, [grantBinding, manifestId, clearSensitive]);
  function accept(receipt: Receipt) {
    if (
      !/^[a-f0-9-]{36}$/.test(receipt.requestId) ||
      !["pending", "completed", "failed"].includes(receipt.state)
    )
      throw new Error("资源原回执无法核对");
    setObserved(receipt);
    if (receipt.metadataComplete && receipt.manifestId) {
      setManifestCursors([]);
      setManifestId(receipt.manifestId);
      setAfters([]);
    }
    if (receipt.state === "pending") {
      setResult("来源捕获尚未确认");
      return;
    }
    releaseResourceImportRequest(sessionStorage, scope, receipt.requestId);
    original.current = null;
    setPending(null);
    rejected.current = undefined;
    if (receipt.state === "failed") {
      setError(
        receipt.reason === "explicitly_closed"
          ? "原捕获已显式关闭"
          : sourceReadFailure(receipt.reason),
      );
      return;
    }
    setError("");
    setResult(
      receipt.metadataComplete
        ? "元数据清单已封口"
        : receipt.outcomes
          ? resourceImportPhase(
              "sealed",
              receipt.targetImportCompleted,
              receipt.remaining,
            )
          : "资源来源操作已完成",
    );
  }
  async function submit(
    path: string,
    body: Record<string, unknown>,
    originalId?: string,
  ) {
    if (
      !live.current ||
      !displayed() ||
      posting.current ||
      !ready ||
      !journalReady ||
      (originalId && original.current !== originalId) ||
      (original.current && !originalId)
    )
      return;
    const id =
        originalId ||
        (typeof body.requestId === "string" ? body.requestId : requestId()),
      generation = epoch.current;
    try {
      if (!originalId) retainResourceImportRequest(sessionStorage, scope, id);
    } catch (reason) {
      fail(reason);
      return;
    }
    original.current = id;
    setPending(id);
    posting.current = true;
    setBusy(true);
    setError("");
    setResult("");
    setObserved(null);
    clearSensitive();
    const abort = new AbortController();
    controller.current = abort;
    try {
      const receipt = await api<Receipt>(
        path,
        {
          method: "POST",
          body: JSON.stringify(originalId ? body : { ...body, requestId: id }),
          signal: abort.signal,
        },
        session.csrf,
        60000,
      );
      if (!current(generation)) return;
      if (receipt.requestId !== id) throw new Error("原UUID与回执不符");
      accept(receipt);
      setReload((v) => v + 1);
    } catch (reason) {
      if (!current(generation)) return;
      rejected.current = reason instanceof ApiError ? reason.status : undefined;
      if (
        !originalId &&
        submissionDisposition(rejected.current) === "rejected"
      ) {
        releaseResourceImportRequest(sessionStorage, scope, id);
        original.current = null;
        setPending(null);
      }
      fail(reason);
    } finally {
      posting.current = false;
      if (controller.current === abort) controller.current = null;
      if (current(generation)) setBusy(false);
    }
  }
  async function query(id = original.current) {
    if (!id || !live.current || !displayed() || busy) return;
    const generation = epoch.current;
    setBusy(true);
    try {
      const value = await api<Receipt>(base + "/operations/" + id);
      if (!current(generation)) return;
      if (value.requestId !== id) throw new Error("原UUID与回执不符");
      if (id === original.current) accept(value);
      else setObserved(value);
      setReload((v) => v + 1);
    } catch (reason) {
      if (current(generation)) {
        if (
          reason instanceof ApiError &&
          reason.status === 404 &&
          id === original.current &&
          mayReleaseMissingReceipt(rejected.current)
        ) {
          releaseResourceImportRequest(sessionStorage, scope, id);
          original.current = null;
          setPending(null);
        }
        fail(reason);
      }
    } finally {
      if (current(generation)) setBusy(false);
    }
  }
  async function preview() {
    if (
      !manifestGrant?.effective ||
      !selectedManifest ||
      busy ||
      pending ||
      !live.current ||
      !displayed()
    )
      return;
    const generation = epoch.current,
      proofVersion = proofSequence.current;
    setBusy(true);
    setProof(null);
    setError("");
    try {
      const value = await api<ResourceImportProof>(
        base + "/manifests/" + manifestId + "/preview",
        {
          method: "POST",
          body: JSON.stringify({ revision: manifestGrant.revision }),
        },
        session.csrf,
      );
      if (
        !current(generation) ||
        proofVersion !== proofSequence.current ||
        value.manifestId !== selectedManifestRef.current
      )
        return;
      resourceSegment(
        requestId(),
        manifestId,
        manifestGrant.revision,
        value,
        Number(count),
        false,
      );
      setProof(value);
    } catch (reason) {
      if (current(generation)) fail(reason);
    } finally {
      if (current(generation)) setBusy(false);
    }
  }
  function segment(retry: boolean) {
    try {
      if (!manifestGrant) throw new Error("请核对资源授权");
      const body = resourceSegment(
        requestId(),
        manifestId,
        manifestGrant.revision,
        proof,
        Number(count),
        retry,
      );
      void submit(base + "/manifests/" + manifestId + "/segments", body);
    } catch (reason) {
      fail(reason);
    }
  }
  const blocked = !ready || locked || busy || !!pending || !journalReady,
    source = sources.find((s) => s.alias === alias),
    claim = source?.owners.find((o) => o.sourceOwner === owner);
  const kindLabel: Record<string, string> = {
      folder: "目录",
      file: "文件",
      operation: "原操作",
    },
    stateLabel: Record<string, string> = {
      pending: "未处理",
      applied: "已应用",
      blocked: "阻断",
    };
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
        <div role="status">
          <p>
            等待资源原操作 · <span className="import-id">{pending}</span>
          </p>
          <div className="import-actions">
            <button
              className="button"
              disabled={busy || locked}
              onClick={() => void query()}
            >
              查询原操作
            </button>
            {observed?.requestId === pending &&
              observed.state === "pending" &&
              observed.manifestId && (
                <button
                  className="button secondary"
                  disabled={busy || locked}
                  onClick={() =>
                    void submit(
                      base + "/operations/" + pending + "/close",
                      { expectedKind: "capture" },
                      pending,
                    )
                  }
                >
                  关闭未确认捕获
                </button>
              )}
          </div>
        </div>
      )}
      {observed && (
        <div role="status">
          <p>
            原操作回执 · <span className="import-id">{observed.requestId}</span>
          </p>
          <p>
            {observed.state === "pending"
              ? "尚未确认"
              : observed.state === "failed"
                ? "操作失败"
                : "此操作已确认"}
          </p>
          {observed.reason && <p>{observed.reason}</p>}
          {observed.outcomes && (
            <>
              <p>
                {resourceImportPhase(
                  "sealed",
                  observed.targetImportCompleted,
                  observed.remaining,
                )}
              </p>
              {observed.outcomes.map((o) => (
                <p key={o.seq}>
                  记录 {o.seq} · {o.state === "blocked" ? "阻断" : "已应用"}
                  {o.reason ? " · " + o.reason : ""}
                </p>
              ))}
            </>
          )}
        </div>
      )}
      {!ready ? (
        <p role="status">{locked ? "当前内容已撤下" : "正在读取…"}</p>
      ) : (
        <>
          {session.user.role === "admin" && (
            <section className="import-block">
              <h2>登记资源来源</h2>
              {source && <p>{sourceWindowLabel(source.migrationWindow)}</p>}
              {!sources.length ? (
                <p>暂无已登记的资源来源</p>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (claim)
                      void submit(base + "/authorizations", {
                        sourceAlias: alias,
                        sourceOwner: owner,
                        targetUserId: claim.targetUserId,
                      });
                  }}
                >
                  <div className="import-fields">
                    <label>
                      资源来源
                      <SelectMenu
                        label="资源来源"
                        value={alias}
                        options={[
                          { value: "", label: "选择来源" },
                          ...sources.map((s) => ({
                            value: s.alias,
                            label: s.alias,
                          })),
                        ]}
                        onChange={(v) => {
                          setAlias(v);
                          setOwner("");
                        }}
                        disabled={blocked}
                      />
                    </label>
                    <label>
                      来源账号与已核验目标
                      <SelectMenu
                        label="来源账号与已核验目标"
                        value={owner}
                        options={[
                          { value: "", label: "选择来源账号" },
                          ...(source?.owners || []).map((o) => ({
                            value: o.sourceOwner,
                            label: `${o.sourceOwner} · ${o.targetName}`,
                          })),
                        ]}
                        onChange={setOwner}
                        disabled={blocked}
                      />
                    </label>
                  </div>
                  {source && source.unclaimedOwnerCount > 0 && (
                    <p role="status">部分来源账号归属尚未核验</p>
                  )}
                  <div className="import-actions">
                    <button className="button" disabled={blocked || !claim}>
                      登记资源授权
                    </button>
                  </div>
                </form>
              )}
            </section>
          )}
          <section className="import-block">
            <h2>本人资源授权</h2>
            {!grants.length ? (
              <p>暂无本人资源授权</p>
            ) : (
              <>
                <SelectMenu
                  label="本人资源授权"
                  value={grantId}
                  options={grants.map((g) => ({
                    value: g.id,
                    label: `${g.sourceAlias} · ${g.sourceOwner}`,
                  }))}
                  onChange={(v) => {
                    setGrantId(v);
                    clearSensitive();
                  }}
                  disabled={busy}
                />
                {selected && (
                  <>
                    <p>{sourcePermissionLabel(selected.state)} · {sourceWindowLabel(selected.migrationWindow)}</p>
                    {selected.state === "active" && !selected.effective && sourceWindowActive(selected.migrationWindow) && <p>来源或实例需重新核对</p>}
                    {["pending_owner", "active"].includes(selected.state) && (
                      <SourceConsentForm
                        key={secretVersion + selected.id}
                        idPrefix="resource-consent"
                        formRef={form}
                        disabled={blocked || selected.state === "pending_owner" && !sourceWindowActive(selected.migrationWindow)}
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
                    <button
                      className="button"
                      disabled={blocked || !selected.effective || !sourceWindowActive(selected.migrationWindow)}
                      onClick={() =>
                        void submit(
                          `${base}/authorizations/${selected.id}/snapshots`,
                          { revision: selected.revision },
                        )
                      }
                    >
                      捕获资源清单
                    </button>
                  </>
                )}
              </>
            )}
          </section>
          <section className="import-block">
            <h2>资源清单</h2>
            {!manifests.length ? (
              <p>暂无资源清单</p>
            ) : (
              <>
                <SelectMenu
                  label="资源清单"
                  value={manifestId}
                  options={manifests.map((m) => ({ value: m.id, label: m.id }))}
                  onChange={(id) => {
                    setManifestId(id);
                    setAfters([]);
                    clearSensitive();
                  }}
                  disabled={busy}
                />
                {selectedManifest && (
                  <>
                    <p>
                      {resourceImportPhase(
                        selectedManifest.state,
                        selectedManifest.targetImportCompleted,
                        selectedManifest.remaining,
                      )}
                    </p>
                    {selectedManifest.manifest && (
                      <p>
                        元数据 {selectedManifest.manifest.recordCount} 条 ·{" "}
                        {resourceSize(selectedManifest.manifest.rawBytes)}
                      </p>
                    )}
                    <div className="import-actions">
                      <SelectMenu
                        label="每段条数"
                        value={count}
                        options={["1", "8", "32"].map((value) => ({
                          value,
                          label: value + " 条",
                        }))}
                        onChange={setCount}
                        disabled={busy}
                      />
                      <button
                        className="button secondary"
                        disabled={
                          blocked ||
                          !manifestGrant?.effective ||
                          selectedManifest.state !== "sealed"
                        }
                        onClick={() => void preview()}
                      >
                        预览当前目标
                      </button>
                      <button
                        className="button"
                        disabled={blocked || !proof}
                        onClick={() => segment(false)}
                      >
                        执行一段
                      </button>
                      <button
                        className="button secondary"
                        disabled={blocked || !proof}
                        onClick={() => segment(true)}
                      >
                        重试阻断并继续一段
                      </button>
                    </div>
                    {proof && <p role="status">当前资源目标已预览</p>}
                    {selectedManifest.counts.map((c) => (
                      <p key={c.kind + c.state}>
                        {kindLabel[c.kind] || c.kind} ·{" "}
                        {stateLabel[c.state] || c.state} {c.count} 条
                      </p>
                    ))}
                  </>
                )}
                {detail && detail.id === manifestId && (
                  <>
                    <div className="import-list">
                      {detail.items.map((row) => (
                        <article className="import-row" key={row.seq}>
                          <div>
                            <p>{row.normalized?.name || row.source_id}</p>
                            <p>
                              {kindLabel[row.kind] || row.kind} ·{" "}
                              {stateLabel[row.state] || row.state}
                            </p>
                            {row.reason && <p role="status">{row.reason}</p>}
                            {row.kind === "file" && (
                              <p>
                                清单声明大小{" "}
                                {resourceSize(
                                  row.normalized?.size_bytes ?? Number.NaN,
                                )}
                              </p>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                    <div className="import-actions">
                      <button
                        className="button secondary"
                        disabled={!afters.length || busy}
                        onClick={() => setAfters((v) => v.slice(0, -1))}
                      >
                        上一段记录
                      </button>
                      <button
                        className="button secondary"
                        disabled={!detail.nextAfter || busy}
                        onClick={() =>
                          detail.nextAfter &&
                          setAfters((v) => [...v, detail.nextAfter!])
                        }
                      >
                        下一段记录
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
            <div className="import-actions">
              <button
                className="button secondary"
                disabled={!manifestCursors.length || busy}
                onClick={() => setManifestCursors((v) => v.slice(0, -1))}
              >
                上一页清单
              </button>
              <button
                className="button secondary"
                disabled={!nextManifest || busy}
                onClick={() =>
                  nextManifest &&
                  setManifestCursors((v) => [...v, nextManifest])
                }
              >
                下一页清单
              </button>
            </div>
          </section>
          <section className="import-block">
            <h2>资源操作记录</h2>
            {operations.map((o) => (
              <article className="import-row" key={o.requestId}>
                <div>
                  <p className="import-id">{o.requestId}</p>
                  <p>
                    {o.result.state === "completed"
                      ? "此操作已完成"
                      : o.result.state === "pending"
                        ? "捕获未确认"
                        : "操作失败"}
                  </p>
                </div>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void query(o.requestId)}
                >
                  查询原操作
                </button>
              </article>
            ))}
            <div className="import-actions">
              <button
                className="button secondary"
                disabled={!operationCursors.length || busy}
                onClick={() => setOperationCursors((v) => v.slice(0, -1))}
              >
                上一页操作
              </button>
              <button
                className="button secondary"
                disabled={!nextOperation || busy}
                onClick={() =>
                  nextOperation &&
                  setOperationCursors((v) => [...v, nextOperation])
                }
              >
                下一页操作
              </button>
            </div>
          </section>
        </>
      )}
    </section>
  );
}
