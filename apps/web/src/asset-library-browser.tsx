import { useEffect, useRef, useState } from "react";
import { Grid2X2, List, Search, RefreshCw, ImageOff } from "lucide-react";
import { api, type Session } from "./api";
import { Dialog } from "./dialog";
import "./asset-library-browser.css";

const categories = [
  ["stock", "股票"],
  ["market", "市场"],
  ["flag", "国旗"],
  ["broker", "券商"],
  ["group", "分组"],
  ["crypto", "加密资产"],
  ["metal", "贵金属"],
  ["icon", "图标"],
  ["card", "卡面"],
] as const;
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
export function assetImageUrl(value?: string): string {
  // Images stay on the registered local media authority; never load arbitrary remote URLs.
  return value &&
    /^\/(?:api\/asset-image\/|uploads\/)[^\\\s#]*$/.test(value) &&
    !/%(?:2f|5c|00|2e)/i.test(value) &&
    !value.split("?")[0].split("/").includes("..")
    ? value
    : "";
}
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
}: {
  session: Session;
  active?: boolean;
}) {
  // Parent is keyed by the full session. This cache is bounded and never shared across accounts.
  const cache = useRef(new Map<string, Listing>());
  const generation = useRef(0);
  const [type, setType] = useState("stock"),
    [market, setMarket] = useState("");
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1);
  const [view, setView] = useState<"grid" | "list">("grid"),
    [dark, setDark] = useState(false);
  const [listing, setListing] = useState<Listing | null>(null),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [retired, setRetired] = useState(false);
  const [visible, setVisible] = useState(
    typeof document === "undefined" || !document.hidden,
  );
  const [selected, setSelected] = useState<Asset | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) ++generation.current;
      setVisible(!document.hidden);
      if (document.hidden) setSelected(null);
    };
    const retire = () => {
      ++generation.current;
      cache.current.clear();
      setRetired(true);
      setListing(null);
      setSelected(null);
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
    setSelected(null);
    if (!active || !visible || retired) {
      setListing(null);
      setBusy(false);
      return;
    }
    const controller = new AbortController();
    const reading = ++generation.current;
    const params = new URLSearchParams({
      type,
      paged: "1",
      page: String(page),
      pageSize: "36",
      q: query,
    });
    if (market && type === "stock") params.set("market", market);
    const key = params.toString();
    setListing(cache.current.get(key) ?? null);
    setBusy(true);
    setError("");
    void api<Listing>("/assets?" + key, { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted || reading !== generation.current) return;
        if (
          !value ||
          !Array.isArray(value.assets) ||
          value.assets.length > 36 ||
          !Number.isSafeInteger(value.total) ||
          value.total < value.assets.length ||
          !Number.isSafeInteger(value.page) ||
          value.page < 1 ||
          value.pageSize !== 36 ||
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
        setListing(value);
        if (value.page !== page) setPage(value.page);
      })
      .catch((reason) => {
        if (!controller.signal.aborted && reading === generation.current) {
          setListing(null);
          setError(reason instanceof Error ? reason.message : "素材读取失败");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && reading === generation.current)
          setBusy(false);
      });
    return () => controller.abort();
  }, [
    active,
    visible,
    retired,
    type,
    market,
    query,
    page,
    refresh,
    session.csrf,
  ]);
  const shown = active && visible && !retired ? listing : null;
  const pages = shown ? Math.max(1, Math.ceil(shown.total / 36)) : page;
  return (
    <section className="asset-library" aria-label="素材浏览">
      <nav className="asset-library-tabs" aria-label="素材分类">
        {categories.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={type === key}
            onClick={() => {
              setType(key);
              setMarket("");
              setPage(1);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="asset-library-toolbar">
        <label className="asset-library-search">
          <Search size={18} />
          <input
            aria-label="搜索素材"
            placeholder="搜索名称或代码"
            value={search}
            maxLength={120}
            onChange={(e) => setSearch(e.target.value)}
          />
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
              <option key={m}>{m}</option>
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
            disabled={busy || retired}
            onClick={() => setRefresh((v) => v + 1)}
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
          `${shown.total} 项素材${busy ? " · 更新中…" : ""}`
        ) : busy ? (
          "正在读取素材…"
        ) : (
          ""
        )}
      </div>
      <div
        className={`asset-library-items ${view} ${type === "card" ? "cards" : ""} ${dark ? "dark-preview" : ""}`}
        aria-busy={busy}
      >
        {shown?.assets.map((asset) => (
          <button
            type="button"
            className="asset-library-item"
            key={asset.id}
            onClick={() => setSelected(asset)}
          >
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
          </button>
        ))}
      </div>
      {!busy && shown?.assets.length === 0 && (
        <div className="asset-library-empty">
          <ImageOff size={30} />
          <h3>{query ? "没有匹配的素材" : "这里还没有素材"}</h3>
          <p>
            {query
              ? "试试其他名称或代码"
              : "素材放入目录并完成登记后，会显示在这里。"}
          </p>
        </div>
      )}
      <nav className="asset-library-pagination" aria-label="素材分页">
        <button
          className="button secondary"
          disabled={busy || retired || page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          上一页
        </button>
        <span>
          {page} / {pages}
        </span>
        <button
          className="button secondary"
          disabled={busy || retired || !shown || page >= pages}
          onClick={() => setPage((p) => p + 1)}
        >
          下一页
        </button>
      </nav>
      {selected && active && visible && !retired && (
        <Dialog
          title={selected.name || selected.code || "素材预览"}
          onClose={() => setSelected(null)}
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
