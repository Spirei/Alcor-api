import { useEffect, useRef, useState } from "react";
import {
  Grid2X2,
  List,
  Search,
  RefreshCw,
  ImageOff,
  ChevronRight,
  X,
} from "lucide-react";
import { api, type Session } from "./api";
import { Dialog } from "./dialog";
import { assetPageKey, assetPageNumbers } from "./asset-library-state";
import "./asset-library-browser.css";

const categories = [
  ["stock", "股票图标"],
  ["crypto", "加密货币"],
  ["metal", "贵金属"],
  ["market", "市场图标"],
  ["flag", "国家/地区旗帜"],
  ["broker", "券商图标"],
  ["group", "分组图标"],
  ["icon", "图标"],
  ["card", "卡片"],
] as const;
const pageSize = 10;
const markets: Record<string, string> = {
  US: "美股",
  HK: "港股",
  CN: "A股",
  JP: "日股",
  KR: "韩股",
  SG: "新加坡",
  UK: "英股",
  DE: "德股",
  FR: "法股",
  AU: "澳股",
  CA: "加拿大",
  IN: "印度",
  TW: "台湾",
  BR: "巴西",
};
type Asset = {
  id: string;
  name: string;
  code?: string;
  market?: string;
  imageUrl?: string;
  imageUrlDark?: string;
};
type Listing = {
  assets: Asset[];
  total: number;
  page: number;
  pageSize: number;
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
}: {
  session: Session;
  active?: boolean;
  revision?: number;
}) {
  // Parent is keyed by the full session. This cache is bounded and never shared across accounts.
  const cache = useRef(new Map<string, Listing>());
  const generation = useRef(0);
  const [type, setType] = useState("stock"),
    [market, setMarket] = useState("");
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const [view, setView] = useState<"grid" | "list">("list"),
    [dark, setDark] = useState(false);
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
  const [selection, setSelection] = useState<{
    key: string;
    asset: Asset;
  } | null>(null);
  const [pageDraft, setPageDraft] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const key = assetPageKey(type, market, query, page);
  const selected = selection?.key === key ? selection.asset : null;
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
      if (document.hidden) setSelection(null);
    };
    const retire = () => {
      ++generation.current;
      cache.current.clear();
      setRetired(true);
      setListing(null);
      setSelection(null);
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
    setSelection(null);
    if (!active || !visible || retired) {
      setListing(null);
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    const reading = ++generation.current;
    setBusy(true);
    setError("");
    void api<Listing>("/assets?" + key, { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted || reading !== generation.current) return;
        if (
          !value ||
          !Array.isArray(value.assets) ||
          value.assets.length > pageSize ||
          !Number.isSafeInteger(value.total) ||
          value.total < value.assets.length ||
          !Number.isSafeInteger(value.page) ||
          value.page < 1 ||
          value.pageSize !== pageSize ||
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
        if (value.page !== page) setPage(value.page);
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
  const shown =
    active && visible && !retired
      ? listing?.key === key
        ? listing.value
        : (cache.current.get(key) ?? null)
      : null;
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
  return (
    <section className="asset-library" aria-label="素材浏览">
      <nav className="asset-library-tabs" aria-label="素材分类">
        {categories.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={type === key}
            onClick={() => {
              if (key === type) return;
              setType(key);
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
      <div className="asset-library-toolbar">
        {type === "stock" && (
          <div
            className="asset-library-markets"
            role="group"
            aria-label="市场快捷筛选"
          >
            {["", "US", "HK", "CN", "JP", "KR"].map((m) => (
              <button
                type="button"
                key={m}
                aria-pressed={market === m}
                onClick={() => {
                  setMarket(m);
                  setPage(1);
                }}
              >
                {markets[m] || "全部"}
              </button>
            ))}
          </div>
        )}
        <label className="asset-library-search">
          <Search size={18} />
          <input
            ref={searchInput}
            aria-label="搜索素材"
            placeholder="搜索名称或代码"
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
        {type === "stock" && (
          <select
            aria-label="筛选素材市场"
            value={market}
            onChange={(e) => {
              setMarket(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部市场</option>
            {[
              "US",
              "HK",
              "CN",
              "JP",
              "KR",
              "SG",
              "UK",
              "DE",
              "FR",
              "AU",
              "CA",
              "IN",
              "TW",
              "BR",
            ].map((m) => (
              <option key={m} value={m}>
                {markets[m]} · {m}
              </option>
            ))}
          </select>
        )}
        <div
          className="asset-library-tools"
          role="group"
          aria-label="素材显示方式"
        >
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
            className="button secondary"
            aria-pressed={dark}
            onClick={() => setDark(!dark)}
          >
            {dark ? "深色预览" : "浅色预览"}
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
      <div className="asset-library-meta" aria-live="polite">
        {retired ? (
          "登录状态已变化，请重新打开素材库"
        ) : error ? (
          <span role="alert">{error}</span>
        ) : shown ? (
          `${shown.total} 项素材${loading ? " · 更新中…" : ""}`
        ) : loading ? (
          "正在读取素材…"
        ) : (
          ""
        )}
      </div>
      {view === "list" && shown && shown.assets.length > 0 && (
        <div className="asset-library-list-head" aria-hidden="true">
          <span>序号</span>
          <span>名称 / 代码</span>
          <span>市场 / 分类</span>
        </div>
      )}
      <div
        className={`asset-library-items ${view} ${type === "card" ? "cards" : ""} ${dark ? "dark-preview" : ""}`}
        aria-busy={loading}
      >
        {shown?.assets.map((asset, index) => (
          <button
            type="button"
            className="asset-library-item"
            key={asset.id}
            onClick={() => setSelection({ key, asset })}
          >
            <span className="asset-library-rank" aria-hidden="true">
              {(page - 1) * pageSize + index + 1}
            </span>
            <span className="asset-library-picture">
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
            </span>
            <span className="asset-library-caption">
              <strong>{asset.name || asset.code || "未命名素材"}</strong>
              <small>
                {[asset.market, asset.code].filter(Boolean).join(" · ") ||
                  categories.find(([key]) => key === type)?.[1]}
              </small>
            </span>
            <span className="asset-library-market">
              {markets[asset.market || ""] ||
                asset.market ||
                categories.find(([key]) => key === type)?.[1]}
            </span>
            <ChevronRight
              className="asset-library-open"
              size={15}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
      {!loading && shown?.assets.length === 0 && (
        <div className="asset-library-empty">
          <ImageOff size={30} />
          <h3>{query || market ? "没有匹配的素材" : "这里还没有素材"}</h3>
          <p>
            {query || market
              ? "试试其他名称或代码"
              : "素材放入目录并完成登记后，会显示在这里。"}
          </p>
          {(query || market) && (
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
          )}
        </div>
      )}
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
      {selected && active && visible && !retired && (
        <Dialog
          title={selected.name || selected.code || "素材预览"}
          onClose={() => setSelection(null)}
          className="asset-library-dialog"
        >
          <div className={`asset-library-large ${dark ? "dark-preview" : ""}`}>
            <Thumbnail
              key={
                (dark ? selected.imageUrlDark : "") ||
                selected.imageUrl ||
                selected.id
              }
              url={(dark ? selected.imageUrlDark : "") || selected.imageUrl}
              name={selected.name}
            />
          </div>
          <p>{[selected.market, selected.code].filter(Boolean).join(" · ")}</p>
          <button
            className="button secondary"
            aria-pressed={dark}
            onClick={() => setDark(!dark)}
          >
            {dark ? "切换浅色背景" : "切换深色背景"}
          </button>
        </Dialog>
      )}
    </section>
  );
}
