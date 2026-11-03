import { PrivateAmount } from "./financial-display";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { Eye, EyeOff } from "lucide-react";
import { PasswordField } from "./password-fields";
import { SelectMenu } from "./select-menu";
import { requestId } from "./request-id";
import { type PreferenceCard } from "./card-preference-state";
import {
  cardDecimal,
  walletEntryAmount,
  readWalletOperation,
  releaseWalletOperation,
  retainWalletOperation,
  type WalletOperation,
} from "./card-wallet-state";

type Detail = {
  numberLast4: string | null;
  numberInitialized: boolean;
  expiryInitialized: boolean;
  cvvInitialized: boolean;
  secretState: string;
  note?: string;
  currency?: string;
  image?: string;
  initializedFields: string[];
};
type Account = {
  accountKind?:string|null;
  cardKey: string;
  amount: string | null;
  currency: string | null;
  amountKnown: boolean;
  note: string;
  opening: { amount: string | null; occurredAt: string } | null;
};
type Snapshot = {
  revision: number;
  accounts: Account[];
  details: Record<string, Detail>;
  historicalCoverageKnown: boolean;
};
type Entry = {
  id: string;
  kind: string;
  delta: string | null;
  balance: string | null;
  currency: string;
  occurredAt: string;
  note: string;
  cancelled: boolean;
};
type History = {
  cardKey: string;
  revision: number;
  items: Entry[];
  nextCursor: string | null;
};
type Effect = {
  brokerTransfer?:{accountId:string;accountKind:string;currency:string;cardDelta:string|null;cashDelta:string|null;cashRevision:number;accountRevision:number;cashBefore?:string|null;cashAfter?:string|null;cashComplete?:boolean;registeredCashBefore?:string|null;registeredCashAfter?:string|null;reversal?:boolean;[key:string]:unknown}|null;
  operation: string;
  cardKey: string;
  source: string;
  before: { amount: string | null; currency: string | null };
  after: { amount: string | null; currency: string | null };
  delta: string | null;
  needsNegativeConfirmation: boolean;
  historyEffects: unknown[];
  recordedEntry?: {
    id: string;
    kind: string;
    amount: string;
    currency: string;
    occurredAt: string;
  } | null;
  removedEntry?: {
    id: string;
    kind: string;
    amount: string;
    currency: string;
    occurredAt: string;
  } | null;
};
type Receipt = {
  requestId: string;
  state: "completed" | "closed";
  executed?: boolean;
  revision?: number;
  effects?: Effect;
  secretValuesIncluded?: boolean;
};
type BrokerAccount={id:string;name:string;account_kind:string;holding_source:string;revision:number};
type BrokerCash={accountId:string;revision:number;currencies:{currency:string;balance:string|null;registeredBalance:string|null;complete:boolean;ownerCashComplete:boolean}[]};
type Draft = {
  fundAccount?:string;brokerAccountId?:string;brokerAcknowledged?:boolean;
  operation: string;
  amount: string;
  currency?: string;
  note: string;
  when: string;
  allowNegativeBalance: boolean;
  entryId?: string;
};
type Preview = {
  data: Record<string, unknown>;
  token: string;
  effects: Effect;
  epoch: number;
  expiresAt: string;
  preferenceRevision: number;
};
type Disclosure = {
  cardKey: string;
  number: string;
  expiry: string;
  cvv: string;
  initializedFields: string[];
};
type Props = {
  session: Session;
  active?: boolean;
  cards: readonly PreferenceCard[];
  revisionHint: number;
  onChanged?: () => void;
  onPermissionError?: (failure: unknown) => void;
};
const root = "/account/card-wallet";
const blank: Draft = {
  operation: "set_amount",
  amount: "",
  note: "",
  when: "",
  allowNegativeBalance: false,
};
const operations = [
  { value: "set_amount", label: "核对金额" },
  { value: "deposit", label: "存入" },
  { value: "withdraw", label: "取出" },
  { value: "adjust", label: "调整余额" },
  { value: "clear_amount", label: "清除当前金额" },
  { value: "delete_entry", label: "撤销流水" },
];
export function CardWalletPanel(props: Props) {
  const session = props.session;
  return (
    <CardWalletContent
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
function PrivateCardInput({
  id,
  label,
  value,
  active,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  active: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!value || !active) setShown(false);
  }, [value, active]);
  useEffect(() => {
    const conceal = () => {
      if (document.hidden) setShown(false);
    };
    document.addEventListener("visibilitychange", conceal);
    return () => document.removeEventListener("visibilitychange", conceal);
  }, []);
  return (
    <div className="password-field">
      <input
        id={id}
        aria-label={label}
        type={active && shown ? "text" : "password"}
        value={value}
        autoComplete="off"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        aria-label={`${shown ? "隐藏" : "显示"}${label}`}
        aria-controls={id}
        aria-pressed={shown}
        onClick={() => setShown((previous) => !previous)}
      >
        {shown ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

function CardWalletContent({
  session,
  active = true,
  cards,
  revisionHint,
  onChanged,
  onPermissionError,
}: Props) {
  const scope = JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
  ]);
  const context = useRef(scope),
    visible = useRef(active),
    readEpoch = useRef(0),
    draftEpoch = useRef(0),
    secretEpoch = useRef(0),
    preferenceVersion = useRef(revisionHint),
    negativeConsent = useRef(-1);
  context.current = scope;
  if (visible.current !== active) {
    visible.current = active;
    readEpoch.current += 1;
    draftEpoch.current += 1;
    secretEpoch.current += 1;
  }
  const preferenceChanged = preferenceVersion.current !== revisionHint;
  if (preferenceChanged) {
    preferenceVersion.current = revisionHint;
  }
  const [selected, setSelected] = useState("");
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [query, setQuery] = useState("");
  const [snapshot, setSnapshot] = useState<{
    key: string;
    data: Snapshot;
  } | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  if (preferenceChanged && preview && preview.preferenceRevision < revisionHint)
    draftEpoch.current += 1;
  const [pending, setPending] = useState<WalletOperation | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [brokers,setBrokers]=useState<BrokerAccount[]|null>(null);
  const [brokerCash,setBrokerCash]=useState<{broker:BrokerAccount;cash:BrokerCash;key:string}|null>(null);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [detailDraft, setDetailDraft] = useState<Record<string, string>>({});
  const [disclosure, setDisclosure] = useState<{
    value: Disclosure;
    epoch: number;
  } | null>(null);
  const privateContext = useRef("");
  const [verifyRequired, setVerifyRequired] = useState(false),
    [password, setPassword] = useState(""),
    [code, setCode] = useState("");
  const callbacks = useRef({ onChanged, onPermissionError });
  callbacks.current = { onChanged, onPermissionError };
  const report = useCallback((failure: unknown) => {
    if (!context.current) return;
    setError(failure instanceof Error ? failure.message : "卡包记录未完成");
    if (failure instanceof ApiError && [401, 403].includes(failure.status)) {
      readEpoch.current += 1;
      draftEpoch.current += 1;
      secretEpoch.current += 1;
      setSnapshot(null);
      setHistory(null);
      setDrafts({});
      setBrokers(null);setBrokerCash(null);
      setDetailDraft({});
      setDisclosure(null);
      setPassword("");
      setCode("");
      setPreview(null);
      callbacks.current.onPermissionError?.(failure);
    }
  }, []);
  useEffect(() => {
    context.current = scope;
    try {
      setPending(readWalletOperation(sessionStorage, scope));
    } catch (failure) {
      report(failure);
    }
    return () => {
      context.current = "";
      readEpoch.current += 1;
      draftEpoch.current += 1;
      secretEpoch.current += 1;
    };
  }, [scope, report]);
  useEffect(() => {
    if (!selected && cards.length) setSelected(cards[0].key);
  }, [selected, cards]);
  const refresh = useCallback(async () => {
    const key = selectedRef.current,
      mine = ++readEpoch.current,
      owner = context.current;
    if (!key || !visible.current || !owner) return;
    const data = await api<Snapshot>(
      root + "?cardKey=" + encodeURIComponent(key),
    );
    if (
      mine !== readEpoch.current ||
      key !== selectedRef.current ||
      owner !== context.current ||
      !visible.current
    )
      return;
    setSnapshot({ key, data });
    const rows = await api<History>(
      root +
        "/history?cardKey=" +
        encodeURIComponent(key) +
        "&revision=" +
        data.revision +
        "&includeDeleted=" +
        String(includeDeleted),
    );
    if (
      mine === readEpoch.current &&
      key === selectedRef.current &&
      owner === context.current &&
      visible.current
    )
      setHistory({ ...rows, cardKey: key });
  }, [includeDeleted]);
  useEffect(() => {
    draftEpoch.current += 1;
    secretEpoch.current += 1;
    setPreview(null);
    setDisclosure(null);
    setPassword("");
    setCode("");
    setVerifyRequired(false);
    const privateKey = selected;
    if (privateContext.current !== privateKey) {
      privateContext.current = privateKey;
      setDetailDraft({});
    }
    setHistory(null);
    setBrokerCash(null);
    if (!active || !selected) return;
    let valid = true;
    void refresh().catch((failure) => {
      if (valid) report(failure);
    });
    return () => {
      valid = false;
      readEpoch.current += 1;
      draftEpoch.current += 1;
      secretEpoch.current += 1;
    };
  }, [active, selected, refresh, report]);
  const refreshCallback = useRef(refresh);
  refreshCallback.current = refresh;
  useEffect(() => {
    if (visible.current && selectedRef.current)
      void refreshCallback.current().catch(report);
  }, [revisionHint, report]);
  useEffect(() => {
    const conceal = () => {
      if (document.hidden) {
        secretEpoch.current += 1;
        draftEpoch.current += 1;
        setDisclosure(null);
        setBrokerCash(null);
        setPreview(null);
        setPassword("");
        setCode("");
      }
    };
    document.addEventListener("visibilitychange", conceal);
    return () => document.removeEventListener("visibilitychange", conceal);
  }, []);
  useEffect(() => {
    if (!disclosure) return;
    const timer = window.setTimeout(() => {
      secretEpoch.current += 1;
      setDisclosure(null);
    }, 30000);
    return () => window.clearTimeout(timer);
  }, [disclosure]);
  const data = snapshot?.key === selected ? snapshot.data : null;
  const displayedHistory = history?.cardKey === selected ? history : null;
  const account = data?.accounts.find((item) => item.cardKey === selected);
  const detail = data?.details[selected];
  const draft = drafts[selected] ?? blank;
  const currency = draft.currency ?? account?.currency ?? "";
  const available = cards.some((card) => card.key === selected);
  const currentPreview =
    active &&
    preview?.epoch === draftEpoch.current &&
    preview.data.cardKey === selected &&
    preview.data.expectedRevision === data?.revision
      ? preview
      : null;
  const choices = cards
    .filter((card) =>
      card.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    )
    .slice(0, 200)
    .map((card) => ({ value: card.key, label: card.label }));
  const chosen = cards.find((card) => card.key === selected);
  if (chosen && !choices.some((item) => item.value === selected))
    choices.unshift({ value: selected, label: chosen.label });
  if (selected && !available)
    choices.unshift({ value: selected, label: "原卡面来源已变化" });
  function edit(value: Partial<Draft>) {
    draftEpoch.current += 1;
    if (value.allowNegativeBalance === true)
      negativeConsent.current = draftEpoch.current;
    setPreview(null);
    setDrafts((previous) => ({
      ...previous,
      [selected]: { ...(previous[selected] ?? blank), brokerAcknowledged:false, ...value },
    }));
  }
  async function readBrokerDirectory(){if(busy||pending||!active||document.hidden)return;const owner=context.current,mine=draftEpoch.current;setBusy(true);setError("");try{const result=await api<{items:BrokerAccount[]}>("/broker-accounts");if(context.current===owner&&visible.current&&mine===draftEpoch.current)setBrokers(result.items);}catch(failure){if(context.current===owner&&visible.current&&mine===draftEpoch.current&&!document.hidden)report(failure);}finally{if(context.current===owner)setBusy(false);}}
  async function readBrokerCash(){const id=draft.brokerAccountId,broker=brokers?.find(item=>item.id===id);if(!id||!broker||busy||pending||!active||document.hidden)return;edit({});setBrokerCash(null);const owner=context.current,mine=draftEpoch.current,key=selected;setBusy(true);setError("");try{const value=await api<BrokerCash>("/cash/accounts/"+encodeURIComponent(id));if(context.current===owner&&visible.current&&mine===draftEpoch.current&&selectedRef.current===key){if(value.accountId!==id)throw new Error("券商资金归属待核对");setBrokerCash({broker,cash:value,key});}}catch(failure){if(context.current===owner&&visible.current&&mine===draftEpoch.current&&selectedRef.current===key&&!document.hidden)report(failure);}finally{if(context.current===owner)setBusy(false);}}
  async function makePreview(override: Partial<Draft> = {}) {
    if (!data || busy || pending || !available) return;
    const mine = draftEpoch.current,
      owner = scope,
      currentDraft = { ...draft, ...override };
    setBusy(true);
    setPreview(null);
    setError("");
    setMessage("");
    try {
      const command: Record<string, unknown> = {
        requestId: requestId(),
        expectedRevision: data.revision,
        operation: currentDraft.operation,
        cardKey: selected,
        currency: (currentDraft.currency ?? account?.currency) || null,
        note: currentDraft.note,
        occurredAt: currentDraft.when
          ? new Date(currentDraft.when).toISOString()
          : new Date().toISOString(),
        allowNegativeBalance:
          currentDraft.allowNegativeBalance && negativeConsent.current === mine,
      };
      if(currentDraft.fundAccount==="broker"&&["deposit","withdraw"].includes(currentDraft.operation)){
        const broker=brokerCash?.broker;if(!brokerCash||!broker||brokerCash.key!==selected||broker.id!==currentDraft.brokerAccountId||!["real","simulated"].includes(broker.account_kind)||!currentDraft.brokerAcknowledged)throw new Error("请明确选择券商并读取当前资金版本，再确认本次联动");
        Object.assign(command,{fundAccount:"broker",accountId:broker.id,accountKind:broker.account_kind,accountRevision:broker.revision,cashRevision:brokerCash.cash.revision});
      }
      if (
        ["set_amount", "deposit", "withdraw", "adjust"].includes(
          currentDraft.operation,
        )
      )
        command.amount = currentDraft.amount;
      if (currentDraft.operation === "delete_entry")
        command.entryId = currentDraft.entryId;
      const response = await api<{
        requestId: string;
        revision: number;
        preview: string;
        expiresAt: string;
        effects: Effect;
        preferenceRevision: number;
      }>(
        root + "/preview",
        { method: "POST", body: JSON.stringify(command) },
        session.csrf,
      );
      if (
        response.requestId !== command.requestId ||
        response.revision !== data.revision ||
        response.effects.cardKey !== selected ||
        response.effects.source !== "platform-manual-card" ||
        !Number.isFinite(Date.parse(response.expiresAt))
      )
        throw new Error("卡包预览的来源或修订不匹配");
      if (
        owner === context.current &&
        mine === draftEpoch.current &&
        visible.current &&
        response.preferenceRevision >= preferenceVersion.current
      )
        setPreview({
          data: command,
          token: response.preview,
          effects: response.effects,
          epoch: mine,
          expiresAt: response.expiresAt,
          preferenceRevision: response.preferenceRevision,
        });
    } catch (failure) {
      if (owner === context.current && mine === draftEpoch.current)
        report(failure);
    } finally {
      if (owner === context.current) setBusy(false);
    }
  }
  function validate(result: Receipt, operation: WalletOperation) {
    if (result.requestId !== operation.requestId)
      throw new Error("原卡包回执不匹配");
    if (result.state === "closed" && result.executed === false) return;
    if (
      result.state !== "completed" ||
      (operation.kind === "financial"
        ? result.effects?.source !== "platform-manual-card"
        : result.secretValuesIncluded !== false)
    )
      throw new Error("原卡包回执尚未核对");
  }
  async function finish(result: Receipt, operation: WalletOperation) {
    validate(result, operation);
    releaseWalletOperation(sessionStorage, scope, operation.requestId);
    setPending(null);
    setPreview(null);
    draftEpoch.current += 1;
    setMessage(
      result.state === "closed"
        ? "原请求已关闭，未执行"
        : operation.kind === "financial"
          ? "卡包记录已保存"
          : "卡背信息已保存",
    );
    if (result.state === "completed" && operation.kind === "details")
      setDetailDraft({});
    await refresh();
    callbacks.current.onChanged?.();
  }
  async function submit(kind: WalletOperation["kind"]) {
    if (
      busy ||
      pending ||
      !data ||
      !available ||
      (kind === "financial" && !currentPreview)
    )
      return;
    if (
      kind === "financial" &&
      Date.parse(currentPreview!.expiresAt) <= Date.now()
    ) {
      draftEpoch.current += 1;
      setPreview(null);
      setError("预览已过期，请重新预览");
      return;
    }
    const operation = {
        requestId:
          kind === "financial"
            ? (currentPreview!.data.requestId as string)
            : requestId(),
        kind,
      },
      owner = scope;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      retainWalletOperation(sessionStorage, scope, operation);
      setPending(operation);
      const result = await api<Receipt>(
        root + (kind === "financial" ? "/operations" : "/details"),
        {
          method: kind === "financial" ? "POST" : "PATCH",
          body: JSON.stringify(
            kind === "financial"
              ? { data: currentPreview!.data, preview: currentPreview!.token }
              : {
                  requestId: operation.requestId,
                  expectedRevision: data.revision,
                  cardKey: selected,
                  changes: detailDraft,
                },
          ),
        },
        session.csrf,
      );
      if (owner === context.current) await finish(result, operation);
    } catch (failure) {
      if (owner !== context.current) return;
      setPreview(null);
      draftEpoch.current += 1;
      if (
        failure instanceof ApiError &&
        [400, 401, 403, 404, 405, 413, 415, 422, 428, 429].includes(
          failure.status,
        )
      ) {
        try {
          releaseWalletOperation(sessionStorage, scope, operation.requestId);
          setPending(null);
        } catch {
          /* The original UUID stays authoritative. */
        }
      }
      report(failure);
    } finally {
      if (owner === context.current) setBusy(false);
    }
  }
  async function original(close = false) {
    if (!pending || busy) return;
    const operation = pending,
      owner = scope;
    setBusy(true);
    setError("");
    try {
      const result = await api<Receipt>(
        root + "/operations/" + operation.requestId + (close ? "/close" : ""),
        close ? { method: "POST", body: "{}" } : {},
        close ? session.csrf : undefined,
      );
      if (owner === context.current) await finish(result, operation);
    } catch (failure) {
      if (owner === context.current) report(failure);
    } finally {
      if (owner === context.current) setBusy(false);
    }
  }
  async function reveal() {
    if (!selected || busy) return;
    const mine = ++secretEpoch.current,
      owner = scope,
      key = selected,
      credentials = { password, code };
    setPassword("");
    setCode("");
    setDisclosure(null);
    setBusy(true);
    setError("");
    try {
      const result = await api<Disclosure>(
        root + "/details/reveal",
        {
          method: "POST",
          body: JSON.stringify({ cardKey: key, reveal: true, ...credentials }),
        },
        session.csrf,
      );
      if (
        owner === context.current &&
        key === selectedRef.current &&
        mine === secretEpoch.current &&
        visible.current &&
        !document.hidden
      ) {
        setDisclosure({ value: result, epoch: mine });
        setVerifyRequired(false);
      }
    } catch (failure) {
      if (owner !== context.current) return;
      if (
        failure instanceof ApiError &&
        failure.status === 403 &&
        (failure.code === "reauth_required" || verifyRequired)
      ) {
        setVerifyRequired(true);
        setError(failure.message);
      } else report(failure);
    } finally {
      if (owner === context.current) setBusy(false);
    }
  }
  async function more() {
    if (!history?.nextCursor || history.cardKey !== selected || !data || busy)
      return;
    const mine = ++readEpoch.current,
      owner = scope,
      key = selected;
    setBusy(true);
    setError("");
    try {
      const next = await api<History>(
        root +
          "/history?cardKey=" +
          encodeURIComponent(key) +
          "&after=" +
          history.nextCursor +
          "&revision=" +
          data.revision +
          "&includeDeleted=" +
          String(includeDeleted),
      );
      if (
        mine === readEpoch.current &&
        owner === context.current &&
        key === selectedRef.current
      )
        setHistory((previous) =>
          previous
            ? {
                ...next,
                cardKey: key,
                items: [...previous.items, ...next.items],
              }
            : next,
        );
    } catch (failure) {
      if (owner === context.current) {
        setHistory(null);
        report(failure);
      }
    } finally {
      if (owner === context.current) setBusy(false);
    }
  }
  const disabled = busy || pending !== null || !data || !available;
  const shown =
    active &&
    disclosure?.epoch === secretEpoch.current &&
    disclosure.value.cardKey === selected
      ? disclosure.value
      : null;
  return (
    <article className="card-catalog-panel" aria-label="卡包金额记录">
      <header className="card-catalog-heading">
        <h2>金额记录</h2>
        <button
          className="button secondary"
          disabled={busy || !selected}
          onClick={() => {
            draftEpoch.current += 1;
            setPreview(null);
            void refresh().catch(report);
          }}
        >
          刷新
        </button>
      </header>
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
      {cards.length ? (
        <>
          <label>
            筛选卡面
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <SelectMenu
            label="金额卡面"
            value={selected}
            options={choices}
            onChange={(value) => {
              draftEpoch.current += 1;
              secretEpoch.current += 1;
              setSelected(value);
              setPreview(null);
              setDisclosure(null);
            }}
            disabled={busy}
            variant="field"
          />
          <p>
            <PrivateAmount>{account?.amountKnown
              ? `手动记录 · ${cardDecimal(account.amount)} ${account.currency ?? "币种未核对"}`
              : data
                ? "金额未登记"
                : "正在核对金额"}</PrivateAmount>
          </p>
          <form
            className="card-catalog-form"
            onSubmit={(event) => {
              event.preventDefault();
              void makePreview();
            }}
          >
            <label>
              操作
              <SelectMenu
                label="金额操作"
                value={draft.operation}
                options={operations}
                onChange={(value) => edit({ operation: value })}
                disabled={disabled}
                variant="field"
              />
            </label>
            <label>
              币种
              <input
                value={currency}
                maxLength={3}
                onChange={(event) =>
                  edit({ currency: event.target.value.toUpperCase() })
                }
                disabled={disabled}
              />
            </label>
            {["set_amount", "deposit", "withdraw", "adjust"].includes(
              draft.operation,
            ) && (
              <label>
                {draft.operation === "adjust" ? "调整后金额" : "金额"}
                <input
                  value={draft.amount}
                  inputMode="decimal"
                  required
                  disabled={disabled}
                  onChange={(event) => edit({ amount: event.target.value })}
                />
              </label>
            )}
            <label>
              发生时间
              <input
                type="datetime-local"
                value={draft.when}
                disabled={disabled}
                onChange={(event) => edit({ when: event.target.value })}
              />
            </label>
            {["deposit","withdraw"].includes(draft.operation)&&<fieldset disabled={disabled}><legend>本次资金来源 / 去向</legend><label>登记范围<SelectMenu label="资金登记范围" variant="field" value={draft.fundAccount||"none"} options={[{value:"none",label:"独立卡包登记（不影响券商资金）"},{value:"broker",label:"明确关联本人券商内部账本"}]} onChange={value=>{edit({fundAccount:value});setBrokerCash(null);}}/></label>{draft.fundAccount==="broker"&&<><button type="button" onClick={()=>void readBrokerDirectory()}>读取本人券商账户</button><label>明确券商账户<SelectMenu label="明确券商账户" variant="field" value={draft.brokerAccountId||""} options={[{value:"",label:"选择账户（不默认首个）"},...(brokers||[]).filter(item=>item.holding_source==="manual"&&["real","simulated"].includes(item.account_kind)).map(item=>({value:item.id,label:`${item.name} · ${item.account_kind==="real"?"真实":"模拟"} · ${item.id}`}))]} onChange={value=>{edit({brokerAccountId:value});setBrokerCash(null);}}/></label><button type="button" disabled={!draft.brokerAccountId} onClick={()=>void readBrokerCash()}>读取该账户资金版本</button>{brokerCash?.key===selected&&brokerCash.broker.id===draft.brokerAccountId&&<p>{brokerCash.broker.name} · {brokerCash.broker.account_kind==="real"?"真实":"模拟"} · 内部账本 {currency||"币种未核对"} 余额 {cardDecimal(brokerCash.cash.currencies.find(item=>item.currency===currency)?.balance??null)} · 资金版本 {brokerCash.cash.revision}</p>}<label><input type="checkbox" checked={draft.brokerAcknowledged===true} onChange={event=>edit({brokerAcknowledged:event.target.checked})}/>确认{draft.operation==="deposit"?"卡包存入对应所选券商资金外流":"卡包取出对应所选券商资金流入"}，同原币与同账本类型核对后一次登记，不发送券商资金指令</label></>}</fieldset>}
            <label>
              备注
              <input
                value={draft.note}
                maxLength={500}
                disabled={disabled}
                onChange={(event) => edit({ note: event.target.value })}
              />
            </label>
            <div className="card-catalog-actions">
              <button
                type="submit"
                className="button secondary"
                disabled={
                  disabled ||
                  (draft.operation === "delete_entry" && !draft.entryId)
                }
              >
                预览
              </button>
            </div>
          </form>
          {currentPreview && (
            <div className="card-wallet-preview">
              <dl>
                <dt>操作</dt>
                <dd>
                  {operations.find(
                    (item) => item.value === currentPreview.effects.operation,
                  )?.label ?? currentPreview.effects.operation}
                </dd>
                <dt>原金额</dt>
                <dd>
                  {cardDecimal(currentPreview.effects.before.amount)}{" "}
                  {currentPreview.effects.before.currency ?? "币种未核对"}
                </dd>
                <dt>确认后金额</dt>
                <dd>
                  {cardDecimal(currentPreview.effects.after.amount)}{" "}
                  {currentPreview.effects.after.currency ?? "币种未核对"}
                </dd>
                {currentPreview.effects.recordedEntry && (
                  <>
                    <dt>记入流水</dt>
                    <dd>
                      {walletEntryAmount(
                        currentPreview.effects.recordedEntry.kind,
                        currentPreview.effects.recordedEntry.amount,
                        currentPreview.effects.recordedEntry.currency,
                      )}{" "}
                      ·{" "}
                      {new Date(
                        currentPreview.effects.recordedEntry.occurredAt,
                      ).toLocaleString()}
                    </dd>
                  </>
                )}
                {currentPreview.effects.removedEntry && (
                  <>
                    <dt>撤销原流水</dt>
                    <dd>
                      {walletEntryAmount(
                        currentPreview.effects.removedEntry.kind,
                        currentPreview.effects.removedEntry.amount,
                        currentPreview.effects.removedEntry.currency,
                      )}{" "}
                      ·{" "}
                      {new Date(
                        currentPreview.effects.removedEntry.occurredAt,
                      ).toLocaleString()}
                    </dd>
                  </>
                )}
                {currentPreview.effects.brokerTransfer&&<><dt>同事务券商资金</dt><dd>{currentPreview.effects.brokerTransfer.accountId} · {currentPreview.effects.brokerTransfer.accountKind==="real"?"真实":currentPreview.effects.brokerTransfer.accountKind==="simulated"?"模拟":"类型未核对"} · {currentPreview.effects.brokerTransfer.currency}</dd><dt>卡包差额 / 券商差额</dt><dd>{cardDecimal(currentPreview.effects.brokerTransfer.cardDelta)} / {cardDecimal(currentPreview.effects.brokerTransfer.cashDelta)}</dd><dt>券商原余额 / 变更后</dt><dd>{cardDecimal(currentPreview.effects.brokerTransfer.cashBefore??null)} / {cardDecimal(currentPreview.effects.brokerTransfer.cashAfter??null)}</dd>{currentPreview.effects.brokerTransfer.cashComplete===false&&<><dt>已登记现金小计（不代表已核实实际余额）</dt><dd>{cardDecimal(currentPreview.effects.brokerTransfer.registeredCashBefore??null)} / {cardDecimal(currentPreview.effects.brokerTransfer.registeredCashAfter??null)}</dd></>}<dt>券商资金凭证</dt><dd><details><summary>原币与原账户回执依据</summary><pre>{JSON.stringify(currentPreview.effects.brokerTransfer,null,2)}</pre></details></dd></>}
                <dt>核对流水</dt>
                <dd>{currentPreview.effects.historyEffects.length} 条</dd>
                <dt>变动</dt>
                <dd>{cardDecimal(currentPreview.effects.delta)}</dd>
              </dl>
              {currentPreview.effects.needsNegativeConfirmation &&
              currentPreview.data.allowNegativeBalance !== true ? (
                <label className="card-wallet-check">
                  <input
                    type="checkbox"
                    onChange={(event) =>
                      edit({ allowNegativeBalance: event.target.checked })
                    }
                  />
                  我已核对负余额
                </label>
              ) : (
                <button
                  className="button primary"
                  disabled={disabled}
                  onClick={() => void submit("financial")}
                >
                  确认保存
                </button>
              )}
            </div>
          )}
          <details
            onToggle={(event) => {
              if (!(event.target as HTMLDetailsElement).open) {
                secretEpoch.current += 1;
                setDisclosure(null);
                setPassword("");
                setCode("");
              }
            }}
          >
            <summary>卡背信息</summary>
            {detail?.secretState === "unavailable" && (
              <p role="status">卡背信息暂不可读取</p>
            )}
            <p>
              {detail?.numberLast4
                ? `卡号尾号 ${detail.numberLast4}`
                : detail?.numberInitialized
                  ? "卡号已清空或暂不可读取"
                  : "卡号未登记"}
            </p>
            <div className="card-catalog-form">
              {(
                [
                  ["number", "卡号"],
                  ["expiry", "有效期"],
                  ["cvv", "安全码"],
                ] as const
              ).map(([field, label]) => (
                <label key={field}>
                  {label}
                  <PrivateCardInput
                    key={field + ":" + secretEpoch.current}
                    id={"card-wallet-" + field}
                    label={label}
                    value={detailDraft[field] ?? ""}
                    active={active}
                    disabled={disabled}
                    onChange={(value) => {
                      draftEpoch.current += 1;
                      setPreview(null);
                      setDetailDraft((previous) => ({
                        ...previous,
                        [field]: value,
                      }));
                    }}
                  />
                </label>
              ))}
              <label>
                卡片备注
                <input
                  value={detailDraft.note ?? detail?.note ?? ""}
                  maxLength={60}
                  disabled={disabled}
                  onChange={(event) =>
                    setDetailDraft((previous) => ({
                      ...previous,
                      note: event.target.value,
                    }))
                  }
                />
              </label>
              <div className="card-catalog-actions">
                <button
                  className="button secondary"
                  disabled={disabled || !Object.keys(detailDraft).length}
                  onClick={() => void submit("details")}
                >
                  保存卡背信息
                </button>
                <button
                  className="button secondary"
                  disabled={
                    busy || !detail || detail.secretState === "unavailable"
                  }
                  onClick={() => void reveal()}
                >
                  显示卡背信息
                </button>
              </div>
            </div>
            {verifyRequired && (
              <form
                className="card-catalog-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void reveal();
                }}
              >
                <label>
                  当前密码
                  <PasswordField
                    id="card-wallet-password"
                    value={password}
                    autoComplete="current-password"
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                <label>
                  二次验证码或备用码
                  <input
                    value={code}
                    autoComplete="one-time-code"
                    onChange={(event) => setCode(event.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  className="button secondary"
                  disabled={busy || !password}
                >
                  验证并显示
                </button>
              </form>
            )}
            {shown && (
              <dl>
                <dt>卡号</dt>
                <dd>{shown.number || "未登记"}</dd>
                <dt>有效期</dt>
                <dd>{shown.expiry || "未登记"}</dd>
                <dt>安全码</dt>
                <dd>{shown.cvv || "未登记"}</dd>
                <button
                  className="button secondary"
                  onClick={() => {
                    secretEpoch.current += 1;
                    setDisclosure(null);
                  }}
                >
                  隐藏
                </button>
              </dl>
            )}
          </details>
          <div className="card-catalog-heading">
            <h3>已登记流水</h3>
            <label className="card-wallet-check">
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(event) => setIncludeDeleted(event.target.checked)}
              />
              包含撤销
            </label>
          </div>
          {data?.historicalCoverageKnown === false && (
            <p role="status">历史覆盖未核对</p>
          )}
          <div className="card-catalog-list">
            {displayedHistory?.items.map((entry) => (
              <div className="card-catalog-row" key={entry.id}>
                <div>
                  <strong>
                    {entry.kind === "deposit"
                      ? "存入"
                      : entry.kind === "withdraw"
                        ? "取出"
                        : "余额调整"}
                    {entry.cancelled ? " · 已撤销" : ""}
                  </strong>
                  <div>
                    <PrivateAmount>{cardDecimal(entry.delta)} · {cardDecimal(entry.balance)}</PrivateAmount>{" "}
                    {entry.currency}
                  </div>
                  <div>
                    {new Date(entry.occurredAt).toLocaleString()}
                    {entry.note ? ` · ${entry.note}` : ""}
                  </div>
                </div>
                {!entry.cancelled && (
                  <button
                    className="button secondary"
                    disabled={disabled}
                    onClick={() => {
                      const changes = {
                        operation: "delete_entry",
                        entryId: entry.id,
                        currency: entry.currency,
                      };
                      edit(changes);
                      void makePreview(changes);
                    }}
                  >
                    预览撤销
                  </button>
                )}
              </div>
            ))}
          </div>
          {displayedHistory?.nextCursor && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void more()}
            >
              更多
            </button>
          )}
        </>
      ) : (
        <p>尚无可选卡面</p>
      )}
    </article>
  );
}
