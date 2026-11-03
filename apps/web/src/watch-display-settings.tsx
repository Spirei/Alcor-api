import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { requestId } from "./request-id";
import {
  WatchDisplayReadScope,
  watchField as field,
  watchDisplayValue,
  type WatchDisplayState,
  type WatchDisplayRow as Row,
} from "./watch-display-state";
export {
  watchDisplayValue,
  arrangeWatchRows,
  type WatchDisplayState,
} from "./watch-display-state";
type Group = { id: string; name: string; kind: string };
type Receipt = {
  requestId: string;
  userId: string;
  namespace: "watch";
  state: "completed" | "conflict";
  message: string;
  data: WatchDisplayState & { partial?: boolean };
};
export function WatchDisplaySettings(props: {
  session: Session;
  records: Row[];
  groups?: Group[];
  viewId?: string;
  complete?: boolean;
  active?: boolean;
  blocked?: boolean;
  onState?: (value: WatchDisplayState | null) => void;
  onChanged?: () => void;
  onDenied: (error: unknown) => void;
}) {
  const s = props.session;
  return (
    <Panel
      key={JSON.stringify([
        s.instance_id,
        s.user.id,
        s.user.role,
        s.receipt_scope,
        s.csrf,
        s.expires_at,
      ])}
      {...props}
    />
  );
}
function Panel({
  session,
  records,
  groups = [],
  viewId = "ALL",
  complete = false,
  active = true,
  blocked = false,
  onState,
  onChanged,
  onDenied,
}: {
  session: Session;
  records: Row[];
  groups?: Group[];
  viewId?: string;
  complete?: boolean;
  active?: boolean;
  blocked?: boolean;
  onState?: (value: WatchDisplayState | null) => void;
  onChanged?: () => void;
  onDenied: (error: unknown) => void;
}) {
  const storage =
    "watch-display:" +
    JSON.stringify([
      session.instance_id,
      session.user.id,
      session.user.role,
      session.receipt_scope,
    ]);
  const [snapshot, setSnapshot] = useState<WatchDisplayState | null>(null),
    [drafts, setDrafts] = useState<
      Record<string, { alias: string; note: string; move: string }>
    >({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [pending, setPending] = useState<string | null>(() => {
    try {
      const value = sessionStorage.getItem(storage);
      return value &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          value,
        )
        ? value
        : null;
    } catch {
      return null;
    }
  });
  const scope = useRef(new WatchDisplayReadScope()),
    busyRef = useRef(false),
    alive = useRef(true),
    current = useRef<WatchDisplayState | null>(null),
    callbacks = useRef({ onState, onChanged, onDenied });
  callbacks.current = { onState, onChanged, onDenied };
  function working(value: boolean) {
    busyRef.current = value;
    setBusy(value);
  }
  function install(value: WatchDisplayState | null) {
    current.current = value;
    setSnapshot(value);
    callbacks.current.onState?.(value);
    setDrafts({});
  }
  function fail(e: unknown) {
    if (e instanceof ApiError && [401, 403].includes(e.status)) {
      scope.current.invalidate();
      working(false);
      install(null);
      setPending(null);
      setNotice("");
      try {
        sessionStorage.removeItem(storage);
      } catch {
        /* Retire owner view. */
      }
      callbacks.current.onDenied(e);
    }
    setError(e instanceof Error ? e.message : "自选偏好操作失败");
  }
  async function load(manual = false) {
    if (busyRef.current || !active || document.hidden) return;
    const ticket = scope.current.begin(),
      run = ticket.generation;
    working(true);
    setError("");
    try {
      const value = await api<WatchDisplayState>(
        "/account/state?namespace=watch",
        { signal: ticket.signal },
      );
      if (alive.current && scope.current.current(run)) {
        if (value.userId !== session.user.id || value.namespace !== "watch")
          throw new Error("自选偏好归属待核对");
        install(value);
        if (manual) callbacks.current.onChanged?.();
      }
    } catch (e) {
      if (!ticket.signal.aborted && scope.current.current(run)) fail(e);
    } finally {
      if (scope.current.current(run)) working(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    const presence = () => {
      const resumed = scope.current.presence(active, !document.hidden);
      if (!active || document.hidden) {
        install(null);
        working(false);
        setNotice("");
      } else if (resumed) void load();
    };
    presence();
    document.addEventListener("visibilitychange", presence);
    return () => {
      alive.current = false;
      busyRef.current = false;
      scope.current.presence(false, false);
      callbacks.current.onState?.(null);
      document.removeEventListener("visibilitychange", presence);
    };
  }, [active]);
  function remember(id: string | null) {
    try {
      if (id) sessionStorage.setItem(storage, id);
      else sessionStorage.removeItem(storage);
      setPending(id);
      return true;
    } catch {
      setError("无法保留原请求编号，未保存偏好");
      return false;
    }
  }
  function accept(result: Receipt, id: string) {
    if (
      result.requestId !== id ||
      result.userId !== session.user.id ||
      result.namespace !== "watch" ||
      !["completed", "conflict"].includes(result.state)
    )
      throw new Error("原偏好请求仍待核对");
    const previous = current.current;
    const next = result.data.partial
      ? previous
        ? { ...previous, fields: { ...previous.fields, ...result.data.fields } }
        : null
      : result.data;
    install(next);
    remember(null);
    setNotice(
      result.state === "conflict"
        ? result.message
        : next
          ? "已保存自选显示偏好"
          : "原请求已完成，请重新读取完整自选偏好",
    );
    callbacks.current.onChanged?.();
  }
  async function mutate(values: { key: string; value: unknown }[]) {
    if (!snapshot || busy || pending || blocked || !active || document.hidden)
      return;
    try {
      const other = sessionStorage.getItem(storage);
      if (other) {
        setPending(other);
        setError("请先核对原自选请求");
        return;
      }
    } catch {
      setError("无法读取原请求状态，未保存");
      return;
    }
    const id = requestId();
    if (!remember(id)) return;
    const run = scope.current.generation,
      changes = values.map((value) => ({
        ...value,
        revision: snapshot.fields[value.key]?.revision ?? 0,
      }));
    working(true);
    setError("");
    setNotice("");
    try {
      const result = await api<Receipt>(
        "/account/state",
        {
          method: "POST",
          body: JSON.stringify({ requestId: id, namespace: "watch", changes }),
        },
        session.csrf,
      );
      if (alive.current && run === scope.current.generation) accept(result, id);
    } catch (e) {
      if (run === scope.current.generation) fail(e);
    } finally {
      if (run === scope.current.generation) working(false);
    }
  }
  async function query() {
    if (!pending || busy || !active || document.hidden) return;
    const id = pending,
      run = scope.current.generation;
    working(true);
    setError("");
    try {
      const result = await api<Receipt>("/account/state/operations/" + id);
      if (alive.current && run === scope.current.generation) accept(result, id);
    } catch (e) {
      if (run === scope.current.generation) fail(e);
    } finally {
      if (run === scope.current.generation) working(false);
    }
  }
  const selection = viewId;
  const orderValue = watchDisplayValue(snapshot, "orders", selection),
    order =
      Array.isArray(orderValue) &&
      orderValue.every((value) => typeof value === "string")
        ? (orderValue as string[])
        : [],
    rank = new Map(order.map((id, index) => [id, index]));
  const sorted = records
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        Number(watchDisplayValue(snapshot, "pinned", b.row.id) === true) -
          Number(watchDisplayValue(snapshot, "pinned", a.row.id) === true) ||
        (rank.get(a.row.id) ?? order.length + a.index) -
          (rank.get(b.row.id) ?? order.length + b.index),
    )
    .map((value) => value.row);
  function move(id: string, offset: number) {
    const index = sorted.findIndex((row) => row.id === id),
      neighbor = sorted[index + offset];
    if (
      !complete ||
      !neighbor ||
      (watchDisplayValue(snapshot, "pinned", neighbor.id) === true) !==
        (watchDisplayValue(snapshot, "pinned", id) === true)
    )
      return;
    const next = [
        ...order,
        ...records
          .filter((row) => !order.includes(row.id))
          .map((row) => row.id),
      ],
      left = next.indexOf(id),
      right = next.indexOf(neighbor.id);
    [next[left], next[right]] = [next[right], next[left]];
    void mutate([{ key: field("orders", selection), value: next }]);
  }
  const disabled = busy || !!pending || blocked || !active || !snapshot;
  return (
    <details>
      <summary>关注、置顶与显示备注</summary>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <button
        className="button"
        disabled={busy || !active}
        onClick={() => void load(true)}
      >
        读取自选偏好
      </button>
      <p>
        排序视图{" "}
        {groups.find((group) => group.id === selection)?.name || selection}
      </p>
      {!complete && <p>当前视图尚未完整读取，排序不可用</p>}
      {snapshot && (
        <>
          <p>当前列表页 {records.length} 条 · 显示偏好不改持仓和金融备注</p>
          {sorted.map((row, index) => {
            const hidden =
                watchDisplayValue(snapshot, "hidden", row.id) === true,
              pinned = watchDisplayValue(snapshot, "pinned", row.id) === true,
              alias = watchDisplayValue(snapshot, "aliases", row.id),
              note = watchDisplayValue(snapshot, "notes", row.id),
              moved = watchDisplayValue(snapshot, "moved", row.id),
              draft = drafts[row.id] || {
                alias: typeof alias === "string" ? alias : "",
                note: typeof note === "string" ? note : "",
                move: typeof moved === "string" ? moved : "",
              };
            const edit = (patch: Partial<typeof draft>) =>
              setDrafts((previous) => ({
                ...previous,
                [row.id]: { ...draft, ...patch },
              }));
            return (
              <div key={row.id} className="watch-group-row">
                <strong>
                  {draft.alias.trim() || row.name} · {row.market}:{row.code}
                </strong>
                <small>{row.id}</small>
                <div className="watch-group-row-actions">
                  <button
                    disabled={disabled}
                    aria-pressed={!hidden}
                    onClick={() =>
                      void mutate([
                        {
                          key: field("hidden", row.id),
                          value: hidden ? null : true,
                        },
                      ])
                    }
                  >
                    {hidden ? "重新关注" : "取消关注"}
                  </button>
                  <button
                    disabled={disabled}
                    aria-pressed={pinned}
                    onClick={() =>
                      void mutate([
                        {
                          key: field("pinned", row.id),
                          value: pinned ? null : true,
                        },
                      ])
                    }
                  >
                    {pinned ? "取消置顶" : "置顶"}
                  </button>
                  <button
                    disabled={disabled || !complete || index === 0}
                    onClick={() => move(row.id, -1)}
                  >
                    上移
                  </button>
                  <button
                    disabled={
                      disabled || !complete || index === sorted.length - 1
                    }
                    onClick={() => move(row.id, 1)}
                  >
                    下移
                  </button>
                </div>
                <label>
                  显示别名
                  <input
                    value={draft.alias}
                    maxLength={250}
                    disabled={disabled}
                    onChange={(e) => edit({ alias: e.target.value })}
                  />
                </label>
                <label>
                  显示备注
                  <textarea
                    value={draft.note}
                    maxLength={10000}
                    disabled={disabled}
                    onChange={(e) => edit({ note: e.target.value })}
                  />
                </label>
                <button
                  disabled={disabled}
                  onClick={() =>
                    void mutate([
                      {
                        key: field("aliases", row.id),
                        value: draft.alias || null,
                      },
                      {
                        key: field("notes", row.id),
                        value: draft.note || null,
                      },
                    ])
                  }
                >
                  保存别名与显示备注
                </button>
                <label>
                  显示移动分组
                  <select
                    value={draft.move}
                    disabled={disabled}
                    onChange={(e) => edit({ move: e.target.value })}
                  >
                    <option value="">沿原记录归属</option>
                    {groups
                      .filter((group) => group.kind === "custom")
                      .map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    {draft.move &&
                      !groups.some((group) => group.id === draft.move) && (
                        <option value={draft.move}>
                          分组待核对 · {draft.move}
                        </option>
                      )}
                  </select>
                </label>
                <button
                  disabled={disabled}
                  onClick={() =>
                    void mutate([
                      {
                        key: field("moved", row.id),
                        value: draft.move || null,
                      },
                    ])
                  }
                >
                  保存显示归属
                </button>
                {groups
                  .filter((group) => group.kind === "custom")
                  .map((group) => {
                    const key = JSON.stringify(["groups", group.id, row.id]),
                      member = snapshot.fields[key]?.value === true;
                    return (
                      <label key={group.id}>
                        <input
                          type="checkbox"
                          checked={member}
                          disabled={disabled}
                          onChange={(e) =>
                            void mutate([
                              { key, value: e.target.checked ? true : null },
                            ])
                          }
                        />
                        附加显示于 {group.name}
                      </label>
                    );
                  })}
              </div>
            );
          })}
        </>
      )}
      {pending && (
        <div>
          <p role="status">自选偏好结果待核对</p>
          <code>{pending}</code>
          <button disabled={busy || !active} onClick={() => void query()}>
            查询原请求
          </button>
        </div>
      )}
    </details>
  );
}
