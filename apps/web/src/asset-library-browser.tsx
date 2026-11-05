import { useSortMotion } from "./sort-motion";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Grid2X2,
  List,
  Search,
  RefreshCw,
  ImageOff,
  Camera,
  X,
  Plus,
  Trash2,
  Undo2,
} from "lucide-react";
import { Dialog } from "./dialog";
import { api, type Session } from "./api";
import { AssetMarketFilter } from "./asset-market-filter";
import { BrokerGrip, useBrokerOrder } from "./asset-broker-order";
import { StockGroupMaterials } from "./stock-group-materials";
import { MaterialCreate } from "./asset-library-create";
import { useMaterialCommand } from "./asset-library-command";
import { localizedMaterials } from "./asset-library-labels";
import { MaterialName, useAssetNameEditor } from "./asset-name-editor";
import {
  marketSlots,
  libraryMarkets,
  type LibraryAsset,
} from "./asset-library-market";
import { assetPageKey, assetPageNumbers } from "./asset-library-state";
import "./asset-library-browser.css";

const categories = [
  ["market", "市场图标"],
  ["stock", "股票图标"],
  ["crypto", "加密货币"],
  ["metal", "贵金属"],
  ["flag", "国家/地区旗帜"],
  ["broker", "券商图标"],
  ["group", "股票分组"],
  ["card", "卡片"],
] as const;
const defaultPageSize = 10;
const markets = libraryMarkets;
export type AssetIconTarget = LibraryAsset;
type Asset = LibraryAsset;
type Listing = {
  assets: Asset[];
  total: number;
  page: number;
  pageSize: number;
  revision?: number;
  excludedMarkets?: string[];
};
export { assetImageUrl } from "./local-media";
import { assetImageUrl } from "./local-media";
function Thumbnail({ url, name }: { url?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const src = assetImageUrl(url);
  return src && !failed ? (
    <img
      src={src}
      alt={name}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="asset-library-missing">
      <ImageOff size={22} />
      <small>待添加图片</small>
    </span>
  );
}
export function AssetLibraryBrowser({
  session,
  active = true,
  revision = 0,
  onReplace,
  onRestore,
  onChanged,
  uploadDisabled = false,
  readOnly = false,
}: {
  session: Session;
  active?: boolean;
  revision?: number;
  onReplace?: (asset: AssetIconTarget, revision: number, file: File) => void;
  onRestore?: (asset: AssetIconTarget, revision: number) => void;
  onChanged?: () => void;
  uploadDisabled?: boolean;
  readOnly?: boolean;
}) {
  // Parent is keyed by the full session. This cache is bounded and never shared across accounts.
  const cache = useRef(new Map<string, Listing>());
  const generation = useRef(0);
  const categoryBar = useRef<HTMLElement>(null);
  const itemRoot = useRef<HTMLDivElement>(null);
  const [type, setType] = useState("market"),
    [market, setMarket] = useState("");
  useLayoutEffect(() => {
    const bar = categoryBar.current;
    if (!bar) return;
    function reveal() {
      const selected = bar!.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!selected) return;
      const row = bar!.getBoundingClientRect(),
        item = selected.getBoundingClientRect();
      if (item.left < row.left + 8) bar!.scrollLeft -= row.left + 8 - item.left;
      else if (item.right > row.right - 8)
        bar!.scrollLeft += item.right - row.right + 8;
    }
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [type]);
  const [selection, setSelection] = useState<string[]>([]);
  const [selecting, setSelecting] = useState(false),
    [confirmBulk, setConfirmBulk] = useState(false),
    [bulkBusy, setBulkBusy] = useState(false),
    [bulkTotal, setBulkTotal] = useState(0),
    [bulkStopping, setBulkStopping] = useState(false),
    [bulkMessage, setBulkMessage] = useState("");
  const [creating, setCreating] = useState(false),
    [deleted, setDeleted] = useState(false);
  const localAll = type === "broker";
  const pageSize = type === "card" ? 18 : defaultPageSize;
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  useEffect(() => {
    setSelection([]);
    setSelecting(false);
  }, [type, market, query, page, deleted]);
  const bulkEpoch = useRef(0);
  useEffect(() => {
    ++bulkEpoch.current;
    return () => {
      ++bulkEpoch.current;
    };
  }, [active, session.csrf, type, market, query, page]);
  const [view, setView] = useState<"grid" | "list">("list");
  const [dark, setDark] = useState(
    typeof document !== "undefined" &&
      document.documentElement.dataset.theme === "dark",
  );
  useEffect(() => {
    const update = () =>
      setDark(document.documentElement.dataset.theme === "dark");
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    update();
    return () => observer.disconnect();
  }, []);
  const fileInput = useRef<HTMLInputElement>(null),
    replaceTarget = useRef<{ asset: Asset; revision: number } | null>(null);
  const [availableMarkets, setAvailableMarkets] = useState<string[] | null>(
    null,
  );
  const [marketFlags, setMarketFlags] = useState<Record<string, string>>({});
  const [labelBlocked, setLabelBlocked] = useState(false);
  const [listing, setListing] = useState<{
      key: string;
      value: Listing;
    } | null>(null),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [retired, setRetired] = useState(false);
  const [visible, setVisible] = useState(
    typeof document === "undefined" || !document.hidden,
  );
  const [pageDraft, setPageDraft] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const serverSize = type === "market" || localAll ? 100 : pageSize;
  const key =
    assetPageKey(
      type,
      localAll ? "" : market,
      type === "market" || localAll ? "" : query,
      type === "market" || localAll ? 1 : page,
      serverSize,
    ) + (deleted ? "&deleted=1" : "");
  const queryPending = search.trim() !== query;
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, query]);
  useEffect(() => {
    cache.current.clear();
  }, [revision]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) ++generation.current;
      setVisible(!document.hidden);
    };
    const retire = () => {
      ++generation.current;
      cache.current.clear();
      setRetired(true);
      setListing(null);
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("alcor:session-changed", retire);
    window.addEventListener("alcor:session-expired", retire);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("alcor:session-changed", retire);
      window.removeEventListener("alcor:session-expired", retire);
    };
  }, []);
  useEffect(() => {
    if (!active || !visible || retired || type === "group") {
      setListing(null);
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    const reading = ++generation.current;
    setBusy(true);
    setError("");
    async function read() {
      const base = deleted ? "/admin/asset-catalog/entries?" : "/assets?";
      const first = await api<Listing>(base + key, {
        signal: controller.signal,
      });
      if (localAll && first.total > 5000)
        throw Error("素材超过读取预算，请缩小分类");
      if (localAll && first.total > serverSize) {
        const assets = [...first.assets];
        for (let offset = 2; assets.length < first.total; offset++) {
          const params = new URLSearchParams(key);
          params.set("page", String(offset));
          const next = await api<Listing>(base + params, {
            signal: controller.signal,
          });
          if (
            next.revision !== first.revision ||
            next.total !== first.total ||
            next.page !== offset ||
            next.assets.length === 0
          )
            throw Error("素材目录已变化，请重新读取");
          assets.push(...next.assets);
        }
        return { ...first, assets };
      }
      return first;
    }
    void read()
      .then((value) => {
        if (controller.signal.aborted || reading !== generation.current) return;
        if (
          !value ||
          !Array.isArray(value.assets) ||
          value.assets.length > (localAll ? 5000 : serverSize) ||
          !Number.isSafeInteger(value.total) ||
          value.total < value.assets.length ||
          !Number.isSafeInteger(value.page) ||
          value.page < 1 ||
          value.pageSize !== serverSize ||
          !value.assets.every(
            (a) =>
              a &&
              typeof a.id === "string" &&
              typeof a.name === "string" &&
              [a.code, a.market, a.imageUrl, a.imageUrlDark].every(
                (v) => v == null || typeof v === "string",
              ),
          ) ||
          new Set(value.assets.map((a) => a.id)).size !== value.assets.length
        )
          throw Error("素材列表响应无效，请重试");
        cache.current.delete(key);
        cache.current.set(key, value);
        if (cache.current.size > 8)
          cache.current.delete(cache.current.keys().next().value!);
        setListing({ key, value });
        if (type !== "market" && !localAll && value.page !== page)
          setPage(value.page);
      })
      .catch((reason) => {
        if (!controller.signal.aborted && reading === generation.current) {
          setError(reason instanceof Error ? reason.message : "素材读取失败");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && reading === generation.current)
          setBusy(false);
      });
    return () => controller.abort();
  }, [active, visible, retired, key, refresh, revision, session.csrf]);
  const loaded =
    active && visible && !retired
      ? listing?.key === key
        ? listing.value
        : (cache.current.get(key) ?? null)
      : null;
  const brokerOrder = useBrokerOrder(
    type === "broker" ? loaded?.assets || [] : [],
  );
  const marketRows =
    loaded && localAll
      ? localizedMaterials(
          type === "broker" ? brokerOrder.rows : loaded.assets,
          type,
          query,
          market,
        )
      : loaded && type === "market"
        ? (deleted
            ? loaded.assets
            : marketSlots(loaded.assets, marketFlags)
          ).filter(
            (row) =>
              (deleted ||
                !loaded.excludedMarkets?.includes(
                  row.market || row.code || "",
                )) &&
              (!query ||
                `${row.name} ${row.code}`
                  .toLowerCase()
                  .includes(query.toLowerCase())),
          )
        : null;
  const shown =
    loaded && marketRows
      ? {
          ...loaded,
          assets: marketRows.slice((page - 1) * pageSize, page * pageSize),
          page,
          pageSize,
          total: marketRows.length,
        }
      : loaded;
  useEffect(() => {
    if (
      !["market", "stock", "broker"].includes(type) ||
      !active ||
      !visible ||
      retired
    )
      return;
    const controller = new AbortController();
    void api<{ assets: { code: string; url: string }[] }>(
      "/assets?type=flag&keys=" +
        Object.keys(libraryMarkets)
          .map((c) => (c === "UK" ? "GB" : c))
          .join(","),
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted)
          setMarketFlags(
            Object.fromEntries(
              value.assets
                .filter(
                  (v) => typeof v.code === "string" && assetImageUrl(v.url),
                )
                .map((v) => [v.code, v.url]),
            ),
          );
      })
      .catch(() => {});
    return () => controller.abort();
  }, [type, active, visible, retired, revision, refresh, session.csrf]);
  useEffect(() => {
    if (type !== "stock" || !active || !visible || retired) return;
    const controller = new AbortController();
    setAvailableMarkets(null);
    void api<{ markets: string[] }>("/assets?type=stock&marketAvailability=1", {
      signal: controller.signal,
    })
      .then((value) => {
        if (
          !controller.signal.aborted &&
          Array.isArray(value.markets) &&
          value.markets.length <= 100 &&
          value.markets.every((v) => typeof v === "string")
        )
          setAvailableMarkets(value.markets);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [type, active, visible, retired, revision, refresh, session.csrf]);
  const loading = busy || queryPending;
  const pages = shown ? Math.max(1, Math.ceil(shown.total / pageSize)) : page;
  const targetPage = Number(pageDraft);
  const validTarget =
    Number.isSafeInteger(targetPage) && targetPage >= 1 && targetPage <= pages;
  function clearSearch() {
    setSearch("");
    setQuery("");
    setPage(1);
    setPageDraft("");
    searchInput.current?.focus();
  }
  const changed = () => {
    cache.current.clear();
    if (onChanged) onChanged();
    else setRefresh((v) => v + 1);
  };
  const command = useMaterialCommand(
    session,
    active && visible && !retired && !readOnly,
    changed,
  );
  useEffect(() => {
    if (command.last?.action === "create") {
      setCreating(false);
      setSearch(
        command.last.asset.type === "broker"
          ? ""
          : command.last.asset.code || "",
      );
      setPage(1);
    }
  }, [command.last?.requestId]);
  const nameEditor = useAssetNameEditor({
    session,
    active: active && visible && !retired && !readOnly,
    onBlocked: setLabelBlocked,
    onChanged: () => {
      cache.current.clear();
      if (onChanged) onChanged();
      else setRefresh((v) => v + 1);
    },
  });
  useSortMotion(
    itemRoot,
    "[data-broker-id]",
    (shown?.assets || []).map((asset) => asset.id).join(","),
    `${type}:${view}`,
  );
  return (
    <section
      className={`asset-library${readOnly ? " is-readonly" : ""}${type === "stock" ? " is-stock" : type === "broker" ? " is-broker" : ""}`}
      aria-label="素材浏览"
    >
      <input
        type="file"
        ref={fileInput}
        hidden
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        aria-label="更换对应图标"
        onChange={(event) => {
          const file = event.target.files?.[0];
          const target = replaceTarget.current;
          event.target.value = "";
          replaceTarget.current = null;
          if (
            file &&
            target &&
            active &&
            visible &&
            !retired &&
            !uploadDisabled
          )
            onReplace?.(target.asset, target.revision, file);
        }}
      />
      {bulkMessage && <p role="status">{bulkMessage}</p>}
      {confirmBulk && (
        <Dialog
          title={`移除选中的 ${bulkBusy ? bulkTotal : selection.length} 项素材？`}
          onClose={() => {
            if (!bulkBusy) setConfirmBulk(false);
          }}
        >
          <p>从素材库移除，保留原文件；已删除素材可单独恢复。</p>
          <button
            className="button"
            disabled={bulkBusy}
            onClick={async () => {
              if (!loaded || bulkBusy || command.blocked) return;
              setBulkStopping(false);
              setBulkTotal(selection.length);
              setBulkBusy(true);
              const generation = bulkEpoch.current;
              let currentRevision = loaded.revision!,
                completed = 0;
              const targets =
                shown?.assets.filter((asset) => selection.includes(asset.id)) ||
                [];
              try {
                for (const asset of targets) {
                  if (document.hidden || generation !== bulkEpoch.current)
                    break;
                  const result = await command.execute({
                    action: "delete",
                    asset,
                    revision: currentRevision,
                  });
                  if (!result || typeof result.revision !== "number") break;
                  currentRevision = result.revision;
                  completed++;
                  setSelection((previous) =>
                    previous.filter((id) => id !== asset.id),
                  );
                }
              } finally {
                setBulkBusy(false);
                setConfirmBulk(false);
                if (completed === targets.length) setSelecting(false);
                setBulkMessage(
                  `已移除 ${completed} / ${targets.length} 项${completed < targets.length ? "，已停止，请核对未完成操作" : ""}`,
                );
              }
            }}
          >
            {bulkBusy ? "正在移除…" : "确认移除"}
          </button>
          {bulkBusy && (
            <button
              className="button secondary"
              disabled={bulkStopping}
              onClick={() => {
                ++bulkEpoch.current;
                setBulkStopping(true);
              }}
            >
              {bulkStopping ? "正在停止…" : "停止后续移除"}
            </button>
          )}
        </Dialog>
      )}
      <nav
        ref={categoryBar}
        className="asset-library-tabs"
        aria-label="素材分类"
      >
        {categories.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={type === key}
            onClick={() => {
              if (key === type) return;
              setType(key);
              setCreating(false);
              setDeleted(false);
              setMarket("");
              setSearch("");
              setQuery("");
              setPage(1);
              setPageDraft("");
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      {type === "group" ? (
        <StockGroupMaterials
          session={session}
          active={active && visible && !retired}
          blocked={uploadDisabled || labelBlocked || command.blocked}
        />
      ) : (
        <>
          <div className="asset-library-toolbar">
            {type === "stock" && (
              <AssetMarketFilter
                value={market}
                icons={marketFlags}
                available={availableMarkets}
                onChange={(m) => {
                  setMarket(m);
                  setPage(1);
                }}
              />
            )}
            {type === "broker" && (
              <div
                className="asset-broker-filters"
                role="group"
                aria-label="券商所属市场"
              >
                {[
                  ["", "全部"],
                  ["US", "美股"],
                  ["HK", "港股"],
                  ["CN", "A股"],
                  ["OTHER", "未分类"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className="asset-market-chip"
                    aria-pressed={market === key}
                    onClick={() => {
                      setMarket(key);
                      setPage(1);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <label className="asset-library-search">
              <Search size={18} />
              <input
                ref={searchInput}
                aria-label="搜索素材"
                placeholder={
                  type === "card" ? "搜索卡名 / 银行 / 地区" : "搜索名称或代码"
                }
                value={search}
                maxLength={120}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  className="asset-library-clear"
                  aria-label="清空素材搜索"
                  onClick={clearSearch}
                >
                  <X size={15} />
                </button>
              )}
            </label>
            <div
              className="asset-library-tools"
              role="group"
              aria-label="素材显示方式"
            >
              {!readOnly && !deleted && (
                <>
                  <button
                    className="button secondary"
                    type="button"
                    disabled={bulkBusy || command.blocked}
                    onClick={() => {
                      setSelecting(!selecting);
                      setSelection([]);
                    }}
                  >
                    {selecting ? "取消选择" : "批量选择"}
                  </button>
                  {selecting && (
                    <>
                      <button
                        type="button"
                        className="text-button"
                        disabled={bulkBusy}
                        onClick={() =>
                          setSelection(
                            shown?.assets.map((asset) => asset.id) || [],
                          )
                        }
                      >
                        选择本页
                      </button>
                      <button
                        className="button secondary"
                        type="button"
                        disabled={
                          bulkBusy || command.blocked || !selection.length
                        }
                        onClick={() => setConfirmBulk(true)}
                      >
                        移除 {selection.length} 项
                      </button>
                    </>
                  )}
                </>
              )}
              {type === "broker" && !deleted && (
                <button
                  type="button"
                  className="button secondary asset-create-trigger"
                  disabled={
                    uploadDisabled || labelBlocked || command.blocked || loading
                  }
                  onClick={() => setCreating((v) => !v)}
                >
                  <Plus size={16} />
                  新增券商
                </button>
              )}
              <button
                type="button"
                className="icon-button"
                aria-label={deleted ? "返回素材库" : "查看已移除素材"}
                title={deleted ? "返回素材库" : "已移除素材"}
                aria-pressed={deleted}
                onClick={() => {
                  setDeleted((v) => !v);
                  setPage(1);
                  setCreating(false);
                }}
              >
                <Undo2 size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="网格显示"
                aria-pressed={view === "grid"}
                onClick={() => setView("grid")}
              >
                <Grid2X2 size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="列表显示"
                aria-pressed={view === "list"}
                onClick={() => setView("list")}
              >
                <List size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="刷新素材"
                disabled={loading || retired}
                onClick={() => {
                  cache.current.clear();
                  setRefresh((v) => v + 1);
                }}
              >
                <RefreshCw size={18} />
              </button>
            </div>
          </div>
          {type === "broker" && (
            <span className="asset-market-announcement" role="status">
              {brokerOrder.message || "按住手柄拖动排序"}
            </span>
          )}
          {creating && (type === "stock" || type === "broker") && (
            <Dialog
              title={type === "broker" ? "新增券商" : "添加股票素材"}
              onClose={() => setCreating(false)}
            >
              <MaterialCreate
                kind={type}
                market={market}
                query={query}
                disabled={
                  uploadDisabled || labelBlocked || command.blocked || loading
                }
                onCancel={() => setCreating(false)}
                onSave={(asset) => {
                  if (loaded?.revision !== undefined)
                    void command.execute({
                      action: "create",
                      revision: loaded.revision,
                      asset,
                    });
                }}
              />
            </Dialog>
          )}
          {(command.error || command.pending) && (
            <div className="notice" role="status">
              <span>{command.error || "正在处理素材…"}</span>
              {command.pending && (
                <button
                  type="button"
                  disabled={command.busy || command.locked}
                  onClick={() => void command.check()}
                >
                  核对原操作
                </button>
              )}
            </div>
          )}
          {command.last?.action === "delete" && !command.pending && (
            <div className="asset-removed-feedback" role="status">
              <span>已移出素材库，原文件已保留</span>
              <button
                type="button"
                disabled={
                  command.blocked || loaded?.revision === undefined || loading
                }
                onClick={() =>
                  loaded?.revision !== undefined &&
                  void command.execute({
                    action: "restore",
                    revision: loaded.revision,
                    asset: command.last!.asset,
                  })
                }
              >
                撤销
              </button>
            </div>
          )}
          <div className="asset-library-meta" aria-live="polite">
            {retired ? (
              "登录状态已变化，请重新打开素材库"
            ) : error ? (
              <span role="alert">{error}</span>
            ) : shown ? (
              `${type === "card" ? "卡片素材 · " : type === "flag" ? "国家/地区旗帜 · " : type === "broker" ? "券商图标 · " : ""}${shown.total} ${type === "market" ? "个市场" : type === "card" ? "张" : type === "flag" || type === "broker" ? "个" : "项素材"}`
            ) : loading ? (
              "正在读取素材…"
            ) : (
              ""
            )}
          </div>
          {view === "list" &&
            type !== "card" &&
            shown &&
            shown.assets.length > 0 && (
              <div className="asset-library-list-head" aria-hidden="true">
                <span>序号</span>
                <span>
                  {type === "market"
                    ? "市场"
                    : type === "flag"
                      ? "国家/地区"
                      : type === "broker"
                        ? "券商"
                        : "名称 / 代码"}
                </span>
                {type === "stock" && <span>市场</span>}
              </div>
            )}
          <div
            ref={itemRoot}
            className={`asset-library-items ${view} ${type === "card" ? "cards" : ""}`}
            aria-busy={loading}
          >
            {shown?.assets.map((asset, index) => (
              <article
                className="asset-library-item"
                key={asset.id}
                data-broker-id={type === "broker" ? asset.id : undefined}
                data-dragging={brokerOrder.dragging === asset.id || undefined}
              >
                {selecting && (
                  <input
                    className="asset-batch-check"
                    type="checkbox"
                    aria-label={`选择 ${asset.name}`}
                    checked={selection.includes(asset.id)}
                    disabled={bulkBusy}
                    onChange={(event) =>
                      setSelection(
                        event.target.checked
                          ? [...selection, asset.id]
                          : selection.filter((id) => id !== asset.id),
                      )
                    }
                  />
                )}
                <span className="asset-library-rank" aria-hidden="true">
                  {(page - 1) * pageSize + index + 1}
                </span>
                {type === "broker" && (
                  <BrokerGrip
                    id={asset.id}
                    order={brokerOrder}
                    disabled={
                      uploadDisabled ||
                      labelBlocked ||
                      command.blocked ||
                      loading ||
                      deleted
                    }
                  />
                )}
                <button
                  type="button"
                  className={
                    type === "card"
                      ? "asset-card-picture"
                      : "asset-library-picture asset-library-icon-button asset-icon-frame"
                  }
                  aria-label={`更换 ${asset.name || asset.code} ${type === "card" ? "卡面" : "图标"}`}
                  title={
                    asset.imageInheritance
                      ? `沿用 ${asset.imageInheritance.code} 图标，点击更换共享图标`
                      : type === "card"
                        ? "点击更换卡面图片"
                        : "点击上传/更换图标"
                  }
                  disabled={
                    uploadDisabled ||
                    labelBlocked ||
                    command.blocked ||
                    deleted ||
                    queryPending ||
                    !onReplace ||
                    !Number.isSafeInteger(loaded?.revision) ||
                    busy
                  }
                  onClick={() => {
                    if (loaded?.revision === undefined) return;
                    replaceTarget.current = {
                      asset: asset.iconTarget || { ...asset, type },
                      revision: loaded.revision,
                    };
                    fileInput.current?.click();
                  }}
                >
                  <Thumbnail
                    key={
                      refresh +
                      ":" +
                      ((dark ? asset.imageUrlDark : "") ||
                        asset.imageUrl ||
                        asset.id)
                    }
                    url={(dark ? asset.imageUrlDark : "") || asset.imageUrl}
                    name={asset.name}
                  />
                  <span className="asset-library-camera" aria-hidden="true">
                    <Camera size={17} />
                  </span>
                </button>
                <span className="asset-library-caption">
                  <MaterialName
                    asset={asset}
                    revision={loaded?.revision || 0}
                    editor={nameEditor}
                    disabled={
                      uploadDisabled ||
                      labelBlocked ||
                      command.blocked ||
                      deleted ||
                      loading ||
                      !Number.isSafeInteger(loaded?.revision)
                    }
                  />
                  <small>
                    {type === "stock" && asset.market && (
                      <span className="asset-market-badge">{asset.market}</span>
                    )}
                    {asset.imageInheritance && (
                      <span className="asset-inheritance-label">
                        沿用 {asset.imageInheritance.code} 图标 ·{" "}
                      </span>
                    )}
                    {type === "card" ? (
                      [
                        asset.region || asset.market,
                        asset.bank,
                        asset.customized ? "自定义照片" : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    ) : type === "broker" ? (
                      <button
                        className="asset-broker-category"
                        type="button"
                        disabled={
                          readOnly ||
                          uploadDisabled ||
                          labelBlocked ||
                          command.blocked ||
                          deleted ||
                          loading ||
                          !Number.isSafeInteger(loaded?.revision)
                        }
                        onClick={(event) =>
                          nameEditor.begin(
                            asset,
                            loaded?.revision || 0,
                            event.currentTarget,
                          )
                        }
                        aria-label={`修改${asset.name}分类`}
                      >
                        {asset.brokerMarkets !== undefined
                          ? asset.brokerMarkets
                              .map((code) => markets[code] || code)
                              .join(" · ") || "未分类"
                          : markets[asset.market || ""] || "未分类"}
                      </button>
                    ) : (
                      asset.code ||
                      asset.market ||
                      categories.find(([key]) => key === type)?.[1]
                    )}
                  </small>
                </span>
                {type === "card" &&
                  asset.customized &&
                  assetImageUrl(asset.originalImageUrl) && (
                    <button
                      type="button"
                      className="asset-card-reset"
                      disabled={
                        uploadDisabled || labelBlocked || loading || !onRestore
                      }
                      onClick={() => {
                        if (loaded?.revision !== undefined)
                          onRestore?.({ ...asset, type }, loaded.revision);
                      }}
                    >
                      恢复原图
                    </button>
                  )}
                <button
                  type="button"
                  className="asset-row-remove"
                  aria-label={`${deleted ? "恢复" : "移除"} ${asset.name}`}
                  title={deleted ? "恢复素材" : "移出素材库，保留原文件"}
                  disabled={
                    uploadDisabled ||
                    labelBlocked ||
                    command.blocked ||
                    loading ||
                    loaded?.revision === undefined
                  }
                  onClick={() =>
                    loaded?.revision !== undefined &&
                    void command.execute({
                      action: deleted ? "restore" : "delete",
                      asset,
                      revision: loaded.revision,
                    })
                  }
                >
                  {deleted ? <Undo2 size={17} /> : <Trash2 size={17} />}
                </button>
                {type === "stock" && (
                  <span className="asset-library-market">
                    {marketFlags[asset.market || ""] && (
                      <img
                        src={assetImageUrl(marketFlags[asset.market || ""])}
                        alt=""
                      />
                    )}
                    {markets[asset.market || ""] ||
                      asset.market ||
                      categories.find(([key]) => key === type)?.[1]}
                  </span>
                )}
              </article>
            ))}
          </div>
          {nameEditor.pending &&
            !shown?.assets.some(
              (asset) => asset.id === nameEditor.editingId,
            ) && (
              <div className="notice">
                <span>名称修改结果待确认</span>
                <button
                  type="button"
                  disabled={nameEditor.busy}
                  onClick={() => void nameEditor.check()}
                >
                  核对修改结果
                </button>
              </div>
            )}
          {!loading && shown?.assets.length === 0 && (
            <div className="asset-library-empty">
              <ImageOff size={30} />
              <h3>
                {deleted
                  ? "暂无已移除素材"
                  : query || market
                    ? "没有匹配的素材"
                    : "这里还没有素材"}
              </h3>
              <p>
                {query || market
                  ? "试试其他名称或代码"
                  : deleted
                    ? "移除后的素材可以在这里恢复"
                    : type === "broker"
                      ? "添加券商，管理图标与市场分类"
                      : "添加素材或从来源清单导入"}
              </p>
              {type === "stock" && query && !deleted && !creating ? (
                <button
                  type="button"
                  className="button asset-create-trigger"
                  disabled={
                    command.blocked ||
                    labelBlocked ||
                    uploadDisabled ||
                    loaded?.revision === undefined
                  }
                  onClick={() => setCreating(true)}
                >
                  <Plus size={17} />
                  添加 {query.toUpperCase()}
                </button>
              ) : (
                (query || market) && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      clearSearch();
                      setMarket("");
                    }}
                  >
                    清除筛选
                  </button>
                )
              )}
            </div>
          )}
          {pages > 1 && (
            <nav className="asset-library-pagination" aria-label="素材分页">
              <button
                className="button secondary"
                disabled={loading || retired || page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                上一页
              </button>
              <span className="asset-library-page-position">
                {page} / {pages}
              </span>
              <div className="asset-library-page-numbers">
                {assetPageNumbers(page, pages).map((n, i) =>
                  typeof n === "number" ? (
                    <button
                      type="button"
                      className="asset-library-page-button"
                      key={n}
                      aria-label={`第 ${n} 页`}
                      aria-current={n === page ? "page" : undefined}
                      disabled={loading || retired || !shown}
                      onClick={() => setPage(n)}
                    >
                      {n}
                    </button>
                  ) : (
                    <span key={`gap-${i}`} aria-hidden="true">
                      {n}
                    </span>
                  ),
                )}
              </div>
              <button
                className="button secondary"
                disabled={loading || retired || !shown || page >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </button>
              {shown && pages > 1 && (
                <form
                  className="asset-library-jump"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!loading && !retired && validTarget) {
                      setPage(targetPage);
                      setPageDraft("");
                    }
                  }}
                >
                  <label>
                    共 {pages} 页 · 跳至
                    <input
                      aria-label="跳转素材页码"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={pages}
                      step={1}
                      placeholder={String(page)}
                      value={pageDraft}
                      disabled={loading || retired}
                      onChange={(e) => setPageDraft(e.target.value)}
                    />
                  </label>
                  <button
                    className="button secondary"
                    disabled={loading || retired || !validTarget}
                  >
                    跳转
                  </button>
                </form>
              )}
            </nav>
          )}
        </>
      )}
    </section>
  );
}
