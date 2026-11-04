import { Dialog } from "./dialog";
import { WorkspaceEmpty } from "./workspace-ui";
import { CardGallery } from "./card-gallery";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { requestId } from "./request-id";
import { SelectMenu } from "./select-menu";
import {
  readPreferenceOperation,
  releasePreferenceOperation,
  retainPreferenceOperation,
  type CardPreferenceOperation,
  type PreferenceCard,
} from "./card-preference-state";

type Preferences = {
  tags: Record<string, string[]>;
  holdings: string[];
  revision: number;
};
type Receipt = {
  requestId: string;
  revision?: number;
  state?: "closed";
  executed?: boolean;
  data?: { cardKey: string; tags?: string[]; held?: boolean };
};
const root = "/account/card-preferences";
type PreferenceProps = {
  session: Session;
  active?: boolean;
  cards: readonly PreferenceCard[];
  images?: readonly { path: string }[];
  invalid?: number;
  revisionHint: number;
  onChanged?: () => void;
  onPermissionError?: (failure: unknown) => void;
};
export function CardPreferenceSettings(props: PreferenceProps) {
  const session = props.session;
  return (
    <CardPreferenceContent
      key={JSON.stringify([
        session.instance_id,
        session.user.id,
        session.user.role,
        session.receipt_scope,
        session.csrf,
        session.expires_at,
      ])}
      {...props}
    />
  );
}
function CardPreferenceContent({
  session,
  active = true,
  cards,
  images = [],
  invalid = 0,
  revisionHint,
  onChanged,
  onPermissionError,
}: {
  session: Session;
  active?: boolean;
  cards: readonly PreferenceCard[];
  images?: readonly { path: string }[];
  invalid?: number;
  revisionHint: number;
  onChanged?: () => void;
  onPermissionError?: (failure: unknown) => void;
}) {
  const scope = JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const epoch = useRef(0);
  const visible = useRef(active);
  if (visible.current !== active) {
    visible.current = active;
    epoch.current += 1;
  }
  useEffect(() => {
    currentScope.current = scope;
    return () => {
      currentScope.current = "";
      epoch.current += 1;
    };
  }, [scope]);
  const [stateScope, setStateScope] = useState(scope);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [selected, setSelected] = useState(""),
    [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [pending, setPending] = useState<CardPreferenceOperation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const permissionCallback = useRef(onPermissionError);
  permissionCallback.current = onPermissionError;
  const changeCallback = useRef(onChanged);
  changeCallback.current = onChanged;
  const report = useCallback((failure: unknown) => {
    if (
      !currentScope.current ||
      (!visible.current &&
        !(failure instanceof ApiError && [401, 403].includes(failure.status)))
    )
      return;
    setError(failure instanceof Error ? failure.message : "卡包偏好未保存");
    if (failure instanceof ApiError && [401, 403].includes(failure.status)) {
      epoch.current += 1;
      setPreferences(null);
      setDrafts({});
      setSelected("");
      setQuery("");
      setPending(null);
      setMessage("");
      try {
        const old = readPreferenceOperation(
          sessionStorage,
          currentScope.current,
        );
        if (old)
          releasePreferenceOperation(
            sessionStorage,
            currentScope.current,
            old.requestId,
          );
      } catch {
        /* Invalid original evidence cannot authorize any operation. */
      }
      permissionCallback.current?.(failure);
    }
  }, []);
  const refresh = useCallback(async () => {
    if (!visible.current || !currentScope.current) return;
    const mine = ++epoch.current,
      context = currentScope.current;
    const result = await api<Preferences>(root);
    if (
      mine === epoch.current &&
      context === currentScope.current &&
      visible.current
    )
      setPreferences(result);
  }, []);
  useEffect(() => {
    epoch.current += 1;
    setPreferences(null);
    setDrafts({});
    setSelected("");
    setQuery("");
    setPending(null);
    setError("");
    setMessage("");
    setBusy(false);
    setStateScope(scope);
    try {
      setPending(readPreferenceOperation(sessionStorage, scope));
    } catch (failure) {
      report(failure);
    }
  }, [scope, report]);
  useEffect(() => {
    if (!active) return;
    let valid = true;
    void refresh().catch((failure) => {
      if (valid) report(failure);
    });
    return () => {
      valid = false;
      epoch.current += 1;
    };
  }, [active, scope, revisionHint, refresh, report]);
  useEffect(() => {
    if (!selected && cards.length) setSelected(cards[0].key);
  }, [selected, cards]);
  const selectedAvailable = cards.some((card) => card.key === selected);
  const tags = drafts[selected] ?? preferences?.tags[selected] ?? [""];
  const filtered = cards.filter((card) =>
    card.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const options = filtered
    .slice(0, 200)
    .map((card) => ({ value: card.key, label: card.label }));
  const selectedCard = cards.find((card) => card.key === selected);
  if (selectedCard && !options.some((option) => option.value === selected))
    options.unshift({ value: selectedCard.key, label: selectedCard.label });
  if (selected && !selectedAvailable)
    options.push({ value: selected, label: "原卡面来源已变化" });

  function validate(receipt: Receipt, operation: CardPreferenceOperation) {
    if (receipt.requestId !== operation.requestId)
      throw new Error("原卡包回执不匹配");
    if (receipt.state === "closed" && receipt.executed === false) return;
    if (
      !receipt.data ||
      typeof receipt.data.cardKey !== "string" ||
      !Number.isSafeInteger(receipt.revision) ||
      (operation.kind === "tags"
        ? !Array.isArray(receipt.data.tags) ||
          receipt.data.tags.some((tag) => typeof tag !== "string")
        : typeof receipt.data.held !== "boolean")
    )
      throw new Error("原卡包回执不完整，请核对原请求");
  }
  async function finish(result: Receipt, operation: CardPreferenceOperation) {
    validate(result, operation);
    releasePreferenceOperation(sessionStorage, scope, operation.requestId);
    setPending(null);
    if (result.state === "closed") setMessage("已关闭原请求");
    else {
      if (operation.kind === "tags" && result.data)
        setDrafts((previous) => {
          const next = { ...previous };
          delete next[result.data!.cardKey];
          return next;
        });
      setMessage(operation.kind === "tags" ? "标签已保存" : "持有标记已保存");
    }
    await refresh();
    changeCallback.current?.();
  }
  async function save(kind: CardPreferenceOperation["kind"], value: unknown) {
    if (pending || busy || !preferences || !selectedAvailable) return;
    const operation = { requestId: requestId(), kind },
      context = scope;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      retainPreferenceOperation(sessionStorage, scope, operation);
      setPending(operation);
      const result = await api<Receipt>(
        root,
        {
          method: "PUT",
          body: JSON.stringify({
            requestId: operation.requestId,
            expectedRevision: preferences.revision,
            kind,
            cardKey: selected,
            value,
          }),
        },
        session.csrf,
      );
      if (context === currentScope.current) await finish(result, operation);
    } catch (failure) {
      if (context !== currentScope.current) return;
      if (
        failure instanceof ApiError &&
        [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(failure.status)
      ) {
        try {
          releasePreferenceOperation(
            sessionStorage,
            scope,
            operation.requestId,
          );
          setPending(null);
        } catch {
          /* Preserve mismatching original evidence. */
        }
      }
      report(failure);
    } finally {
      if (context === currentScope.current) setBusy(false);
    }
  }
  async function original(close = false) {
    if (!pending || busy) return;
    const operation = pending,
      context = scope;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<Receipt>(
        root + "/operations/" + operation.requestId + (close ? "/close" : ""),
        close ? { method: "POST", body: "{}" } : {},
        close ? session.csrf : undefined,
      );
      if (context === currentScope.current) await finish(result, operation);
    } catch (failure) {
      if (context === currentScope.current) report(failure);
    } finally {
      if (context === currentScope.current) setBusy(false);
    }
  }
  if (stateScope !== scope) return null;
  const disabled =
    busy || pending !== null || !preferences || !selectedAvailable;
  return (
    <article className="card-catalog-panel" aria-label="卡包偏好">
      <h2>卡面图库</h2>
      {error && (
        <p role="alert" className="card-catalog-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {pending && (
        <div className="card-catalog-pending">
          <code>{pending.requestId}</code>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void original()}
          >
            核对原请求
          </button>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void original(true)}
          >
            关闭原请求
          </button>
        </div>
      )}
      {!!cards.length && (
        <label>
          <span className="card-filter-label">
            筛选卡面 <small>{filtered.length} 张</small>
          </span>
          <input
            type="search"
            aria-label="筛选卡面"
            placeholder="搜索银行或卡片名称"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      )}
      {cards.length > 0 && filtered.length === 0 ? (
        <WorkspaceEmpty
          title="没有匹配的卡面"
          description="调整关键词，或清空筛选查看全部卡面。"
          actions={
            <button type="button" onClick={() => setQuery("")}>
              清空筛选
            </button>
          }
        />
      ) : (
        <CardGallery
          filterKey={query.trim().toLocaleLowerCase()}
          cards={filtered}
          images={images}
          selected={selected}
          onSelect={(key) => {
            setSelected(key);
            setEditing(true);
          }}
          disabled={busy || !!pending}
        />
      )}
      {editing && options.length ? (
        <Dialog
          title={selectedCard?.label || "卡包偏好"}
          onClose={() => {
            if (!busy) setEditing(false);
          }}
        >
          <div className="dialog-content card-preference-editor">
            <SelectMenu
              label="卡面"
              value={selected}
              options={options}
              disabled={busy}
              onChange={setSelected}
              variant="field"
            />
            {!selectedAvailable && <p>原卡面来源已变化，请选择当前卡面</p>}
            <div className="card-catalog-actions">
              <button
                className="button secondary"
                disabled={disabled}
                onClick={() =>
                  void save(
                    "holdings",
                    !preferences?.holdings.includes(selected),
                  )
                }
              >
                {preferences
                  ? preferences.holdings.includes(selected)
                    ? "移出我的卡"
                    : "加入我的卡"
                  : "正在读取"}
              </button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save("tags", tags);
              }}
              className="card-preference-tags"
            >
              <label>标签</label>
              {tags.map((tag, index) => (
                <div className="card-catalog-actions" key={index}>
                  <input
                    aria-label={`标签 ${index + 1}`}
                    value={tag}
                    disabled={disabled}
                    onChange={(event) =>
                      setDrafts((previous) => ({
                        ...previous,
                        [selected]: tags.map((value, at) =>
                          at === index ? event.target.value : value,
                        ),
                      }))
                    }
                  />
                  <button
                    className="button secondary"
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      setDrafts((previous) => ({
                        ...previous,
                        [selected]: tags.filter((_, at) => at !== index),
                      }))
                    }
                  >
                    移除
                  </button>
                </div>
              ))}
              <div className="card-catalog-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={disabled || tags.length >= 10}
                  onClick={() =>
                    setDrafts((previous) => ({
                      ...previous,
                      [selected]: [...tags, ""],
                    }))
                  }
                >
                  添加标签
                </button>
                <button
                  type="submit"
                  className="button primary"
                  disabled={disabled}
                >
                  保存标签
                </button>
              </div>
            </form>
          </div>
        </Dialog>
      ) : !options.length ? (
        <p>尚无可选卡面</p>
      ) : null}
      {invalid > 0 && <p>{invalid} 项卡面标识无法核对</p>}
    </article>
  );
}
