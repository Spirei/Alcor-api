import { LoadingPlaceholder } from "./loading-placeholder";
import { WorkspaceTabs, WorkspaceView } from "./workspace-ui";
import { useState as useWorkspaceState } from "react";
import {
  WatchDisplaySettings,
  arrangeWatchRows,
  watchDisplayValue,
  type WatchDisplayState,
} from "./watch-display-settings";
import { WatchGroupSourcePanel } from "./watch-group-source";
import { WatchGroupIcons } from "./watch-group-icons";
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
import { Dialog } from "./dialog";
import {
  clearGroupRequests,
  readGroupRequest,
  retainGroupRequest,
  releaseGroupRequest,
  validGroupRequest,
  groupListing,
  groupRecords,
  groupReceipt,
  groupCommand,
  groupLabel,
  groupRecordsPath,
  visibilityOptions,
  type GroupListing,
  type GroupRecords,
  type WatchGroup,
  type GroupReceipt,
  type GroupAction,
} from "./watch-groups-state";
import "./watch-groups.css";
const base = "/watch-groups";
type Edit = { name: string; visible: string };
type Broker = { id: string; name: string };
export function WatchGroupsPage({
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
  return (
    <WatchGroupsSession
      key={JSON.stringify([scope, session.csrf, session.expires_at])}
      {...{ session, active, scope }}
    />
  );
}
function WatchGroupsSession({
  session,
  active,
  scope,
}: {
  session: Session;
  active: boolean;
  scope: string;
}) {
  const [workspaceSection, setWorkspaceSection] = useWorkspaceState("groups");

  const [visible, setVisible] = useState(
      typeof document === "undefined" || !document.hidden,
    ),
    [locked, setLocked] = useState(false),
    [ready, setReady] = useState(false),
    [journalReady, setJournalReady] = useState(false);
  const [watchDisplay, setWatchDisplay] = useState<WatchDisplayState | null>(
    null,
  );
  const [sourceBlocked, setSourceBlocked] = useState(false);
  const sourcePending = useRef(false);
  const changeSourceBlocked = useCallback((value: boolean) => {
    sourcePending.current = value;
    setSourceBlocked(value);
  }, []);
  const [iconBlocked, setIconBlocked] = useState(true);
  const iconPending = useRef(true);
  const changeIconBlocked = useCallback((value: boolean) => {
    iconPending.current = value;
    setIconBlocked(value);
  }, []);
  const [groups, setGroups] = useState<GroupListing | null>(null),
    [filter, setFilter] = useState(""),
    [name, setName] = useState(""),
    [edits, setEdits] = useState<Record<string, Edit>>({}),
    [deleting, setDeleting] = useState<WatchGroup | null>(null);
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState<string | null>(null),
    [lookup, setLookup] = useState(""),
    [receipt, setReceipt] = useState<GroupReceipt | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [members, setMembers] = useState(false),
    [records, setRecords] = useState<GroupRecords | null>(null),
    [brokers, setBrokers] = useState<Broker[] | null>(null),
    [recordError, setRecordError] = useState(""),
    [directoryError, setDirectoryError] = useState(""),
    [recordRefresh, setRecordRefresh] = useState(0);
  const [view, setView] = useState("__all"),
    [account, setAccount] = useState(""),
    [page, setPage] = useState(1),
    [target, setTarget] = useState(""),
    [selected, setSelected] = useState<string[]>([]);
  const live = useRef(false),
    epoch = useRef(0),
    read = useRef(0),
    recordRead = useRef(0),
    original = useRef<string | null>(null),
    rejected = useRef<number | undefined>(undefined),
    rejectionMessage = useRef(""),
    action = useRef<GroupAction | null>(null),
    collection = useRef<number | null>(null);
  const work = useRef<AbortController | null>(null),
    reading = useRef<AbortController | null>(null),
    financial = useRef<AbortController | null>(null);
  const displayed = useCallback(
    () => apiSessionSnapshot().csrf === session.csrf,
    [session.csrf],
  );
  const displayRevision = useRef<string | null>(null);
  const clearFinancial = useCallback(() => {
    ++recordRead.current;
    financial.current?.abort();
    financial.current = null;
    collection.current = null;
    displayRevision.current = null;
    setRecords(null);
    setBrokers(null);
    setSelected([]);
    setRecordError("");
    setDirectoryError("");
    setPage(1);
    setRecordRefresh((v) => v + 1);
  }, []);
  const pause = useCallback(() => {
    live.current = false;
    ++epoch.current;
    ++read.current;
    work.current?.abort();
    work.current = null;
    reading.current?.abort();
    reading.current = null;
    clearFinancial();
    setDeleting(null);
    setReceipt(null);
    setReady(false);
    setBusy(false);
  }, [clearFinancial]);
  const fail = useCallback(
    (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "读取失败");
      if (
        !displayed() ||
        (reason instanceof ApiError &&
          ([401, 403].includes(reason.status) ||
            reason.code === "session_changed"))
      ) {
        pause();
        setLocked(true);
        setGroups(null);
        setFilter("");
        setName("");
        setEdits({});
        setView("__all");
        setAccount("");
        setTarget("");
        setLookup("");
        setNotice("");
        original.current = null;
        setPending(null);
        rejected.current = undefined;
        action.current = null;
        try {
          clearGroupRequests(sessionStorage);
        } catch {}
      }
    },
    [displayed, pause],
  );
  useLayoutEffect(() => {
    live.current = active && visible && !locked && displayed();
    ++epoch.current;
    setReady(false);
    return pause;
  }, [active, visible, locked, displayed, pause]);
  useEffect(() => {
    const change = () => {
      if (document.hidden) pause();
      setVisible(!document.hidden);
    };
    change();
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, [pause]);
  useEffect(() => {
    if (!live.current || !displayed()) return;
    try {
      const id = readGroupRequest(sessionStorage, scope);
      original.current = id;
      setPending(id);
      setJournalReady(true);
    } catch (reason) {
      setLocked(true);
      fail(reason);
    }
  }, [active, visible, scope, displayed, fail]);
  const load = useCallback(async () => {
    if (!live.current || !displayed()) return;
    const generation = epoch.current,
      sequence = ++read.current,
      controller = new AbortController();
    reading.current?.abort();
    reading.current = controller;
    setReady(false);
    try {
      const raw = await api<unknown>(base, { signal: controller.signal });
      if (
        live.current &&
        displayed() &&
        generation === epoch.current &&
        sequence === read.current
      ) {
        const listing = groupListing(raw);
        setGroups(listing);
        setTarget((current) =>
          listing.groups.some((group) => group.id === current) ? current : "",
        );
        setReady(true);
        setError("");
      }
    } catch (reason) {
      if (
        live.current &&
        generation === epoch.current &&
        sequence === read.current &&
        !controller.signal.aborted
      )
        fail(reason);
    } finally {
      if (reading.current === controller) reading.current = null;
    }
  }, [displayed, fail]);
  useEffect(() => {
    if (active && visible && !locked) void load();
  }, [active, visible, locked, load]);
  const loadRecords = useCallback(async () => {
    if (!live.current || !displayed()) return;
    if (page > 1 && collection.current === null) {
      setPage(1);
      return;
    }
    const generation = epoch.current,
      sequence = ++recordRead.current,
      controller = new AbortController();
    financial.current?.abort();
    financial.current = controller;
    setRecords(null);
    setBrokers(null);
    setSelected([]);
    setRecordError("");
    setDirectoryError("");
    const results = await Promise.allSettled([
      api<unknown>(
        groupRecordsPath(
          page,
          collection.current,
          view,
          account,
          displayRevision.current,
          "watch",
        ),
        {
          signal: controller.signal,
        },
      ),
      api<{ items: Broker[] }>("/broker-accounts", {
        signal: controller.signal,
      }),
    ]);
    if (
      !live.current ||
      !displayed() ||
      generation !== epoch.current ||
      sequence !== recordRead.current ||
      controller.signal.aborted
    )
      return;
    for (const result of results)
      if (
        result.status === "rejected" &&
        result.reason instanceof ApiError &&
        ([401, 403].includes(result.reason.status) ||
          result.reason.code === "session_changed")
      ) {
        fail(result.reason);
        return;
      }
    const [listing, directory] = results;
    if (listing.status === "fulfilled") {
      try {
        const value = groupRecords(listing.value, page);
        if (value.displayMode !== "watch" || !value.displayRevision)
          throw new Error("自选显示版本待核对，请重新读取");
        collection.current = value.collectionRevision;
        displayRevision.current = value.displayRevision ?? null;
        setRecords(value);
      } catch (reason) {
        setRecordError(reason instanceof Error ? reason.message : "记录待核对");
      }
    } else {
      if (listing.reason instanceof ApiError && listing.reason.status === 409)
        clearFinancial();
      setRecordError(
        listing.reason instanceof Error
          ? listing.reason.message
          : "记录读取失败",
      );
    }
    if (
      directory.status === "fulfilled" &&
      Array.isArray(directory.value.items) &&
      directory.value.items.every(
        (b) => typeof b.id === "string" && typeof b.name === "string",
      )
    )
      setBrokers(directory.value.items.map(({ id, name }) => ({ id, name })));
    else
      setDirectoryError(
        directory.status === "rejected" && directory.reason instanceof Error
          ? directory.reason.message
          : "账户列表待核对",
      );
    if (financial.current === controller) financial.current = null;
  }, [page, view, account, displayed, fail]);
  useEffect(() => {
    if (members && active && visible && !locked) void loadRecords();
  }, [
    members,
    active,
    visible,
    locked,
    groups?.revision,
    recordRefresh,
    loadRecords,
  ]);
  function changeRecordFilter(nextView: string, nextAccount: string) {
    clearFinancial();
    setView(nextView);
    setAccount(nextAccount);
  }
  function known(raw: unknown, id: string) {
    const value = groupReceipt(raw, id);
    if (
      original.current === id &&
      action.current &&
      (["create", "update"].includes(action.current)
        ? !value.group
        : action.current === "initialize"
          ? value.initialized !== true
          : action.current === "delete"
            ? typeof value.deleted !== "boolean"
            : value.updated === undefined)
    )
      throw new Error("原操作结果类型不符，请继续核对");
    if (original.current === id) {
      releaseGroupRequest(sessionStorage, scope, id);
      original.current = null;
      setPending(null);
      rejected.current = undefined;
      if (action.current === "create") setName("");
      action.current = null;
    }
    setLookup(id);
    setReceipt(value);
    setError("");
    setNotice("");
    clearFinancial();
    void load();
  }
  function missingRejected(id: string) {
    releaseGroupRequest(sessionStorage, scope, id);
    original.current = null;
    setPending(null);
    rejected.current = undefined;
    action.current = null;
    setNotice(
      (rejectionMessage.current ? rejectionMessage.current + "；" : "") +
        "上次操作未受理，请核对最新列表后再操作",
    );
    rejectionMessage.current = "";
    void load();
  }
  async function check(id = original.current ?? lookup.trim()) {
    if (!live.current || !displayed() || work.current) return;
    if (!validGroupRequest(id)) {
      setError("请输入有效操作编号");
      return;
    }
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    setError("");
    try {
      const value = await api<unknown>(base + "/operations/" + id, {
        signal: controller.signal,
      });
      if (live.current && displayed() && generation === epoch.current)
        known(value, id);
    } catch (reason) {
      if (
        live.current &&
        generation === epoch.current &&
        !controller.signal.aborted
      ) {
        if (
          reason instanceof ApiError &&
          reason.status === 404 &&
          original.current === id &&
          rejected.current !== undefined
        )
          missingRejected(id);
        else {
          fail(reason);
          if (
            reason instanceof ApiError &&
            reason.status === 404 &&
            original.current === id
          )
            setNotice("尚未查到原回执，操作结果仍待核对");
        }
      }
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (generation === epoch.current) setBusy(false);
      }
    }
  }
  async function mutate(kind: GroupAction, fields: Record<string, unknown>) {
    if (
      !live.current ||
      !displayed() ||
      work.current ||
      original.current ||
      iconPending.current ||
      sourcePending.current ||
      !ready ||
      !journalReady ||
      !groups
    )
      return;
    const id = requestId(),
      generation = epoch.current,
      controller = new AbortController();
    let body;
    try {
      body = groupCommand(groups, kind, fields, id, records);
      retainGroupRequest(sessionStorage, scope, id);
    } catch (reason) {
      fail(reason);
      return;
    }
    original.current = id;
    action.current = kind;
    rejected.current = undefined;
    setPending(id);
    setReceipt(null);
    setNotice("");
    setError("");
    setDeleting(null);
    work.current = controller;
    setBusy(true);
    try {
      const value = await api<unknown>(
        base + "/operations",
        {
          method: "POST",
          body: JSON.stringify(body),
          signal: controller.signal,
        },
        session.csrf,
      );
      if (live.current && displayed() && generation === epoch.current)
        known(value, id);
    } catch (reason) {
      if (
        live.current &&
        generation === epoch.current &&
        !controller.signal.aborted
      ) {
        fail(reason);
        if (reason instanceof ApiError && ![401, 403].includes(reason.status)) {
          if (
            [400, 404, 405, 409, 413, 415, 422, 429].includes(reason.status)
          ) {
            rejected.current = reason.status;
            rejectionMessage.current = reason.message;
          }
          try {
            const value = await api<unknown>(base + "/operations/" + id, {
              signal: controller.signal,
            });
            if (live.current && displayed() && generation === epoch.current)
              known(value, id);
          } catch (lookupError) {
            if (
              live.current &&
              generation === epoch.current &&
              !controller.signal.aborted
            ) {
              if (
                lookupError instanceof ApiError &&
                lookupError.status === 404 &&
                rejected.current !== undefined
              )
                missingRejected(id);
              else if (
                lookupError instanceof ApiError &&
                [401, 403].includes(lookupError.status)
              )
                fail(lookupError);
              else setNotice("操作结果尚未确认，请查询原操作编号");
            }
          }
        } else if (!(reason instanceof ApiError))
          setNotice("操作结果尚未确认，请查询原操作编号");
      }
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (generation === epoch.current) setBusy(false);
      }
    }
  }
  const disabled =
    !active ||
    !visible ||
    locked ||
    !ready ||
    !journalReady ||
    busy ||
    !!pending ||
    iconBlocked ||
    sourceBlocked;
  const shown =
    groups?.groups.filter((g) =>
      g.name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()),
    ) ?? [];
  function reorder(id: string, offset: number) {
    if (!groups) return;
    const order = groups.groups.map((g) => g.id),
      index = order.indexOf(id),
      next = index + offset;
    if (index < 0 || next < 0 || next >= order.length) return;
    [order[index], order[next]] = [order[next], order[index]];
    void mutate("reorder", { order });
  }
  const viewOptions = [
    { value: "__all", label: "全部记录" },
    ...(groups?.groups ?? []).map((g) => ({
      value: g.kind === "market" ? "market:" + g.market : g.id,
      label: g.name,
    })),
  ];
  if (!viewOptions.some((v) => v.value === view))
    viewOptions.push({ value: view, label: "分组待核对 · " + view });
  const targetOptions = [
    { value: "", label: "未分组" },
    ...(groups?.groups ?? [])
      .filter((g) => g.kind === "custom")
      .map((g) => ({ value: g.id, label: g.name })),
  ];
  if (!targetOptions.some((v) => v.value === target))
    targetOptions.push({ value: target, label: "分组待核对 · " + target });
  const accountOptions = [
    { value: "", label: "全部账户" },
    ...(brokers ?? []).map((b) => ({
      value: b.id,
      label: b.name || "账户待核对 · " + b.id,
    })),
  ];
  if (!accountOptions.some((v) => v.value === account))
    accountOptions.push({ value: account, label: "账户待核对 · " + account });
  return (
    <section className="watch-groups-page">
      <div className="page-head">
        <h1>自选分组</h1>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy || !active || !visible || locked}
        >
          刷新
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <WorkspaceTabs
        label="自选分组视图"
        value={workspaceSection}
        onChange={setWorkspaceSection}
        items={[
          { value: "groups", label: "分组管理" },
          { value: "members", label: "记录归属" },
          { value: "sources", label: "图标与来源" },
          { value: "receipts", label: "操作回执" },
        ]}
      />

      <WorkspaceView active={workspaceSection === "groups"} label="分组管理">
        <div className="watch-group-create">
          <label>
            新分组名称
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={disabled}
              maxLength={30}
            />
          </label>
          <button
            type="button"
            className="primary"
            onClick={() => void mutate("create", { name })}
            disabled={disabled || !name.trim()}
          >
            创建分组
          </button>
        </div>
        {groups && !groups.initialized && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void mutate("initialize", {})}
          >
            初始化市场分组
          </button>
        )}
        <label className="watch-group-search">
          筛选分组
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            disabled={locked}
          />
        </label>
        {!groups && !locked && (
          <LoadingPlaceholder label="正在读取分组" compact />
        )}
        {groups && (
          <WatchGroupRows
            groups={shown}
            all={groups.groups}
            disabled={disabled}
            edits={edits}
            onEdit={(id, edit) => setEdits((old) => ({ ...old, [id]: edit }))}
            onSave={(g, edit) => void mutate("update", { id: g.id, ...edit })}
            onDelete={setDeleting}
            onReorder={reorder}
          />
        )}
      </WorkspaceView>

      <WorkspaceView
        keepEffects
        active={workspaceSection === "sources"}
        label="图标与来源"
      >
        <WatchGroupIcons
          session={session}
          groups={groups}
          active={active && visible && !locked}
          blocked={busy || !!pending || locked || !ready || sourceBlocked}
          onBlocked={changeIconBlocked}
          onChanged={load}
          onDenied={fail}
        />
        <WatchGroupSourcePanel
          session={session}
          active={active && visible && !locked}
          blocked={busy || !!pending || locked || !ready || iconBlocked}
          revision={groups?.revision ?? null}
          onBlocked={changeSourceBlocked}
          onChanged={load}
          onDenied={fail}
        />
      </WorkspaceView>

      <WorkspaceView active={workspaceSection === "members"} label="记录归属">
        <div className="watch-group-member-heading">
          <h2>记录归属</h2>
          <button
            type="button"
            onClick={() => {
              if (members) clearFinancial();
              setMembers((v) => !v);
            }}
            disabled={locked}
          >
            {members ? "收起记录" : "查看记录"}
          </button>
        </div>
        {members && (
          <>
            <div className="watch-group-filters">
              <SelectMenu
                label="记录分组"
                value={view}
                options={viewOptions}
                onChange={(value) => changeRecordFilter(value, account)}
                disabled={busy || locked}
                variant="field"
              />
              <SelectMenu
                label="记录账户"
                value={account}
                options={accountOptions}
                onChange={(value) => changeRecordFilter(view, value)}
                disabled={busy || locked}
                variant="field"
              />
              <button
                type="button"
                disabled={busy || locked}
                onClick={clearFinancial}
              >
                重新读取
              </button>
            </div>
            {directoryError && <p role="alert">{directoryError}</p>}
            {recordError && <p role="alert">{recordError}</p>}
            {!records && !recordError && !locked && (
              <LoadingPlaceholder label="正在读取记录" compact />
            )}
            {records && (
              <>
                <WatchDisplaySettings
                  session={session}
                  records={records.records}
                  groups={groups?.groups || []}
                  complete={
                    !account && records.total === records.records.length
                  }
                  viewId={
                    view === "__all"
                      ? "ALL"
                      : groups?.groups.find(
                          (group) =>
                            group.id === view ||
                            (group.kind === "market" &&
                              "market:" + group.market === view),
                        )?.id || view
                  }
                  active={active && visible && !locked}
                  blocked={disabled}
                  onState={(value) => {
                    setWatchDisplay(value);
                    setSelected([]);
                  }}
                  onChanged={clearFinancial}
                  onDenied={fail}
                />
                <WatchGroupRecords
                  display={watchDisplay}
                  viewId={
                    view === "__all"
                      ? "ALL"
                      : groups?.groups.find(
                          (group) =>
                            group.id === view ||
                            (group.kind === "market" &&
                              "market:" + group.market === view),
                        )?.id || view
                  }
                  records={records}
                  groups={groups?.groups ?? []}
                  selected={selected}
                  disabled={disabled}
                  onSelect={(id, checked) =>
                    setSelected((old) =>
                      checked
                        ? [...old, id]
                        : old.filter((value) => value !== id),
                    )
                  }
                />
                <div className="watch-group-assign">
                  <SelectMenu
                    label="移至分组"
                    value={target}
                    options={targetOptions}
                    onChange={setTarget}
                    disabled={disabled}
                    variant="field"
                  />
                  <button
                    type="button"
                    disabled={disabled || !selected.length}
                    onClick={() =>
                      void mutate("assign", { ids: selected, groupId: target })
                    }
                  >
                    {target ? "移动所选记录" : "移出自定义分组"}
                  </button>
                  <span>已选 {selected.length} 条</span>
                </div>
                <div className="watch-group-pagination">
                  <span>
                    第 {records.page} 页 · 共 {records.total} 条
                  </span>
                  <button
                    type="button"
                    disabled={busy || page <= 1}
                    onClick={() => {
                      setRecords(null);
                      setSelected([]);
                      setPage((p) => p - 1);
                    }}
                  >
                    上一页
                  </button>
                  <button
                    type="button"
                    disabled={busy || page * records.pageSize >= records.total}
                    onClick={() => {
                      setRecords(null);
                      setSelected([]);
                      setPage((p) => p + 1);
                    }}
                  >
                    下一页
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </WorkspaceView>

      <WorkspaceView active={workspaceSection === "receipts"} label="操作回执">
        <div className="watch-group-lookup">
          <label>
            操作编号
            <input
              value={pending ?? lookup}
              onChange={(e) => setLookup(e.target.value)}
              readOnly={!!pending}
              spellCheck={false}
              disabled={locked}
            />
          </label>
          <button
            type="button"
            onClick={() => void check()}
            disabled={
              busy ||
              locked ||
              !active ||
              !visible ||
              !validGroupRequest(pending ?? lookup.trim())
            }
          >
            查询回执
          </button>
        </div>
        {pending && <p role="status">原操作待核对 · {pending}</p>}
        {receipt && (
          <div className="watch-group-receipt" role="status">
            <p>
              {receipt.group
                ? "分组已保存 · " + receipt.group.name
                : receipt.initialized
                  ? "市场分组已初始化"
                  : typeof receipt.deleted === "boolean"
                    ? receipt.deleted
                      ? "分组已删除"
                      : "分组已不存在"
                    : "已更新 " + receipt.updated + " 条"}
            </p>
            <details>
              <summary>操作详情</summary>
              <dl>
                <dt>操作编号</dt>
                <dd>{receipt.requestId}</dd>
                <dt>分组版本</dt>
                <dd>{receipt.revision}</dd>
                {receipt.collectionRevision !== undefined && (
                  <>
                    <dt>记录集合版本</dt>
                    <dd>{receipt.collectionRevision}</dd>
                  </>
                )}
              </dl>
            </details>
          </div>
        )}
      </WorkspaceView>

      {deleting && active && visible && (
        <Dialog title="删除分组" onClose={() => setDeleting(null)}>
          <p>删除“{deleting.name}”？组内记录将保留并移出该分组。</p>
          <div className="dialog-actions">
            <button type="button" onClick={() => setDeleting(null)}>
              取消
            </button>
            <button
              type="button"
              className="danger"
              disabled={disabled}
              onClick={() => void mutate("delete", { id: deleting.id })}
            >
              删除分组
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
export function WatchGroupRows({
  groups,
  all,
  disabled,
  edits,
  onEdit,
  onSave,
  onDelete,
  onReorder,
}: {
  groups: WatchGroup[];
  all: WatchGroup[];
  disabled: boolean;
  edits: Record<string, Edit>;
  onEdit: (id: string, edit: Edit) => void;
  onSave: (group: WatchGroup, edit: Edit) => void;
  onDelete: (group: WatchGroup) => void;
  onReorder: (id: string, offset: number) => void;
}) {
  return (
    <div className="watch-group-list">
      {groups.length ? (
        groups.map((g) => {
          const edit = edits[g.id] ?? {
              name: g.name,
              visible: String(g.visible),
            },
            index = all.findIndex((item) => item.id === g.id);
          return (
            <div key={g.id} className="watch-group-row">
              <label>
                分组名称
                <input
                  aria-label={g.name + "名称"}
                  value={edit.name}
                  onChange={(e) =>
                    onEdit(g.id, { ...edit, name: e.target.value })
                  }
                  maxLength={30}
                  disabled={disabled}
                />
              </label>
              <div className="watch-group-kind">
                {g.kind === "market" ? g.market + " · 市场分组" : "自定义分组"}
              </div>
              <SelectMenu
                label={g.name + "显示方式"}
                value={edit.visible}
                options={visibilityOptions}
                onChange={(value) => onEdit(g.id, { ...edit, visible: value })}
                disabled={disabled}
                variant="field"
              />
              <div className="watch-group-row-actions">
                <button
                  type="button"
                  onClick={() => onSave(g, edit)}
                  disabled={
                    disabled ||
                    (edit.name === g.name && edit.visible === String(g.visible))
                  }
                >
                  保存
                </button>
                <button
                  type="button"
                  aria-label={g.name + "上移"}
                  disabled={disabled || index <= 0}
                  onClick={() => onReorder(g.id, -1)}
                >
                  上移
                </button>
                <button
                  type="button"
                  aria-label={g.name + "下移"}
                  disabled={disabled || index >= all.length - 1}
                  onClick={() => onReorder(g.id, 1)}
                >
                  下移
                </button>
                {g.kind === "custom" && (
                  <button
                    type="button"
                    aria-label={"删除" + g.name}
                    disabled={disabled}
                    onClick={() => onDelete(g)}
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
          );
        })
      ) : (
        <p>没有符合条件的分组</p>
      )}
    </div>
  );
}
export function WatchGroupRecords({
  display = null,
  viewId = "ALL",
  records,
  groups,
  selected,
  disabled,
  onSelect,
}: {
  display?: WatchDisplayState | null;
  viewId?: string;
  records: GroupRecords;
  groups: WatchGroup[];
  selected: string[];
  disabled: boolean;
  onSelect: (id: string, checked: boolean) => void;
}) {
  const displayedRecords =
    records.displayMode === "watch"
      ? records.records
      : arrangeWatchRows(display, records.records, viewId);
  return (
    <div className="watch-group-records">
      {displayedRecords.length ? (
        displayedRecords.map((record) => (
          <label key={record.id} className="watch-group-record">
            <input
              type="checkbox"
              aria-label={"选择" + (record.name || record.code || record.id)}
              checked={selected.includes(record.id)}
              disabled={disabled}
              onChange={(e) => onSelect(record.id, e.target.checked)}
            />
            <span>
              <strong>
                {typeof watchDisplayValue(display, "aliases", record.id) ===
                  "string" &&
                String(watchDisplayValue(display, "aliases", record.id)).trim()
                  ? String(watchDisplayValue(display, "aliases", record.id))
                  : record.name || record.code || "记录待核对"}
                {watchDisplayValue(display, "pinned", record.id) === true
                  ? " · 置顶"
                  : ""}
              </strong>
              {typeof watchDisplayValue(display, "notes", record.id) ===
                "string" && (
                <small>
                  显示备注 ·{" "}
                  {String(watchDisplayValue(display, "notes", record.id))}
                </small>
              )}
              <small>
                {record.market} · {record.code || "代码未提供"}
              </small>
            </span>
            <span>
              {typeof watchDisplayValue(display, "moved", record.id) ===
              "string"
                ? groupLabel(
                    String(watchDisplayValue(display, "moved", record.id)),
                    groups,
                  )
                : groupLabel(record.watchGroupId, groups)}
              {groups
                .filter(
                  (group) =>
                    display?.fields[
                      JSON.stringify(["groups", group.id, record.id])
                    ]?.value === true,
                )
                .map((group) => (
                  <small key={group.id}>附加显示 · {group.name}</small>
                ))}
            </span>
          </label>
        ))
      ) : (
        <p>此范围暂无记录</p>
      )}
    </div>
  );
}
