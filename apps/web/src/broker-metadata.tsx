import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { requestId } from "./request-id";
import {
  Building2,
  Check,
  Search,
  ArrowLeft,
  RefreshCw,
  Trash2,
  Plus,
  X,
} from "lucide-react";
import { SelectMenu } from "./select-menu";
import { LoadingPlaceholder } from "./loading-placeholder";
import "./broker-metadata.css";
import { restoreBrokerOperation } from "./broker-account-state";

type Account = {
  id: string;
  name: string;
  provider_id: string | null;
  account_kind: string;
  currency: string;
  currencies: string[];
  revision: number;
};
type Snapshot = {
  accounts: Account[];
  collectionRevision: number;
  recordCollectionRevision: number;
  presets: {
    id: string;
    name: string;
    aliases?: string[];
    defaultCurrency?: string;
  }[];
  capabilities: { supported_currencies: string[] };
};
type Command = {
  kind: "create" | "update" | "delete";
  accountId: string;
  expectedCollectionRevision: number;
  expectedRecordCollectionRevision: number;
  data: Record<string, unknown>;
};
type Preview = {
  previewId: string;
  requestId: string;
  expiresAt: string;
  kind: string;
  before: Account | null;
  after: Record<string, unknown> | null;
};
type Receipt = {
  request_id: string;
  state: string;
  error: { message: string } | null;
};
type Draft = {
  id: string;
  name: string;
  provider: string;
  kind: string;
  currency: string;
  currencies: string[];
  revision: number;
  collection: number;
  records: number;
};
const root = "/account/broker-metadata";
const empty: Draft = {
  id: "",
  name: "",
  provider: "",
  kind: "",
  currency: "USD",
  currencies: ["USD"],
  revision: 0,
  collection: 0,
  records: 0,
};
const kinds: Record<string, string> = {
  real: "真实账本",
  simulated: "模拟账本",
  unknown: "未核对",
};
export function BrokerMetadataSettings(props: {
  session: Session;
  active?: boolean;
  initialAccountId?: string;
  mode?: "manager" | "account";
  onChanged?: () => void;
}) {
  const s = props.session;
  return (
    <Content
      key={JSON.stringify([
        s.instance_id,
        s.user.id,
        s.user.role,
        s.receipt_scope,
        s.csrf,
        s.expires_at,
        props.initialAccountId,
      ])}
      {...props}
    />
  );
}
function Content({
  session,
  active = true,
  initialAccountId = "",
  mode = "manager",
  onChanged,
}: {
  session: Session;
  active?: boolean;
  initialAccountId?: string;
  mode?: "manager" | "account";
  onChanged?: () => void;
}) {
  const storageKey =
    "broker-metadata:" +
    JSON.stringify([
      session.instance_id,
      session.user.id,
      session.user.role,
      session.receipt_scope,
    ]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const [preview, setPreview] = useState<{
    value: Preview;
    command: Command;
    epoch: number;
  } | null>(null);
  const [initialOperation] = useState(() => {
    try {
      return {
        id: restoreBrokerOperation(sessionStorage, storageKey),
        error: "",
      };
    } catch {
      return {
        id: null,
        error: "原账户操作编号无法读取，请先恢复浏览器存储并核对原请求。",
      };
    }
  });
  const [pending, setPending] = useState<string | null>(initialOperation.id);
  const [journalError, setJournalError] = useState(initialOperation.error);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [providerPicked, setProviderPicked] = useState(
    !!initialAccountId || mode === "manager",
  );
  const [providerQuery, setProviderQuery] = useState("");
  const epoch = useRef(0),
    alive = useRef(active),
    initialized = useRef(false);
  if (alive.current !== active) {
    alive.current = active;
    epoch.current++;
  }
  const invalidate = () => {
    epoch.current++;
    setPreview(null);
  };
  const report = useCallback(
    (failure: unknown) => {
      if (failure instanceof ApiError && [401, 403].includes(failure.status)) {
        epoch.current++;
        setSnapshot(null);
        setPreview(null);
        setDraft(empty);
        setPending(null);
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* Memory state is already retired. */
        }
      }
      setError(failure instanceof Error ? failure.message : "账户操作失败");
    },
    [storageKey],
  );
  const load = useCallback(
    async (reset = false, rebase = false) => {
      const generation = epoch.current;
      try {
        const data = await api<Snapshot>(root);
        if (!alive.current || generation !== epoch.current) return;
        setSnapshot(data);
        if (!initialized.current || reset) {
          initialized.current = true;
          const account = !reset
            ? data.accounts.find((item) => item.id === initialAccountId)
            : undefined;
          setDraft(
            account
              ? {
                  id: account.id,
                  name: account.name,
                  provider: account.provider_id || "",
                  kind: account.account_kind,
                  currency: account.currency,
                  currencies: [...account.currencies],
                  revision: account.revision,
                  collection: data.collectionRevision,
                  records: data.recordCollectionRevision,
                }
              : {
                  ...empty,
                  id: reset ? "" : initialAccountId,
                  collection: data.collectionRevision,
                  records: data.recordCollectionRevision,
                },
          );
          if (!reset && initialAccountId && !account)
            setError("账户已不存在，请重新选择");
        } else if (rebase)
          setDraft((current) => {
            const account = data.accounts.find(
              (item) => item.id === current.id,
            );
            if (current.id && !account) return current;
            return {
              ...current,
              revision: account?.revision || 0,
              collection: data.collectionRevision,
              records: data.recordCollectionRevision,
            };
          });
      } catch (failure) {
        if (alive.current && generation === epoch.current) report(failure);
      }
    },
    [report, initialAccountId],
  );
  useEffect(() => {
    if (!active) return;
    alive.current = true;
    epoch.current++;
    setPreview(null);
    void load();
    const visibility = () => {
      epoch.current++;
      setPreview(null);
      if (document.visibilityState === "visible" && alive.current) void load();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      alive.current = false;
      epoch.current++;
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [active, load]);
  useEffect(() => {
    if (!preview) return;
    const timer = window.setTimeout(
      () => {
        if (epoch.current === preview.epoch) {
          epoch.current++;
          setPreview(null);
          setError("账户预览已过期");
        }
      },
      Math.max(0, Date.parse(preview.value.expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [preview]);
  function remember(id: string | null): boolean {
    try {
      if (id) sessionStorage.setItem(storageKey, id);
      else sessionStorage.removeItem(storageKey);
      setPending(id);
      return true;
    } catch {
      if (!id) {
        setPending(null);
        return true;
      }
      setError("无法保留原请求编号，未提交账户变更");
      return false;
    }
  }
  function edit(patch: Partial<Draft>) {
    invalidate();
    setDraft((current) => ({ ...current, ...patch }));
    setMessage("");
  }
  function select(id: string) {
    if (!snapshot) return;
    invalidate();
    setError("");
    setMessage("");
    const account = snapshot.accounts.find((item) => item.id === id);
    setDraft(
      account
        ? {
            id: account.id,
            name: account.name,
            provider: account.provider_id || "",
            kind: account.account_kind,
            currency: account.currency,
            currencies: [...account.currencies],
            revision: account.revision,
            collection: snapshot.collectionRevision,
            records: snapshot.recordCollectionRevision,
          }
        : {
            ...empty,
            collection: snapshot.collectionRevision,
            records: snapshot.recordCollectionRevision,
          },
    );
  }
  async function prepare(deleting = false) {
    if (
      !snapshot ||
      busy ||
      pending ||
      journalError ||
      !alive.current ||
      document.hidden
    )
      return;
    invalidate();
    setBusy(true);
    setError("");
    setMessage("");
    const generation = epoch.current;
    const id = requestId();
    const data: Record<string, unknown> = deleting
      ? { request_id: id, revision: draft.revision }
      : {
          request_id: id,
          name: draft.name,
          currency: draft.currency,
          currencies: draft.currencies,
          ...(draft.id
            ? { revision: draft.revision }
            : {
                provider_id: draft.provider || null,
                account_kind: draft.kind,
              }),
        };
    const command: Command = {
      kind: deleting ? "delete" : draft.id ? "update" : "create",
      accountId: draft.id,
      data,
      expectedCollectionRevision: draft.collection,
      expectedRecordCollectionRevision: draft.records,
    };
    try {
      const value = await api<Preview>(
        root + "/preview",
        { method: "POST", body: JSON.stringify(command) },
        session.csrf,
      );
      if (
        alive.current &&
        generation === epoch.current &&
        Date.parse(value.expiresAt) > Date.now()
      )
        setPreview({ value, command, epoch: generation });
    } catch (failure) {
      if (alive.current && generation === epoch.current) report(failure);
    } finally {
      setBusy(false);
    }
  }
  function accept(result: Receipt, id: string) {
    if (
      result.request_id !== id ||
      !["completed", "failed", "closed"].includes(result.state)
    )
      throw new Error("原请求回执仍待核对");
    remember(null);
    invalidate();
    if (result.state === "failed")
      setError(result.error?.message || "账户未保存");
    else setMessage(result.state === "closed" ? "请求已关闭" : "已保存");
    void load(result.state === "completed");
    if (result.state === "completed") onChanged?.();
  }
  async function commit() {
    const proof = preview;
    if (
      !alive.current ||
      document.hidden ||
      !proof ||
      journalError ||
      proof.epoch !== epoch.current ||
      busy ||
      pending ||
      Date.parse(proof.value.expiresAt) <= Date.now()
    ) {
      invalidate();
      return;
    }
    const generation = epoch.current;
    if (!remember(proof.value.requestId)) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<Receipt>(
        root + "/operations",
        {
          method: "POST",
          body: JSON.stringify({
            previewId: proof.value.previewId,
            command: proof.command,
          }),
        },
        session.csrf,
      );
      if (alive.current && generation === epoch.current)
        accept(result, proof.value.requestId);
    } catch (failure) {
      if (alive.current && generation === epoch.current) {
        report(failure);
        invalidate();
      }
    } finally {
      setBusy(false);
    }
  }
  async function resolve(close = false) {
    if (!pending || busy || document.hidden) return;
    const id = pending,
      generation = epoch.current;
    setBusy(true);
    setError("");
    try {
      const result = await api<Receipt>(
        root + "/operations/" + id + (close ? "/close" : ""),
        close ? { method: "POST", body: "{}" } : {},
        close ? session.csrf : undefined,
      );
      if (alive.current && generation === epoch.current) accept(result, id);
    } catch (failure) {
      if (alive.current && generation === epoch.current) report(failure);
    } finally {
      setBusy(false);
    }
  }
  const kindLabelId = useId();
  const proof = preview && preview.epoch === epoch.current ? preview : null;
  const afterCurrencies = proof?.value.after?.currencies;
  const selectedProvider = snapshot?.presets.find(
    (preset) => preset.id === draft.provider,
  );
  const words = providerQuery
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const matchingPresets =
    snapshot?.presets.filter((preset) =>
      words.every((word) =>
        [preset.id, preset.name, ...(preset.aliases || [])].some((term) =>
          term.toLocaleLowerCase().includes(word),
        ),
      ),
    ) || [];
  const currencyOptions = snapshot?.capabilities.supported_currencies || [];
  const disabled = busy || !!pending || !!journalError || !snapshot;
  function chooseProvider(preset: Snapshot["presets"][number] | null) {
    if (!snapshot || busy || pending || journalError) return;
    const currency =
      preset?.defaultCurrency &&
      snapshot.capabilities.supported_currencies.includes(
        preset.defaultCurrency,
      )
        ? preset.defaultCurrency
        : empty.currency;
    invalidate();
    setError("");
    setMessage("");
    setDraft((current) => ({
      ...current,
      provider: preset?.id || "",
      currency,
      currencies: [currency],
      name:
        !current.name ||
        snapshot.presets.some((value) => value.name === current.name)
          ? preset?.name || ""
          : current.name,
    }));
    setProviderPicked(true);
  }
  return (
    <div className="broker-metadata-editor" aria-busy={busy}>
      {(journalError || error) && (
        <p role="alert" className="error broker-metadata-notice">
          {journalError || error}
        </p>
      )}
      {message && (
        <p role="status" className="broker-metadata-notice">
          {message}
        </p>
      )}
      {journalError ? (
        <div className="broker-metadata-actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              try {
                setPending(restoreBrokerOperation(sessionStorage, storageKey));
                setJournalError("");
              } catch {
                setJournalError(
                  "原账户操作编号仍无法读取，请恢复原浏览器存储后重试。",
                );
              }
            }}
          >
            重新读取操作状态
          </button>
        </div>
      ) : pending ? (
        <section className="broker-metadata-receipt" aria-label="原账户操作">
          <strong>账户操作结果待核对</strong>
          <code>{pending}</code>
          <div className="broker-metadata-actions">
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void resolve()}
            >
              查询原请求
            </button>
            <button
              className="button"
              disabled={busy}
              onClick={() => void resolve(true)}
            >
              关闭未执行请求
            </button>
          </div>
        </section>
      ) : proof ? (
        <section className="broker-metadata-preview" aria-label="账户变更确认">
          <dl>
            <div>
              <dt>操作</dt>
              <dd>
                {proof.value.kind === "delete"
                  ? "删除账户"
                  : proof.value.kind === "create"
                    ? "添加账户"
                    : "修改账户"}
              </dd>
            </div>
            <div>
              <dt>账户名称</dt>
              <dd>
                {String(
                  proof.value.after?.name || proof.value.before?.name || "—",
                )}
              </dd>
            </div>
            <div>
              <dt>账户类型</dt>
              <dd>
                {kinds[
                  (proof.value.after?.account_kind as string) ||
                    proof.value.before?.account_kind ||
                    "unknown"
                ] || "未核对"}
              </dd>
            </div>
            <div>
              <dt>默认币种</dt>
              <dd>
                {String(
                  proof.value.after?.currency ||
                    proof.value.before?.currency ||
                    "—",
                )}
              </dd>
            </div>
            <div>
              <dt>可用币种</dt>
              <dd>
                {(Array.isArray(afterCurrencies)
                  ? afterCurrencies
                  : proof.value.before?.currencies || []
                ).join("、") || "—"}
              </dd>
            </div>
          </dl>
          <div className="broker-metadata-actions">
            <button className="button" disabled={busy} onClick={invalidate}>
              返回编辑
            </button>
            <button
              className={
                "button " +
                (proof.value.kind === "delete" ? "danger" : "primary")
              }
              disabled={busy}
              onClick={() => void commit()}
            >
              {busy
                ? "正在保存"
                : "确认" + (proof.value.kind === "delete" ? "删除" : "保存")}
            </button>
          </div>
        </section>
      ) : !snapshot ? (
        <LoadingPlaceholder label="正在读取账户" />
      ) : mode === "account" && !providerPicked && !draft.id ? (
        <section className="broker-provider-picker" aria-label="选择券商">
          <label className="broker-provider-search">
            <Search size={18} aria-hidden="true" />
            <input
              aria-label="搜索券商"
              placeholder="搜索券商名称"
              autoComplete="off"
              value={providerQuery}
              onChange={(event) => setProviderQuery(event.target.value)}
            />
          </label>
          <div className="broker-provider-list">
            {matchingPresets.map((preset) => (
              <button
                type="button"
                key={preset.id}
                className="broker-provider-option"
                onClick={() => chooseProvider(preset)}
              >
                <span className="broker-provider-monogram" aria-hidden="true">
                  {preset.name.slice(0, 1)}
                </span>
                <span>
                  <strong>{preset.name}</strong>
                  <small>
                    {preset.aliases?.find((alias) => /^[A-Za-z]/.test(alias)) ||
                      preset.id}
                  </small>
                </span>
                <PlusMark />
              </button>
            ))}
          </div>
          {matchingPresets.length === 0 && (
            <p className="broker-provider-empty">未找到匹配券商</p>
          )}
          <button
            type="button"
            className="broker-provider-option broker-provider-other"
            onClick={() => chooseProvider(null)}
          >
            <span className="broker-provider-monogram" aria-hidden="true">
              <Building2 size={21} />
            </span>
            <span>
              <strong>其他账户</strong>
            </span>
            <PlusMark />
          </button>
        </section>
      ) : (
        <form
          className="broker-metadata-form"
          onSubmit={(event) => {
            event.preventDefault();
            void prepare();
          }}
        >
          <div className="broker-metadata-fields">
            {mode === "manager" ? (
              <label className="broker-metadata-field broker-metadata-full">
                账户
                <SelectMenu
                  label="账户"
                  variant="field"
                  value={draft.id}
                  onChange={select}
                  disabled={disabled}
                  options={[
                    { value: "", label: "添加账户" },
                    ...(draft.id &&
                    !snapshot.accounts.some(
                      (account) => account.id === draft.id,
                    )
                      ? [{ value: draft.id, label: "账户已不存在" }]
                      : []),
                    ...snapshot.accounts.map((account) => ({
                      value: account.id,
                      label:
                        account.name +
                        " · " +
                        (kinds[account.account_kind] || "未核对"),
                    })),
                  ]}
                />
              </label>
            ) : (
              <div className="broker-metadata-identity">
                <span className="broker-provider-monogram" aria-hidden="true">
                  <Building2 size={24} />
                </span>
                <div>
                  <strong>
                    {selectedProvider?.name ||
                      (draft.id ? draft.name : "其他账户")}
                  </strong>
                  {draft.id && <small>{kinds[draft.kind] || "未核对"}</small>}
                </div>
                {!draft.id && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={disabled}
                    onClick={() => {
                      invalidate();
                      setProviderPicked(false);
                    }}
                  >
                    <ArrowLeft size={15} />
                    更换券商
                  </button>
                )}
              </div>
            )}
            <label className="broker-metadata-field broker-metadata-full">
              账户名称
              <input
                required
                autoComplete="off"
                placeholder="填写账户名称"
                value={draft.name}
                onChange={(event) => edit({ name: event.target.value })}
                disabled={disabled}
                maxLength={60}
              />
            </label>
            {!draft.id && (
              <>
                <div className="broker-metadata-field broker-metadata-full">
                  <span id={kindLabelId}>账户类型</span>
                  <div
                    className="broker-kind-options"
                    role="group"
                    aria-labelledby={kindLabelId}
                  >
                    {[
                      { value: "real", label: "真实账户" },
                      { value: "simulated", label: "模拟账户" },
                    ].map((kind) => (
                      <button
                        type="button"
                        key={kind.value}
                        disabled={disabled}
                        aria-pressed={draft.kind === kind.value}
                        onClick={() => edit({ kind: kind.value })}
                      >
                        {kind.label}
                        {draft.kind === kind.value && (
                          <Check size={16} aria-hidden="true" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
                {mode === "manager" && (
                  <label className="broker-metadata-field broker-metadata-full">
                    券商
                    <SelectMenu
                      label="券商"
                      variant="field"
                      value={draft.provider}
                      onChange={(value) => edit({ provider: value })}
                      disabled={disabled}
                      options={[
                        { value: "", label: "其他账户" },
                        ...snapshot.presets.map((preset) => ({
                          value: preset.id,
                          label: preset.name,
                        })),
                      ]}
                    />
                  </label>
                )}
              </>
            )}
            <label className="broker-metadata-field broker-metadata-full">
              默认币种
              <SelectMenu
                label="默认币种"
                variant="field"
                value={draft.currency}
                onChange={(value) =>
                  edit({
                    currency: value,
                    currencies: [...new Set([...draft.currencies, value])],
                  })
                }
                disabled={disabled}
                options={currencyOptions.map((currency) => ({
                  value: currency,
                  label: currency,
                }))}
              />
            </label>
            <BrokerCurrencyPicker
              options={currencyOptions}
              selected={draft.currencies}
              defaultCurrency={draft.currency}
              disabled={disabled}
              onChange={(currencies) => edit({ currencies })}
            />
          </div>
          <footer className="broker-metadata-footer">
            <div>
              {draft.id && (
                <button
                  type="button"
                  className="text-button danger"
                  disabled={disabled}
                  onClick={() => void prepare(true)}
                >
                  <Trash2 size={16} />
                  删除账户
                </button>
              )}
            </div>
            <div className="broker-metadata-actions">
              <button
                type="button"
                className="icon-button"
                aria-label="重新核对账户"
                disabled={busy}
                onClick={() => {
                  invalidate();
                  void load(false, true);
                }}
              >
                <RefreshCw size={17} />
              </button>
              <button
                className="button primary"
                disabled={
                  disabled || !draft.name.trim() || (!draft.id && !draft.kind)
                }
              >
                {busy ? "正在核对" : "核对变更"}
              </button>
            </div>
          </footer>
        </form>
      )}
    </div>
  );
}
function PlusMark() {
  return (
    <span className="broker-provider-add" aria-hidden="true">
      ＋
    </span>
  );
}

function BrokerCurrencyPicker({
  options,
  selected,
  defaultCurrency,
  disabled,
  onChange,
}: {
  options: string[];
  selected: string[];
  defaultCurrency: string;
  disabled: boolean;
  onChange: (value: string[]) => void;
}) {
  const id = useId(),
    menu = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const dismiss = () => menu.current?.hidePopover();
    const hide = () => {
      if (document.hidden) dismiss();
    };
    const scroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) dismiss();
    };
    if (disabled) dismiss();
    window.addEventListener("resize", dismiss);
    document.addEventListener("visibilitychange", hide);
    document.addEventListener("scroll", scroll, true);
    return () => {
      dismiss();
      window.removeEventListener("resize", dismiss);
      document.removeEventListener("visibilitychange", hide);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [disabled]);
  return (
    <fieldset className="broker-metadata-currencies" disabled={disabled}>
      <legend>可用币种</legend>
      <div className="broker-selected-currencies">
        {selected.map((currency) => (
          <button
            type="button"
            key={currency}
            className="broker-currency-chip"
            disabled={disabled || currency === defaultCurrency}
            aria-label={
              currency === defaultCurrency
                ? currency + " 默认币种"
                : "移除可用币种 " + currency
            }
            onClick={() =>
              onChange(selected.filter((value) => value !== currency))
            }
          >
            <span>{currency}</span>
            {currency !== defaultCurrency && <X size={12} aria-hidden="true" />}
          </button>
        ))}
        <button
          ref={trigger}
          type="button"
          className="broker-currency-add"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={id}
          popoverTarget={id}
        >
          <Plus size={14} aria-hidden="true" />
          添加币种
        </button>
      </div>
      <div
        id={id}
        ref={menu}
        popover="auto"
        role="dialog"
        aria-label="选择可用币种"
        className="broker-currency-popover"
        onToggle={(event) => {
          const expanded = event.newState === "open";
          setOpen(expanded);
          if (!expanded || !trigger.current) return;
          const popup = event.currentTarget,
            rect = trigger.current.getBoundingClientRect();
          popup.style.width = `${Math.min(340, window.innerWidth - 24)}px`;
          const below = window.innerHeight - rect.bottom - 20,
            above = rect.top - 20;
          const down = below >= 210 || below >= above;
          popup.style.maxHeight = `${Math.min(300, Math.max(0, down ? below : above))}px`;
          popup.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - popup.offsetWidth - 12))}px`;
          popup.style.top = `${down ? rect.bottom + 8 : Math.max(12, rect.top - popup.offsetHeight - 8)}px`;
          popup
            .querySelector<HTMLInputElement>("input:not(:disabled)")
            ?.focus({ preventScroll: true });
        }}
      >
        <div className="broker-currency-popover-heading">
          <strong>可用币种</strong>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭币种选择"
            onClick={() => {
              menu.current?.hidePopover();
              trigger.current?.focus();
            }}
          >
            <X size={15} />
          </button>
        </div>
        <div className="broker-currency-options">
          {options.map((currency) => (
            <label key={currency}>
              <input
                type="checkbox"
                checked={selected.includes(currency)}
                disabled={disabled || currency === defaultCurrency}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...selected, currency]
                      : selected.filter((value) => value !== currency),
                  )
                }
              />
              <span>{currency}</span>
            </label>
          ))}
        </div>
      </div>
    </fieldset>
  );
}
