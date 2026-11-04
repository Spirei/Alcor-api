import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { api } from "./api";
import { SelectMenu } from "./select-menu";
import { libraryMarkets, type LibraryAsset } from "./asset-library-market";
import { requestId } from "./request-id";
export function MaterialCreate({
  kind,
  market,
  query,
  disabled,
  onSave,
  onCancel,
}: {
  kind: "stock" | "broker";
  market: string;
  query: string;
  disabled: boolean;
  onSave: (asset: LibraryAsset) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState(market || "US"),
    [code, setCode] = useState(kind === "stock" ? query.toUpperCase() : ""),
    [name, setName] = useState("");
  const [candidates, setCandidates] = useState<LibraryAsset[]>([]),
    [matching, setMatching] = useState(kind === "stock" && !!query);
  useEffect(() => {
    if (kind !== "stock" || !query) return;
    const abort = new AbortController();
    setMatching(true);
    void api<{ results?: unknown[] }>(
      "/search?q=" + encodeURIComponent(query),
      { signal: abort.signal },
    )
      .then((raw) => {
        if (abort.signal.aborted) return;
        const rows = Array.isArray(raw.results) ? raw.results : [];
        const unique = new Map<string, LibraryAsset>();
        for (const item of rows.slice(0, 100)) {
          const v = item as {
            market?: unknown;
            code?: unknown;
            name?: unknown;
          };
          if (
            typeof v.market !== "string" ||
            typeof v.code !== "string" ||
            typeof v.name !== "string" ||
            !Object.hasOwn(libraryMarkets, v.market) ||
            !/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(v.code) ||
            !v.name ||
            v.name.length > 120 ||
            (market && v.market !== market)
          )
            continue;
          const id = `stock:${v.market}:${v.code}`;
          unique.set(id, {
            id,
            type: "stock",
            market: v.market,
            code: v.code,
            name: v.name,
          });
        }
        setCandidates([...unique.values()]);
      })
      .catch(() => {})
      .finally(() => {
        if (!abort.signal.aborted) setMatching(false);
      });
    return () => abort.abort();
  }, [kind, query, market]);
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    input.current?.focus();
  }, [matching, candidates.length]);
  const valid =
    kind === "broker"
      ? !!name.trim()
      : /^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(code.trim().toUpperCase());
  if (matching)
    return (
      <div className="asset-candidate-list" role="status">
        正在匹配证券名称与代码…
      </div>
    );
  if (candidates.length)
    return (
      <div className="asset-candidate-list">
        <div className="asset-candidate-heading">
          <span>选择要添加的证券</span>
          <button
            type="button"
            className="asset-name-action"
            aria-label="取消添加素材"
            onClick={onCancel}
            disabled={disabled}
          >
            <X size={18} />
          </button>
        </div>
        {candidates.map((asset) => (
          <div className="asset-candidate-row" key={asset.id}>
            <span>
              <strong>{asset.name}</strong>
              <small>
                {libraryMarkets[asset.market!]} · {asset.code}
              </small>
            </span>
            <button
              type="button"
              className="button secondary"
              disabled={disabled}
              onClick={() => onSave(asset)}
            >
              添加
            </button>
          </div>
        ))}
      </div>
    );
  return (
    <form
      className="asset-create-inline"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || disabled) return;
        const ticker =
          kind === "broker" ? "B-" + requestId() : code.trim().toUpperCase();
        onSave({
          id: `${kind}:${selected}:${ticker}`,
          type: kind,
          market: selected,
          code: ticker,
          name: name.trim() || ticker,
        });
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !disabled) {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <SelectMenu
        label="所属市场"
        value={selected}
        options={Object.entries(libraryMarkets).map(([value, label]) => ({
          value,
          label,
        }))}
        onChange={setSelected}
        disabled={disabled}
      />
      {kind === "stock" && (
        <label>
          股票代码
          <input
            ref={input}
            aria-label="新增股票代码"
            maxLength={40}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={disabled}
            autoCapitalize="characters"
            placeholder="如 RKLX"
          />
        </label>
      )}
      <label>
        {kind === "broker" ? "券商名称" : "名称"}
        <input
          ref={kind === "broker" ? input : undefined}
          aria-label={kind === "broker" ? "新增券商名称" : "新增股票名称"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          disabled={disabled}
          placeholder={kind === "broker" ? "输入券商名称" : "选填"}
        />
      </label>
      <button
        className="asset-name-action"
        title="添加"
        aria-label="确认添加素材"
        disabled={disabled || !valid}
      >
        <Check size={18} />
      </button>
      <button
        type="button"
        className="asset-name-action"
        title="取消"
        aria-label="取消添加素材"
        onClick={onCancel}
        disabled={disabled}
      >
        <X size={18} />
      </button>
    </form>
  );
}
