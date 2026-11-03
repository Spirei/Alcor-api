import { WatchGroupSourceIcons } from "./watch-group-source-icons";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { SourceConsentForm } from "./legacy-import";
import { requestId } from "./request-id";
import { SelectMenu } from "./select-menu";
import { sourceWindowLabel, sourceReadFailure } from "./source-window-view";
import {
  mayReleaseMissingReceipt,
  submissionDisposition,
} from "./portfolio-operation";
import {
  clearSourceRequests,
  readSourceRequest,
  retainSourceRequest,
  releaseSourceRequest,
  sourceCanCapture,
  sourceGrants,
  sourceManifest,
  sourceProof,
  sourceReceipt,
  sourceReason,
  sourceReceiptLabel,
  sourceOutcomes,
  sourceUuid,
  type SourcePending,
  type SourceGrant,
  type SourceManifest,
  type SourceProof,
  type SourceReceipt,
  type SourceRow,
} from "./watch-group-source-state";
import "./watch-group-source.css";
const base = "/watch-group-import",
  grantsBase = "/legacy-financial";
type Props = {
  session: Session;
  active: boolean;
  blocked: boolean;
  revision: number | null;
  onBlocked: (value: boolean) => void;
  onChanged: () => void;
  onDenied: (reason: unknown) => void;
};
export function WatchGroupSourcePanel(props: Props) {
  const scope = JSON.stringify([
    props.session.instance_id,
    props.session.user.id,
    props.session.user.role,
    props.session.receipt_scope,
  ]);
  return (
    <SourceSession
      key={JSON.stringify([
        scope,
        props.session.csrf,
        props.session.expires_at,
      ])}
      {...props}
      scope={scope}
    />
  );
}
function SourceSession({
  session,
  active,
  blocked,
  revision,
  onBlocked,
  onChanged,
  onDenied,
  scope,
}: Props & { scope: string }) {
  const [open, setOpen] = useState(false),
    [locked, setLocked] = useState(false),
    [busy, setBusy] = useState(false),
    [iconBusy, setIconBusy] = useState(false),
    [ready, setReady] = useState(false),
    [grants, setGrants] = useState<SourceGrant[]>([]),
    [selected, setSelected] = useState(""),
    [pending, setPending] = useState<SourcePending | null>(null),
    [lookup, setLookup] = useState(""),
    [lookupKind, setLookupKind] = useState<"grant" | "capture">("capture"),
    [manifestId, setManifestId] = useState(""),
    [manifest, setManifest] = useState<SourceManifest | null>(null),
    [proof, setProof] = useState<SourceProof | null>(null),
    [receipt, setReceipt] = useState<SourceReceipt | null>(null),
    [outcomes, setOutcomes] = useState<{
      items: SourceRow[];
      next: number | null;
    } | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const live = useRef(false),
    epoch = useRef(0),
    work = useRef<AbortController | null>(null),
    original = useRef<SourcePending | null>(null),
    formRef = useRef<HTMLFormElement | null>(null);
  const displayed = useCallback(
    () => apiSessionSnapshot().csrf === session.csrf,
    [session.csrf],
  );
  const pause = useCallback(() => {
    live.current = false;
    ++epoch.current;
    work.current?.abort();
    work.current = null;
    setProof(null);
    setBusy(false);
    for (const input of formRef.current?.querySelectorAll("input") ?? [])
      input.value = "";
  }, []);
  const fail = useCallback(
    (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "来源操作待核对");
      if (
        !displayed() ||
        (reason instanceof ApiError &&
          ([401, 403].includes(reason.status) ||
            reason.code === "session_changed"))
      ) {
        pause();
        setLocked(true);
        setGrants([]);
        setManifest(null);
        setReceipt(null);
        setOutcomes(null);
        setSelected("");
        setLookup("");
        setManifestId("");
        setPending(null);
        original.current = null;
        try {
          clearSourceRequests(sessionStorage);
        } catch {}
        onBlocked(true);
        onDenied(reason);
      }
    },
    [displayed, pause, onBlocked, onDenied],
  );
  useLayoutEffect(() => {
    live.current = active && open && !locked && displayed() && !document.hidden;
    ++epoch.current;
    return pause;
  }, [active, open, locked, displayed, pause]);
  useEffect(() => {
    if (!active || locked || !displayed()) return;
    try {
      const value = readSourceRequest(sessionStorage, scope);
      original.current = value;
      setPending(value);
      onBlocked(!!value);
    } catch (reason) {
      fail(reason);
      setLocked(true);
      onBlocked(true);
    }
  }, [active, scope, locked, displayed, fail, onBlocked]);
  useEffect(() => {
    onBlocked(busy || !!pending || locked || iconBusy);
  }, [busy, pending, locked, iconBusy, onBlocked]);
  useEffect(() => {
    if (proof && revision !== null && proof.groupRevision !== revision)
      setProof(null);
  }, [revision, proof]);
  const current = (generation: number) =>
    live.current && displayed() && generation === epoch.current;
  const load = useCallback(async () => {
    if (!live.current || !displayed() || work.current) return;
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    setReady(false);
    try {
      const value = sourceGrants(
        await api<unknown>(grantsBase + "/authorizations", {
          signal: controller.signal,
        }),
        session.user.id,
      );
      if (live.current && displayed() && generation === epoch.current) {
        setGrants(value);
        setSelected((v) =>
          value.some((g) => g.id === v)
            ? v
            : (value.find((g) => g.state === "active")?.id ??
              value.find((g) => g.state === "pending_owner")?.id ??
              ""),
        );
        setReady(true);
        setError("");
      }
    } catch (reason) {
      if (
        live.current &&
        generation === epoch.current &&
        !controller.signal.aborted
      ) {
        setGrants([]);
        fail(reason);
      }
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (generation === epoch.current) setBusy(false);
      }
    }
  }, [displayed, fail, session.user.id]);
  useEffect(() => {
    if (open && active && !locked) void load();
  }, [open, active, locked, load]);
  async function readManifest(id = manifestId, after = 0) {
    if (!sourceUuid(id) || !live.current || work.current) return;
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    setProof(null);
    try {
      const value = sourceManifest(
        await api<unknown>(
          base + "/manifests/" + id + (after ? "?after=" + after : ""),
          { signal: controller.signal },
        ),
        id,
      );
      if (current(generation)) {
        setManifest(value);
        setManifestId(id);
        setError("");
      }
    } catch (reason) {
      if (current(generation) && !controller.signal.aborted) {
        setManifest(null);
        fail(reason);
      }
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (current(generation)) setBusy(false);
      }
    }
  }
  function accepted(value: SourceReceipt, p: SourcePending) {
    setReceipt(value);
    setOutcomes(null);
    setLookup(p.id);
    setLookupKind(p.kind === "grant" ? "grant" : "capture");
    setError("");
    setNotice("");
    if (value.state !== "reading") {
      releaseSourceRequest(sessionStorage, scope, p.id);
      if (original.current?.id === p.id) {
        original.current = null;
        setPending(null);
      }
      setProof(null);
      if (value.kind === "apply") onChanged();
    }
    if (
      value.kind === "capture" &&
      !value.domain &&
      value.state === "completed" &&
      value.manifestId
    ) {
      setManifestId(value.manifestId);
      setManifest(null);
    }
    if (p.kind === "grant") {
      setReady(false);
      setGrants([]);
    }
  }
  async function check() {
    if (!live.current || work.current) return;
    const p = original.current ?? { id: lookup.trim(), kind: lookupKind };
    if (!sourceUuid(p.id)) {
      setError("请输入有效操作编号");
      return;
    }
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    try {
      const value = sourceReceipt(
        await api<unknown>(
          (p.kind === "grant" ? grantsBase : base) + "/operations/" + p.id,
          { signal: controller.signal },
        ),
        p.id,
        p.kind,
      );
      if (current(generation)) accepted(value, p);
    } catch (reason) {
      if (current(generation) && !controller.signal.aborted) {
        if (
          reason instanceof ApiError &&
          reason.status === 404 &&
          mayReleaseMissingReceipt(p.submissionStatus)
        ) {
          releaseSourceRequest(sessionStorage, scope, p.id);
          original.current = null;
          setPending(null);
          setProof(null);
          setNotice("原操作未受理，请重新读取后核对");
        } else fail(reason);
      }
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (current(generation)) setBusy(false);
      }
    }
  }
  async function post(
    kind: SourcePending["kind"],
    path: string,
    data: Record<string, unknown>,
  ) {
    if (
      !live.current ||
      !displayed() ||
      work.current ||
      original.current ||
      iconBusy ||
      blocked
    )
      return;
    const id = requestId(),
      p: SourcePending = { id, kind },
      generation = epoch.current,
      controller = new AbortController();
    try {
      retainSourceRequest(sessionStorage, scope, p);
    } catch (reason) {
      fail(reason);
      return;
    }
    original.current = p;
    setPending(p);
    setBusy(true);
    setProof(null);
    setReceipt(null);
    setError("");
    work.current = controller;
    try {
      const value = sourceReceipt(
        await api<unknown>(
          path,
          {
            method: "POST",
            body: JSON.stringify({ ...data, requestId: id }),
            signal: controller.signal,
          },
          session.csrf,
          30000,
        ),
        id,
        kind,
      );
      if (current(generation)) accepted(value, p);
    } catch (reason) {
      if (current(generation) && !controller.signal.aborted) {
        if (reason instanceof ApiError) {
          p.submissionStatus = reason.status;
          retainSourceRequest(sessionStorage, scope, p);
          setPending({ ...p });
          if (submissionDisposition(reason.status) === "rejected") {
            releaseSourceRequest(sessionStorage, scope, id);
            original.current = null;
            setPending(null);
          }
        }
        fail(reason);
      }
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (current(generation)) setBusy(false);
      }
    }
  }
  async function preview() {
    if (
      !manifest ||
      !live.current ||
      work.current ||
      original.current ||
      iconBusy ||
      blocked
    )
      return;
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    setProof(null);
    try {
      const value = sourceProof(
        await api<unknown>(
          base + "/manifests/" + manifest.id + "/preview",
          { method: "POST", body: "{}", signal: controller.signal },
          session.csrf,
        ),
        manifest.id,
      );
      if (current(generation)) {
        if (revision !== null && revision !== value.groupRevision) {
          onChanged();
          setError("分组版本已变化，请重新读取后预览");
        } else {
          setProof(value);
          setError("");
        }
      }
    } catch (reason) {
      if (current(generation) && !controller.signal.aborted) fail(reason);
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (current(generation)) setBusy(false);
      }
    }
  }
  async function readOutcomes(after = 0) {
    if (
      !receipt ||
      receipt.kind !== "apply" ||
      receipt.domain ||
      !live.current ||
      work.current
    )
      return;
    const id = receipt.requestId,
      generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    try {
      const value = sourceOutcomes(
        await api<unknown>(
          base +
            "/operations/" +
            id +
            "/members" +
            (after ? "?after=" + after : ""),
          { signal: controller.signal },
        ),
        id,
      );
      if (current(generation)) {
        setOutcomes(value);
        setError("");
      }
    } catch (reason) {
      if (current(generation) && !controller.signal.aborted) fail(reason);
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (current(generation)) setBusy(false);
      }
    }
  }
  async function close() {
    const p = original.current;
    if (!p || p.kind !== "capture" || !live.current || work.current) return;
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    try {
      const value = sourceReceipt(
        await api<unknown>(
          base + "/operations/" + p.id + "/close",
          { method: "POST", body: "{}", signal: controller.signal },
          session.csrf,
        ),
        p.id,
        p.kind,
      );
      if (current(generation)) accepted(value, p);
    } catch (reason) {
      if (current(generation) && !controller.signal.aborted) fail(reason);
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (current(generation)) setBusy(false);
      }
    }
  }
  const grant = grants.find((g) => g.id === selected),
    disabled =
      !active || !open || locked || busy || !!pending || blocked || iconBusy,
    archiveAllowed =
      manifest?.currentSourceAccess.grantState === "active" &&
      manifest.currentSourceAccess.grantRevisionMatches;
  const window = grant?.migrationWindow,
    shownWindow =
      window?.state === "active" &&
      Date.now() >= Date.parse(window.expiresAt ?? "")
        ? { ...window, state: "expired" }
        : window;
  return (
    <details
      className="watch-group-source"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>来源迁移{pending ? " · 原操作待核对" : ""}</summary>
      {open && (
        <div className="watch-group-source-body">
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          <div className="watch-group-source-controls">
            <SelectMenu
              label="来源授权"
              value={selected}
              options={[
                { value: "", label: "选择来源" },
                ...grants.map((g) => ({
                  value: g.id,
                  label: g.source_alias + " · " + g.source_owner,
                })),
              ]}
              onChange={(v) => {
                setSelected(v);
                setProof(null);
              }}
              disabled={disabled || !ready}
              variant="field"
            />
            <button
              className="button secondary"
              type="button"
              disabled={!active || locked || busy}
              onClick={() => void load()}
            >
              刷新授权
            </button>
            <Link to="/legacy-import">来源授权</Link>
          </div>
          {ready && !grants.length && <p>暂无来源授权</p>}
          {grant && (
            <>
              <p>{sourceWindowLabel(shownWindow)}</p>
              <details>
                <summary>来源详情</summary>
                <dl>
                  <dt>来源实例</dt>
                  <dd>{grant.source_instance}</dd>
                  <dt>原账号</dt>
                  <dd>{grant.source_owner}</dd>
                  <dt>授权状态</dt>
                  <dd>
                    {grant.state === "active"
                      ? "本人已同意"
                      : grant.state === "pending_owner"
                        ? "待本人同意"
                        : "已撤销"}
                  </dd>
                </dl>
              </details>
              {active &&
                !locked &&
                ["pending_owner", "active"].includes(grant.state) && (
                  <details open={grant.state === "pending_owner"}>
                    <summary>
                      {grant.state === "pending_owner"
                        ? "确认来源授权"
                        : "撤销来源授权"}
                    </summary>
                    {grant.state === "active" && (
                      <p>已保存清单仍可查看，新的应用将被拒绝</p>
                    )}
                    <SourceConsentForm
                      key={grant.id + ":" + grant.revision}
                      idPrefix="watch-source-consent"
                      formRef={formRef}
                      disabled={
                        disabled ||
                        (grant.state === "pending_owner" &&
                          (grant.effectiveState !== "pending_owner" ||
                            !sourceCanCapture(
                              {
                                ...grant,
                                state: "active",
                                effectiveState: "active",
                              },
                              session.instance_id,
                            )))
                      }
                      approve={grant.state === "pending_owner"}
                      onSubmit={(approve, password, code) =>
                        void post(
                          "grant",
                          grantsBase +
                            "/authorizations/" +
                            grant.id +
                            "/consent",
                          { revision: grant.revision, password, code, approve },
                        )
                      }
                    />
                  </details>
                )}
              <button
                className="button secondary"
                type="button"
                disabled={
                  disabled || !sourceCanCapture(grant, session.instance_id)
                }
                onClick={() => {
                  if (sourceCanCapture(grant, session.instance_id))
                    void post(
                      "capture",
                      base + "/authorizations/" + grant.id + "/snapshots",
                      { grantRevision: grant.revision },
                    );
                  else setError("来源读取窗口已到期或无法核验，请刷新授权");
                }}
              >
                读取旧分组
              </button>
            </>
          )}
          <div className="watch-group-source-controls">
            <label>
              已保存清单编号
              <input
                value={manifestId}
                onChange={(e) => {
                  setManifestId(e.target.value);
                  setProof(null);
                  setManifest(null);
                }}
                disabled={locked || busy || !!pending}
                spellCheck={false}
              />
            </label>
            <button
              className="button secondary"
              type="button"
              disabled={!active || locked || busy || !sourceUuid(manifestId)}
              onClick={() => void readManifest()}
            >
              查看清单
            </button>
          </div>
          {manifest && (
            <>
              <dl>
                <dt>来源实例</dt>
                <dd>{manifest.source.instance}</dd>
                <dt>原账号</dt>
                <dd>{manifest.source.owner}</dd>
                <dt>分组</dt>
                <dd>{manifest.counts.watch_groups}</dd>
                <dt>原记录</dt>
                <dd>{manifest.counts.records}</dd>
              </dl>
              {!proof && <SourceRows rows={manifest.groups} />}
              <details>
                <summary>原记录清单</summary>
                <SourceRows rows={manifest.members} members />
                <button
                  className="button secondary"
                  type="button"
                  disabled={disabled || manifest.next === null}
                  onClick={() =>
                    void readManifest(manifest.id, manifest.next ?? 0)
                  }
                >
                  下一页
                </button>
              </details>
              <details>
                <summary>原始证据</summary>
                <dl>
                  <dt>清单编号</dt>
                  <dd>{manifest.id}</dd>
                  <dt>原始摘要</dt>
                  <dd>{manifest.rawSha256}</dd>
                  <dt>保存时间</dt>
                  <dd>{manifest.publishedAt}</dd>
                </dl>
              </details>
              {!archiveAllowed && (
                <p role="status">本人来源授权已撤销或版本已变化</p>
              )}
              <button
                className="button secondary"
                type="button"
                disabled={disabled || !archiveAllowed}
                onClick={() => void preview()}
              >
                预览分组与归属
              </button>
            </>
          )}
          {proof && (
            <div className="watch-group-source-proof">
              <SourceRows rows={proof.groups} />
              <p>
                待核对分组 {proof.unknownGroups} · 待核对记录{" "}
                {proof.unknownMembers} · 待处理图标 {proof.iconPending}
              </p>
              {(proof.orderingUnknown > 0 || proof.metadataTimeUnknown > 0) && (
                <p>
                  排序未知 {proof.orderingUnknown} · 原记录时间未知{" "}
                  {proof.metadataTimeUnknown}
                </p>
              )}
              <details>
                <summary>
                  记录归属 · {proof.memberCount} 条
                  {proof.membersTruncated ? " · 仅显示前100条" : ""}
                </summary>
                <SourceRows rows={proof.members} members />
              </details>
              <button
                type="button"
                className="button primary"
                disabled={disabled || !proof.ready || !archiveAllowed}
                onClick={() =>
                  void post(
                    "apply",
                    base + "/manifests/" + proof.manifestId + "/operations",
                    {
                      preview: proof.preview,
                      expectedGroupRevision: proof.groupRevision,
                      expectedRecordRevision: proof.recordRevision,
                    },
                  )
                }
              >
                应用已核对项
              </button>
            </div>
          )}
          {!locked && (
            <WatchGroupSourceIcons
              session={session}
              active={active && open && !locked}
              blocked={locked || busy || !!pending || blocked}
              revision={revision}
              manifest={manifest}
              receipt={receipt}
              onBusy={setIconBusy}
              onCommand={post}
              onDenied={fail}
            />
          )}
          <div className="watch-group-source-controls">
            <SelectMenu
              label="回执类型"
              value={
                pending?.kind === "grant"
                  ? "grant"
                  : pending
                    ? "capture"
                    : lookupKind
              }
              options={[
                { value: "capture", label: "分组迁移" },
                { value: "grant", label: "来源授权" },
              ]}
              onChange={(v) => setLookupKind(v as "grant" | "capture")}
              disabled={locked || busy || !!pending}
              variant="field"
            />
            <label>
              操作编号
              <input
                value={pending?.id ?? lookup}
                onChange={(e) => setLookup(e.target.value)}
                readOnly={!!pending}
                disabled={locked}
                spellCheck={false}
              />
            </label>
            <button
              className="button secondary"
              type="button"
              disabled={
                !active || locked || busy || !sourceUuid(pending?.id ?? lookup)
              }
              onClick={() => void check()}
            >
              查询原回执
            </button>
            {pending?.kind === "capture" && (
              <button
                className="button secondary"
                type="button"
                disabled={!active || locked || busy}
                onClick={() => void close()}
              >
                关闭原读取
              </button>
            )}
          </div>
          {pending && <p role="status">原操作待核对 · {pending.id}</p>}
          {receipt && (
            <div role="status">
              <p>{sourceReceiptLabel(receipt)}</p>
              {receipt.reason && <p>{sourceReadFailure(receipt.reason)}</p>}
              <details>
                <summary>回执详情</summary>
                <dl>
                  <dt>操作编号</dt>
                  <dd>{receipt.requestId}</dd>
                  <dt>结果</dt>
                  <dd>{receipt.state}</dd>
                  {receipt.manifestId && (
                    <>
                      <dt>清单编号</dt>
                      <dd>{receipt.manifestId}</dd>
                    </>
                  )}
                </dl>
                {receipt.groupOutcomes && (
                  <SourceRows rows={receipt.groupOutcomes} applied />
                )}
                {receipt.kind === "apply" && !receipt.domain && (
                  <>
                    <button
                      className="button secondary"
                      type="button"
                      disabled={!active || locked || busy}
                      onClick={() => void readOutcomes()}
                    >
                      查看归属结果
                    </button>
                    {outcomes && (
                      <>
                        <SourceRows rows={outcomes.items} members applied />
                        <button
                          className="button secondary"
                          type="button"
                          disabled={
                            !active || locked || busy || outcomes.next === null
                          }
                          onClick={() => void readOutcomes(outcomes.next ?? 0)}
                        >
                          下一页归属结果
                        </button>
                      </>
                    )}
                  </>
                )}
              </details>
            </div>
          )}
        </div>
      )}
    </details>
  );
}
export function SourceRows({
  rows,
  members = false,
  applied = false,
}: {
  rows: SourceRow[];
  members?: boolean;
  applied?: boolean;
}) {
  return (
    <div className="watch-group-source-table">
      <table>
        <thead>
          <tr>
            <th>{members ? "原记录" : "原分组"}</th>
            <th>{members ? "目标记录" : "目标"}</th>
            {members ? (
              <th>归属</th>
            ) : (
              <>
                <th>排序</th>
                <th>显示方式</th>
              </>
            )}
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.sequence}>
              <td>
                {r.name ?? r.originalId ?? "编号未知"}
                {r.name && <small>{r.originalId}</small>}
              </td>
              <td>
                {(members ? r.targetRecordId : r.targetId) ??
                  (r.state === "ready" ? "待新建" : "待核对")}
              </td>
              {members && (
                <td>
                  {Object.prototype.hasOwnProperty.call(r, "targetGroupId")
                    ? r.state === "unknown"
                      ? "未变更"
                      : (r.targetGroupId ?? "未分组")
                    : r.groupId
                      ? "原组 " + r.groupId
                      : "未分组"}
                </td>
              )}
              {!members && (
                <>
                  <td>{r.sort ?? "未知"}</td>
                  <td>
                    {r.visible === 0
                      ? "隐藏"
                      : r.visible === 1
                        ? "显示"
                        : r.visible === -1
                          ? "自动"
                          : "未知"}
                  </td>
                </>
              )}
              <td>
                {r.state === "ready"
                  ? applied
                    ? "已核对"
                    : "可应用"
                  : r.state === "unknown" || r.blocker
                    ? "待核对"
                    : "已保存"}
                {(r.reason || r.blocker) && (
                  <small>{sourceReason(r.reason ?? r.blocker)}</small>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p>清单无条目</p>}
    </div>
  );
}
