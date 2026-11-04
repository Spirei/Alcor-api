import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { api, type Session } from "./api";
import { groupListing, type GroupListing } from "./watch-groups-state";
import { WatchGroupIcons } from "./watch-group-icons";
import { MaterialName, useAssetNameEditor } from "./asset-name-editor";
export function StockGroupMaterials({
  session,
  active,
  blocked,
}: {
  session: Session;
  active: boolean;
  blocked: boolean;
}) {
  const [groups, setGroups] = useState<GroupListing | null>(null),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [iconBlocked, setIconBlocked] = useState(false),
    [nameBlocked, setNameBlocked] = useState(false),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1);
  const changed = useCallback(() => setRefresh((v) => v + 1), []),
    denied = useCallback(
      (reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "分组读取失败"),
      [],
    );
  useEffect(() => {
    if (!active) {
      setGroups(null);
      return;
    }
    const abort = new AbortController();
    void api<unknown>("/watch-groups", { signal: abort.signal })
      .then((v) => {
        if (!abort.signal.aborted) {
          setGroups(groupListing(v));
          setError("");
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) denied(e);
      });
    return () => abort.abort();
  }, [active, refresh, session.csrf, denied]);
  const editor = useAssetNameEditor({
    session,
    active,
    onChanged: changed,
    onBlocked: setNameBlocked,
    domain: "watch-group",
  });
  const all =
      groups?.groups.filter(
        (g) =>
          g.kind === "custom" &&
          g.name.toLowerCase().includes(search.trim().toLowerCase()),
      ) || [],
    count = Math.max(1, Math.ceil(all.length / 10)),
    current = Math.min(page, count);
  return (
    <div className="stock-group-materials">
      <div className="asset-library-toolbar">
        <label className="asset-library-search">
          <Search size={18} />
          <input
            aria-label="搜索股票分组"
            placeholder="搜索股票分组"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            disabled={iconBlocked || nameBlocked}
          />
        </label>
      </div>
      <div className="asset-library-meta">股票分组 · {all.length} 个</div>
      {error && <p role="alert">{error}</p>}
      <WatchGroupIcons
        session={session}
        groups={groups}
        active={active}
        blocked={blocked || nameBlocked}
        onBlocked={setIconBlocked}
        onChanged={changed}
        onDenied={denied}
        library={{
          visibleIds: all
            .slice((current - 1) * 10, current * 10)
            .map((g) => g.id),
          renderName: (g) => (
            <MaterialName
              asset={{ id: g.id, name: g.name, type: "group" }}
              revision={groups?.revision || 0}
              editor={editor}
              disabled={blocked || iconBlocked || nameBlocked}
            />
          ),
        }}
      />
      {!all.length && groups && (
        <div className="asset-library-empty">
          <h3>暂无股票分组</h3>
          <p>在自选分组中创建后，可在这里设置图标。</p>
        </div>
      )}
      {count > 1 && (
        <nav className="asset-library-pagination" aria-label="股票分组分页">
          <button
            disabled={current <= 1 || iconBlocked || nameBlocked}
            onClick={() => setPage(current - 1)}
          >
            上一页
          </button>
          <span>
            {current} / {count}
          </span>
          <button
            disabled={current >= count || iconBlocked || nameBlocked}
            onClick={() => setPage(current + 1)}
          >
            下一页
          </button>
        </nav>
      )}
    </div>
  );
}
