import {FeeRuleOriginalEditor,type FeeRuleOriginal} from "./fee-rule-original";
import {FeeSourceAttributionPanel} from "./fee-source-attribution";
import {
  nativeActualFeeCommand,
  type NativeActualFeeSnapshot,
} from "./native-actual-fee-state";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, ApiError, type Session } from "./api";
import { requestId } from "./request-id";
import {
  operationPath,
  restoreOperation,
  saveOperation,
  updateOperation,
  type PendingOperation,
} from "./operation-journal";
import {
  submissionDisposition,
  mayReleaseMissingReceipt,
} from "./portfolio-operation";
import "./portfolio.css";
import "./fees.css";
import { BaselineFeeFields } from "./fee-baseline-fields";
import {
  baselineSource,
  baselineCommand,
  estimateBaselineCommand,
  emptyBaselineDraft,
  type BaselineSource,
  type BaselineDraft,
  type EstimateHead,
  type RawFinancialSnapshot,
} from "./fee-baseline-state";
import { ActualFeeFields } from "./actual-fee-fields";
import {
  actualFeeCommand,
  emptyActualFeeDraft,
  type ActualFeeDraft,
  type ActualFeeSnapshot,
} from "./actual-fee-state";
type Broker = {
  id: string;
  name: string;
  provider_id: string | null;
  holding_source: string;
  account_kind: string;
};
type Item = {
  orderId: string;
  recordId: string;
  code: string | null;
  market: string | null;
  qty: string | null;
  fees: string | null;
  registeredFees?: string;
  actualFeeKnown?: boolean;
  status?: string;
  revision: number;
  recordRevision: number | null;
  exclusion: string | null;
  manualReviewRequired: boolean;
};
type Snapshot = {
  accountId: string;
  brokerAccountId: string;
  providerId: string | null;
  brokerRevision: number;
  snapshotRevision: string;
  ruleVersion: string;
  items: Item[];
  ordersComplete: boolean;
  unassignedOrderIds: string[] | null;
  legacyCoverage: {
    status: "complete" | "partial" | "unavailable";
    revision: number | null;
    sourceDigest: string | null;
    unmappedOrderIds: string[] | null;
  };
  unassignedOrders:
    | {
        orderId: string;
        feeAuthority: string;
        input: {
          code: string | null;
          quantity: string | null;
          fees: string | null;
          currency: string | null;
        };
      }[]
    | null;
  sourceAttributions: {
    orderId: string;
    requestId: string;
    financialApplied: false;
  }[];
};
type Plan = {
  id: string;
  revision: number;
  current_revision: number;
  effective_from: string;
  effective_through: string|null;
  market?:string|null;
  legacy_original_base64?:string|null;
  retired_at?:string|null;
  components: Record<
    string,
    { basis: string; rate?: string; minimum?: string; [key: string]: unknown }
  >;
};
type Selection = {
  orderId: string;
  revision: number;
  recordRevision: number;
  instrumentKind: string;
  wholeOrderConfirmed: boolean;
  brokerOwnershipConfirmed: boolean;
  legacyImportConfirmed?: true;
};
type Proof = {
  ready?: boolean;
  estimatedFees?: null;
  records?: {
    recordId: string;
    registered: { quantity: string; registeredCost: string | null };
    actualCost: null;
    actualRealizedPnl: null;
    estimatedFees: null;
  }[];
  assessments?: {
    recordId: string;
    orders: Record<string, { fee: string }>;
    estimated: { cost: string | null; accountCashAfter: string | null };
    actual: {
      feesKnown: boolean;
      cost: string | null;
      cashBalance: string | null;
    };
  }[];
  authority?: string;
  actualFeeKnown?: boolean;
  financialApplied?: boolean;
  brokerAccountId?: string;
  manifestId?: string;
  positionEffects?: {
    recordId: string;
    beforeCost: string | null;
    afterCost: string | null;
    actualAfterCost?: string | null;
  }[];
  sourceAccount?: { name: string; accountKind: string };
  data?: {
    effectiveFrom: string;
    effectiveThrough: string|null;
    market?:string;
    legacyOriginal?:string|null;
    components: Plan["components"];
  };
  preview?: string;
  previewRevision?: string;
  expiresAt?: string;
  canSubmit?: boolean;
  candidates?: {
    orderId: string;
    originalOrderId?: string;
    authority?: string;
    oldFees: string;
    newFees: string;
    currency: string;
  }[];
  excluded?: { orderId: string; reason: string }[];
  cashEffect?: {
    before: string | null;
    after: string | null;
    delta: string;
    currency: string;
    brokerBefore?: string | null;
    brokerAfter?: string | null;
  } | null;
};
export function FeesPage({
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
    <FeeSession key={JSON.stringify([scope,session.csrf,session.expires_at])} session={session} scope={scope} active={active} />
  );
}
function FeeSession({
  session,
  scope,
  active,
}: {
  session: Session;
  scope: string;
  active: boolean;
}) {
  const [visible, setVisible] = useState(!document.hidden),
    [brokers, setBrokers] = useState<Broker[]>([]),
    [account, setAccount] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [market,setMarket]=useState("");
  const [original,setOriginal]=useState<FeeRuleOriginal|null>(null);
  const [viewOriginal,setViewOriginal]=useState<string|null>(null);
  const [selectedPlan, setSelectedPlan] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [selection, setSelection] = useState<Record<string, Selection>>({});
  const [from, setFrom] = useState(""),
    [through, setThrough] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [includes, setIncludes] = useState(false);
  const [proof, setProof] = useState<Proof | null>(null),
    [pending, setPending] = useState<PendingOperation | null>(null),
    [error, setError] = useState(""),
    [result, setResult] = useState<string>(""),
    [busy, setBusy] = useState(false),
    [locked, setLocked] = useState(false);
  const [receiptId, setReceiptId] = useState("");
  const [receiptKind, setReceiptKind] = useState<PendingOperation["kind"]>(
    "native_fee_confirmation",
  );
  const [lookedUpReceipt, setLookedUpReceipt] = useState<{
    id: string;
    state: string;
    message?: string;
  } | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const receiptReads = useRef(0);
  const [ruleKind, setRuleKind] = useState("commission"),
    [basis, setBasis] = useState("share"),
    [rate, setRate] = useState(""),
    [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const [maximumPercent, setMaximumPercent] = useState("");
  const [minimumWins, setMinimumWins] = useState(true);
  const [side, setSide] = useState("both");
  const epoch = useRef(0),
    live = useRef(active && visible),
    proofBody = useRef<Record<string, unknown> | null>(null),
    kind = useRef<
      | "fee_plan"
      | "fee_repair"
      | "fee_confirmation"
      | "native_fee_confirmation"
      | "fee_estimate"
      | "fee_baseline"
    >("fee_repair");
  const [actualSnapshot, setActualSnapshot] =
    useState<ActualFeeSnapshot | null>(null);
  const [nativeSnapshot, setNativeSnapshot] =
    useState<NativeActualFeeSnapshot | null>(null);
  const [nativeSelected, setNativeSelected] = useState("");
  const [nativeDraft, setNativeDraft] =
    useState<ActualFeeDraft>(emptyActualFeeDraft);
  const [actualSelected, setActualSelected] = useState("");
  const [actualDraft, setActualDraft] =
    useState<ActualFeeDraft>(emptyActualFeeDraft);
  const [sourceBaseline, setSourceBaseline] = useState<BaselineSource | null>(
    null,
  );
  const [baselineHead, setBaselineHead] = useState<EstimateHead | null>(null);
  const [estimateHead, setEstimateHead] = useState<EstimateHead | null>(null);
  const [baselineDraft, setBaselineDraft] =
    useState<BaselineDraft>(emptyBaselineDraft);
  const [baselineLoading, setBaselineLoading] = useState(false);
  const baselineReads = useRef(0);
  const proofGeneration = useRef(0);
  const reads = useRef(0);
  const clearProof = useCallback(() => {
    ++proofGeneration.current;
    setProof(null);
    proofBody.current = null;
  }, []);
  const failure = useCallback(
    (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "读取失败");
      if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
        live.current = false;
        ++epoch.current;
        setLocked(true);
        setLookedUpReceipt(null);
        setReceiptId("");
        setBrokers([]);
        setSnapshot(null);
        setPlans([]);
        setSelectedPlan("");
        setOriginal(null);setViewOriginal(null);setMarket("");
        setSelection({});
        setActualSnapshot(null);
        setNativeSnapshot(null);
        setActualSelected("");
        setNativeSelected("");
        setActualDraft(emptyActualFeeDraft());
        setNativeDraft(emptyActualFeeDraft());
        setSourceBaseline(null);
        setEstimateHead(null);
        setBaselineHead(null);
        setBaselineDraft(emptyBaselineDraft());
        clearProof();
      }
    },
    [clearProof],
  );
  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useLayoutEffect(() => {
    live.current = active && visible && !locked;
    ++epoch.current;
    if (!live.current) {
      clearProof();
      setOriginal(null);setViewOriginal(null);
      setLookedUpReceipt(null);
      setReceiptLoading(false);
      ++receiptReads.current;
    }
    return () => {
      live.current = false;
      ++epoch.current;
      clearProof();
    };
  }, [active, visible, locked, clearProof]);
  useEffect(() => {
    if (!proof || (!proof.preview && !proof.previewRevision)) return;
    const remaining = Date.parse(proof.expiresAt ?? "") - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      clearProof();
      return;
    }
    const timer = setTimeout(clearProof, remaining);
    return () => clearTimeout(timer);
  }, [proof, clearProof]);
  useEffect(() => {
    try {
      setPending(restoreOperation(sessionStorage, scope));
    } catch (reason) {
      failure(reason);
    }
  }, [scope, failure]);
  const load = useCallback(async () => {
    if (!live.current) return;
    const current = epoch.current;
    const read = ++reads.current;
    try {
      const accounts = await api<{ items: Broker[] }>("/broker-accounts");
      if (!live.current || current !== epoch.current || read !== reads.current)
        return;
      setBrokers(accounts.items);
      if (account) {
        const [state, saved, actual, native] = await Promise.all([
          api<Snapshot>(
            `/fees/repairs?brokerAccountId=${encodeURIComponent(account)}`,
          ),
          api<{ items: Plan[] }>(
            `/fees/plans?accountId=${encodeURIComponent(account)}`,
          ),
          api<ActualFeeSnapshot>(
            `/fees/confirmations?brokerAccountId=${encodeURIComponent(account)}`,
          ),
          api<NativeActualFeeSnapshot>(
            `/fees/confirmations/native?brokerAccountId=${encodeURIComponent(account)}`,
          ),
        ]);
        if (
          live.current &&
          current === epoch.current &&
          read === reads.current
        ) {
          setPlans(saved.items);
          setSnapshot(state);
          setActualSnapshot(actual);
          setNativeSnapshot(native);
          setSelection({});
          clearProof();
        }
      }
    } catch (reason) {
      if (current === epoch.current) failure(reason);
    }
  }, [account, clearProof, failure]);
  useEffect(() => {
    if (active && visible && !locked) void load();
  }, [active, visible, locked, load]);
  async function check() {
    if (!pending || !live.current) return;
    const current = epoch.current;
    try {
      const receipt = await api<{ state: string; message?: string }>(
        `${operationPath(pending.kind)}/operations/${pending.id}`,
      );
      if (!live.current || current !== epoch.current) return;
      if (["completed", "failed"].includes(receipt.state)) {
        updateOperation(sessionStorage, scope, pending.id, null);
        setPending(null);
        setSourceBaseline(null);
        setEstimateHead(null);
        setBaselineHead(null);
        setError("");
        setResult(
          receipt.state === "completed"
            ? pending?.kind === "fee_baseline"
              ? "原登记基线已核实"
              : pending?.kind === "fee_estimate"
                ? "费率估算已保存"
                : pending?.kind === "fee_confirmation" ||
                    pending?.kind === "native_fee_confirmation"
                  ? "实际费用已确认"
                  : "已完成"
            : (receipt.message ?? "未完成"),
        );
        setActualSelected("");
        setNativeSelected("");
        setActualDraft(emptyActualFeeDraft());
        setNativeDraft(emptyActualFeeDraft());
        void load();
      }
    } catch (reason) {
      if (current !== epoch.current) return;
      if (
        reason instanceof ApiError &&
        reason.status === 404 &&
        mayReleaseMissingReceipt(pending.submissionStatus)
      ) {
        updateOperation(sessionStorage, scope, pending.id, null);
        setPending(null);
        setError("原请求已被拒绝，请重新核对");
      } else failure(reason);
    }
  }
  async function preview(planOnly = false) {
    if (busy || pending || !snapshot || !live.current) return;
    clearProof();
    const generation = proofGeneration.current;
    const current = epoch.current;
    setBusy(true);
    setError("");
    try {
      const saved = plans.find(
        (item) =>
          item.id === selectedPlan && item.revision === item.current_revision,
      );
      if (selectedPlan && !saved)
        throw new Error("个人费率版本已变化，请重新读取");
      if(planOnly&&!market)throw new Error("请选择明确的费率市场");
      if(planOnly&&original&&(original.accountId!==account||original.providerId!==snapshot.providerId||original.market!==market||original.effectiveFrom!==from||original.effectiveThrough!==(through||null)))throw new Error("旧原件账户、来源、市场或生效期间与当前选择不一致");
      kind.current = planOnly ? "fee_plan" : "fee_repair";
      const data: Record<string, unknown> = planOnly
        ? {
            requestId: requestId(),
            planId: original?.planId ?? saved?.id ?? requestId(),
            revision: original ? original.revision-1 : saved?.revision ?? 0,
            accountId: account,
            providerId: snapshot.providerId,
            effectiveFrom: from,
            effectiveThrough: through || null,
            market,
            legacyOriginal: original?.base64 ?? null,
            components: original?.components ?? {
              ...(saved?.components ?? {}),
              [ruleKind]:
                basis === "free"
                  ? { basis, side }
                  : {
                      basis,
                      rate,
                      side,
                      minimumWins,
                      ...(minimum ? { minimum } : {}),
                      ...(maximum ? { maximum } : {}),
                      ...(maximumPercent ? { maximumPercent } : {}),
                    },
            },
            confirmed,
          }
        : {
            requestId: requestId(),
            accountId: session.user.id,
            brokerAccountId: account,
            providerId: snapshot.providerId,
            brokerRevision: snapshot.brokerRevision,
            snapshotRevision: snapshot.snapshotRevision,
            ruleVersion: snapshot.ruleVersion,
            plan: {
              effectiveFrom: from,
              effectiveThrough: through,
              confirmed,
              ...(snapshot.providerId === "huatai"
                ? { commissionIncludesExchangeFees: includes }
                : {}),
            },
            orders: Object.values(selection),
          };
      const value = await api<Proof>(
        `${operationPath(kind.current)}/preview`,
        { method: "POST", body: JSON.stringify(data) },
        session.csrf,
      );
      if (
        live.current &&
        current === epoch.current &&
        generation === proofGeneration.current
      ) {
        proofBody.current = data;
        setProof(value);
      }
    } catch (reason) {
      if (current === epoch.current) failure(reason);
    } finally {
      setBusy(false);
    }
  }
  async function readBaseline() {
    if (busy || pending || baselineLoading || !account || !live.current) return;
    clearProof();
    setBaselineLoading(true);
    setError("");
    const current = epoch.current,
      read = ++baselineReads.current;
    try {
      const [coverage, head, estimatedHead] = await Promise.all([
        api<{
          sourcePresent: boolean;
          manifestId?: string;
          manifestSha256?: string;
        }>("/legacy-financial/coverage"),
        api<EstimateHead>(
          `/fees/baselines?brokerAccountId=${encodeURIComponent(account)}`,
        ),
        api<EstimateHead>(
          `/fees/estimates?brokerAccountId=${encodeURIComponent(account)}`,
        ),
      ]);
      if (
        !coverage.sourcePresent ||
        !coverage.manifestId ||
        !coverage.manifestSha256
      )
        throw Error("尚无冻结来源快照，请在旧数据导入中核对来源");
      const [saved, raw] = await Promise.all([
        api<{
          manifestSha256: string;
          manifest: Parameters<typeof baselineSource>[2];
        }>(
          `/legacy-financial/manifests/${encodeURIComponent(coverage.manifestId)}`,
        ),
        api<RawFinancialSnapshot>(
          `/legacy-financial/manifests/${encodeURIComponent(coverage.manifestId)}/raw`,
        ),
      ]);
      if (saved.manifestSha256 !== coverage.manifestSha256)
        throw Error("来源清单已变化，请重新读取");
      if (
        live.current &&
        current === epoch.current &&
        read === baselineReads.current
      ) {
        setSourceBaseline(
          baselineSource(
            coverage.manifestId,
            coverage.manifestSha256,
            saved.manifest,
            raw,
          ),
        );
        setBaselineHead(head);
        setEstimateHead(estimatedHead);
        setBaselineDraft(emptyBaselineDraft());
      }
    } catch (reason) {
      if (current === epoch.current && read === baselineReads.current) {
        setSourceBaseline(null);
        setEstimateHead(null);
        setBaselineHead(null);
        failure(reason);
      }
    } finally {
      if (read === baselineReads.current) setBaselineLoading(false);
    }
  }
  async function previewBaseline(estimateOnly = false) {
    if (
      busy ||
      pending ||
      !snapshot ||
      !sourceBaseline ||
      !baselineHead ||
      (estimateOnly && !estimateHead) ||
      !live.current
    )
      return;
    clearProof();
    setBusy(true);
    setError("");
    setResult("");
    const current = epoch.current,
      generation = proofGeneration.current;
    try {
      const data = estimateOnly
        ? estimateBaselineCommand(
            sourceBaseline,
            estimateHead!,
            snapshot.items,
            baselineDraft,
            session.user.id,
            account,
            snapshot.ruleVersion,
            {
              from,
              through,
              confirmed,
              ...(snapshot.providerId === "huatai"
                ? { commissionIncludesExchangeFees: includes }
                : {}),
            },
            requestId(),
          )
        : baselineCommand(
            sourceBaseline,
            baselineHead,
            snapshot.items,
            baselineDraft,
            session.user.id,
            account,
            requestId(),
          );
      const value = await api<Proof>(
        estimateOnly ? "/fees/estimates/preview" : "/fees/baselines/preview",
        { method: "POST", body: JSON.stringify(data) },
        session.csrf,
      );
      if (
        value.authority !==
          (estimateOnly ? "rule_calculated" : "verified_registered_book") ||
        value.financialApplied !== false ||
        value.actualFeeKnown !== false ||
        (!estimateOnly && value.estimatedFees !== null)
      )
        throw Error("原登记核对来源或状态不匹配");
      if (
        live.current &&
        current === epoch.current &&
        generation === proofGeneration.current
      ) {
        kind.current = estimateOnly ? "fee_estimate" : "fee_baseline";
        proofBody.current = value.ready ? data : null;
        setProof(value);
        if (!value.ready)
          setError(
            estimateOnly
              ? "费率或历史范围尚未核实，本次未保存估算"
              : "原登记或范围尚未核实，本次未保存基线",
          );
      }
    } catch (reason) {
      if (current === epoch.current) failure(reason);
    } finally {
      setBusy(false);
    }
  }
  async function previewActual() {
    if (busy || pending || !actualSnapshot || !live.current) return;
    const item = actualSnapshot.items.find(
      (value) => value.tradeId === actualSelected,
    );
    if (!item) return;
    clearProof();
    const generation = proofGeneration.current,
      current = epoch.current;
    setBusy(true);
    setError("");
    setResult("");
    try {
      const data = actualFeeCommand(
        actualSnapshot,
        item,
        actualDraft,
        session.user.id,
        requestId(),
      );
      const value = await api<Proof>(
        "/fees/confirmations/preview",
        { method: "POST", body: JSON.stringify(data) },
        session.csrf,
      );
      if (
        value.authority !== "owner_recorded" ||
        value.actualFeeKnown !== true ||
        value.financialApplied !== true ||
        value.brokerAccountId !== account ||
        value.canSubmit !== true ||
        !value.previewRevision
      )
        throw Error("实际费用预览来源或核对状态不匹配");
      if (
        live.current &&
        current === epoch.current &&
        generation === proofGeneration.current
      ) {
        kind.current = "fee_confirmation";
        proofBody.current = data;
        setProof(value);
      }
    } catch (reason) {
      if (current === epoch.current) failure(reason);
    } finally {
      setBusy(false);
    }
  }
  async function previewNativeActual() {
    if (busy || pending || !nativeSnapshot || !live.current) return;
    const item = nativeSnapshot.items.find(
      (value) => value.tradeId === nativeSelected,
    );
    if (!item) return;
    clearProof();
    const generation = proofGeneration.current,
      current = epoch.current;
    setBusy(true);
    setError("");
    setResult("");
    try {
      const data = nativeActualFeeCommand(
        nativeSnapshot,
        item,
        nativeDraft,
        session.user.id,
        requestId(),
      );
      const value = await api<Proof>(
        "/fees/confirmations/native/preview",
        { method: "POST", body: JSON.stringify(data) },
        session.csrf,
      );
      if (
        value.authority !== "owner_recorded" ||
        value.actualFeeKnown !== true ||
        value.financialApplied !== true ||
        value.brokerAccountId !== account ||
        value.canSubmit !== true ||
        !value.previewRevision
      )
        throw Error("实际费用预览来源或核对状态不匹配");
      if (
        live.current &&
        current === epoch.current &&
        generation === proofGeneration.current
      ) {
        kind.current = "native_fee_confirmation";
        proofBody.current = data;
        setProof(value);
      }
    } catch (reason) {
      if (current === epoch.current) failure(reason);
    } finally {
      setBusy(false);
    }
  }
  async function lookupReceipt() {
    if (
      !live.current ||
      receiptLoading ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        receiptId,
      )
    )
      return;
    const current = epoch.current,
      read = ++receiptReads.current,
      id = receiptId;
    setLookedUpReceipt(null);
    setReceiptLoading(true);
    try {
      const value = await api<{ state: string; message?: string }>(
        `${operationPath(receiptKind)}/operations/${id}`,
      );
      if (
        !live.current ||
        current !== epoch.current ||
        read !== receiptReads.current
      )
        return;
      setLookedUpReceipt({ id, state: value.state, message: value.message });
      setError("");
    } catch (reason) {
      if (
        current === epoch.current &&
        (read === receiptReads.current ||
          (reason instanceof ApiError && [401, 403].includes(reason.status)))
      )
        failure(reason);
    } finally {
      if (current === epoch.current && read === receiptReads.current)
        setReceiptLoading(false);
    }
  }
  async function commit() {
    if (!proof || !proofBody.current || pending || busy || !live.current)
      return;
    if (
      !Number.isFinite(Date.parse(proof.expiresAt ?? "")) ||
      Date.parse(proof.expiresAt ?? "") <= Date.now()
    ) {
      clearProof();
      setError("预览已过期，请重新核对");
      return;
    }
    const data = proofBody.current,
      identifier = String(data.requestId),
      current = epoch.current;
    const locator: PendingOperation = { id: identifier, kind: kind.current };
    setReceiptId(identifier);
    setReceiptKind(kind.current);
    setLookedUpReceipt(null);
    try {
      saveOperation(sessionStorage, scope, locator);
    } catch (reason) {
      failure(reason);
      return;
    }
    setPending(locator);
    setBusy(true);
    try {
      const receipt = await api<{ state: string; message?: string }>(
        `${operationPath(kind.current)}/operations`,
        {
          method: "POST",
          body: JSON.stringify({
            data,
            preview: proof.previewRevision ?? proof.preview,
          }),
        },
        session.csrf,
      );
      if (!live.current || current !== epoch.current) return;
      clearProof();
      if (["completed", "failed"].includes(receipt.state)) {
        updateOperation(sessionStorage, scope, identifier, null);
        setPending(null);
        setSourceBaseline(null);
        setEstimateHead(null);
        setBaselineHead(null);
        setError("");
        setResult(
          receipt.state === "completed"
            ? kind.current === "fee_baseline"
              ? "原登记基线已核实"
              : kind.current === "fee_estimate"
                ? "费率估算已保存"
                : kind.current === "fee_confirmation" ||
                    kind.current === "native_fee_confirmation"
                  ? "实际费用已确认"
                  : "已完成"
            : (receipt.message ?? "未完成"),
        );
        setActualSelected("");
        setNativeSelected("");
        setActualDraft(emptyActualFeeDraft());
        setNativeDraft(emptyActualFeeDraft());
        void load();
      }
    } catch (reason) {
      if (current !== epoch.current) return;
      clearProof();
      if (
        reason instanceof ApiError &&
        submissionDisposition(reason.status) === "rejected"
      ) {
        updateOperation(sessionStorage, scope, identifier, null);
        setPending(null);
      } else if (reason instanceof ApiError) {
        const next = { ...locator, submissionStatus: reason.status };
        updateOperation(sessionStorage, scope, identifier, next);
        setPending(next);
      }
      failure(reason);
    } finally {
      setBusy(false);
    }
  }
  function edit(id: string, change: Partial<Selection>) {
    clearProof();
    setSelection((values) => ({
      ...values,
      [id]: { ...values[id], ...change },
    }));
  }
  return (
    <section className="portfolio-page fees-page">
      <header className="page-heading">
        <h1>费用</h1>
        <button
          className="button"
          onClick={() => void load()}
          disabled={busy || locked}
        >
          重新读取
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {result && <p role="status">{result}</p>}
      <details>
        <summary>费用回执</summary>
        <label>
          操作类型
          <select
            value={receiptKind}
            disabled={receiptLoading || locked}
            onChange={(event) => {
              ++receiptReads.current;
              setReceiptKind(event.target.value as PendingOperation["kind"]);
              setLookedUpReceipt(null);
              setReceiptLoading(false);
            }}
          >
            <option value="native_fee_confirmation">计算费用实付确认</option>
            <option value="fee_confirmation">原账实际费用确认</option>
            <option value="fee_baseline">原登记基线核对</option>
            <option value="fee_estimate">费率估算</option>
            <option value="fee_repair">历史费用核对</option>
            <option value="fee_plan">个人费率</option>
          </select>
        </label>
        <label>
          费用操作编号
          <input
            value={receiptId}
            maxLength={36}
            spellCheck={false}
            onChange={(event) => {
              ++receiptReads.current;
              setReceiptId(event.target.value.trim());
              setLookedUpReceipt(null);
              setReceiptLoading(false);
            }}
          />
        </label>
        <button
          className="button"
          disabled={
            !active ||
            !visible ||
            locked ||
            receiptLoading ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              receiptId,
            )
          }
          onClick={() => void lookupReceipt()}
        >
          查询费用回执
        </button>
        {lookedUpReceipt && (
          <p role="status">
            {lookedUpReceipt.id} ·{" "}
            {lookedUpReceipt.state === "completed"
              ? "已完成"
              : lookedUpReceipt.state === "failed"
                ? "未完成"
                : "结果待核对"}
            {lookedUpReceipt.message ? ` · ${lookedUpReceipt.message}` : ""}
          </p>
        )}
      </details>
      {pending && (
        <div>
          <p>等待原请求结果 · {pending.id}</p>
          <button
            className="button"
            onClick={() => void check()}
            disabled={!active || !visible || busy}
          >
            查询原回执
          </button>
        </div>
      )}
      <label>
        账户
        <select
          value={account}
          disabled={busy || locked || !!pending}
          onChange={(event) => {
            ++epoch.current;
            ++reads.current;
            setAccount(event.target.value);
            setSnapshot(null);
            setPlans([]);
            setSelectedPlan("");
            setOriginal(null);setViewOriginal(null);setMarket("");
            setSelection({});
            setActualSnapshot(null);
            setNativeSnapshot(null);
            setActualSelected("");
            setNativeSelected("");
            setActualDraft(emptyActualFeeDraft());
            setNativeDraft(emptyActualFeeDraft());
            ++baselineReads.current;
            setBaselineLoading(false);
            setSourceBaseline(null);
            setEstimateHead(null);
            setBaselineHead(null);
            setBaselineDraft(emptyBaselineDraft());
            clearProof();
          }}
        >
          <option value="">选择账户</option>
          {brokers.map((b) => (
            <option
              key={b.id}
              value={b.id}
              disabled={
                b.holding_source !== "manual" || b.account_kind === "unknown"
              }
            >
              {b.name}
            </option>
          ))}
        </select>
      </label>
      {snapshot && (
        <BaselineFeeFields
          source={sourceBaseline}
          targets={snapshot.items}
          draft={baselineDraft}
          disabled={busy || locked || !!pending || !active || !visible}
          loading={baselineLoading}
          onRead={() => void readBaseline()}
          onEdit={(value) => {
            setBaselineDraft((draft) => ({ ...draft, ...value }));
            clearProof();
          }}
          onPreview={() => void previewBaseline()}
          onEstimate={() => void previewBaseline(true)}
        />
      )}
      {actualSnapshot && (
        <ActualFeeFields
          snapshot={actualSnapshot}
          selected={actualSelected}
          draft={actualDraft}
          disabled={busy || locked || !!pending || !active || !visible}
          onSelect={(value) => {
            setActualSelected(value);
            setActualDraft(emptyActualFeeDraft());
            setNativeDraft(emptyActualFeeDraft());
            clearProof();
          }}
          onEdit={(value) => {
            setActualDraft((draft) => ({ ...draft, ...value }));
            clearProof();
          }}
          onPreview={() => void previewActual()}
        />
      )}
      {nativeSnapshot && (
        <ActualFeeFields
          snapshot={nativeSnapshot}
          selected={nativeSelected}
          draft={nativeDraft}
          disabled={busy || locked || !!pending || !active || !visible}
          onSelect={(value) => {
            setNativeSelected(value);
            setNativeDraft(emptyActualFeeDraft());
            clearProof();
          }}
          onEdit={(value) => {
            setNativeDraft((draft) => ({ ...draft, ...value }));
            clearProof();
          }}
          onPreview={() => void previewNativeActual()}
        />
      )}
      <div className="fees-period">
        <label>
          适用开始
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              clearProof();
            }}
          />
        </label>
        <label>
          适用结束
          <input
            type="date"
            value={through}
            onChange={(e) => {
              setThrough(e.target.value);
              clearProof();
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => {
              setConfirmed(e.target.checked);
              clearProof();
            }}
          />
          本人确认适用期间
        </label>
        {snapshot?.providerId === "huatai" && (
          <label>
            <input
              type="checkbox"
              checked={includes}
              onChange={(e) => {
                setIncludes(e.target.checked);
                clearProof();
              }}
            />
            佣金包含经手费和证管费
          </label>
        )}
      </div>
      <FeeSourceAttributionPanel session={session} active={active&&visible&&!locked}/>
      <details className="fees-plan">
        <summary>个人费率</summary>
        <div className="fees-plan-fields">
          <label>费率市场<select value={market} disabled={busy||!!pending} onChange={event=>{setMarket(event.target.value);setOriginal(null);clearProof();}}><option value="">选择市场</option>{[["us","美股"],["hk","港股"],["cn","A股"],["connect","港股通"],["options","期权"]].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          <FeeRuleOriginalEditor active={active&&visible&&!locked} disabled={busy||!!pending} original={original} savedBase64={viewOriginal??plans.find(item=>item.id===selectedPlan&&item.revision===item.current_revision)?.legacy_original_base64} onChange={value=>{setOriginal(value);clearProof();if(value){setMarket(value.market);setFrom(value.effectiveFrom);setThrough(value.effectiveThrough??"");setConfirmed(false);}}}/>
          {original&&<p>本次按原件完整覆盖规则提交；下方单项编辑不会改写原文件或替换原件规则。</p>}
          <label>
            保存的费率
            <select
              value={selectedPlan}
              disabled={busy || !!pending}
              onChange={(event) => {
                setSelectedPlan(event.target.value);
                setOriginal(null);setViewOriginal(null);
                clearProof();
                const plan = plans.find(
                  (item) =>
                    item.id === event.target.value &&
                    item.revision === item.current_revision,
                );
                if (plan) {
                  setFrom(plan.effective_from);
                  setThrough(plan.effective_through??"");
                  setMarket(plan.market??"");
                  setConfirmed(false);
                  const component = plan.components[ruleKind];
                  setBasis(component?.basis ?? "share");
                  setRate(component?.rate ?? "");
                  setMinimum(component?.minimum ?? "");
                  setMaximum(
                    typeof component?.maximum === "string"
                      ? component.maximum
                      : "",
                  );
                  setMaximumPercent(
                    typeof component?.maximumPercent === "string"
                      ? component.maximumPercent
                      : "",
                  );
                  setMinimumWins(component?.minimumWins !== false);
                  setSide(
                    typeof component?.side === "string"
                      ? component.side
                      : "both",
                  );
                }
              }}
            >
              <option value="">新增费率</option>
              {plans
                .filter((item) => item.revision === item.current_revision && !item.retired_at)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.effective_from} — {item.effective_through??"开放结束"} · 修订{" "}
                    {item.revision}
                  </option>
                ))}
            </select>
          </label>
          {plans.length > 0 && (
            <details>
              <summary>费率记录</summary>
              {plans.map((item) => (
                <article key={`${item.id}:${item.revision}`}>
                  {item.legacy_original_base64&&<button type="button" disabled={busy||!!pending} onClick={()=>setViewOriginal(item.legacy_original_base64!)}>查看该修订旧原件</button>}
                  <small>{item.market??"市场未核对"} · {item.retired_at?"已停用 · 历史规则保留 · ":""}{item.legacy_original_base64?"保留旧原件":"平台规则 · 无旧原件"}</small>
                  <p>
                    {item.effective_from} — {item.effective_through??"开放结束"} · 修订{" "}
                    {item.revision}
                  </p>
                  {Object.entries(item.components).map(([name, component]) => (
                    <p key={name}>
                      {(
                        {
                          commission: "佣金",
                          platform: "平台费",
                          fundCommission: "基金佣金",
                        } as Record<string, string>
                      )[name] ?? name}{" "}
                      ·{" "}
                      {component.basis === "free"
                        ? "明确免收"
                        : `${component.rate ?? "未知"} · ${({ share: "每股", order: "每单", percent: "百分比", permille: "千分比" } as Record<string, string>)[component.basis] ?? component.basis}`}
                      {component.minimum ? ` · 最低 ${component.minimum}` : ""}
                      {component.maximum !== undefined
                        ? ` · 最高 ${component.maximum}`
                        : ""}
                      {component.maximumPercent !== undefined
                        ? ` · 成交额上限 ${component.maximumPercent}%`
                        : ""}
                      {` · ${component.side === "buy" ? "买入" : component.side === "sell" ? "卖出" : "买入与卖出"}`}
                      {component.basis !== "free"
                        ? ` · 冲突时采用${component.minimumWins === false ? "上限" : "最低费用"}`
                        : ""}
                    </p>
                  ))}
                </article>
              ))}
            </details>
          )}

          <fieldset disabled={!!original||busy||!!pending}>
          <label>
            分项
            <select
              value={ruleKind}
              onChange={(e) => {
                setRuleKind(e.target.value);
                const saved = plans.find(
                  (item) =>
                    item.id === selectedPlan &&
                    item.revision === item.current_revision,
                );
                const component = saved?.components[e.target.value];
                setBasis(component?.basis ?? "share");
                setRate(component?.rate ?? "");
                setMinimum(component?.minimum ?? "");
                setMaximum(
                  typeof component?.maximum === "string"
                    ? component.maximum
                    : "",
                );
                setMaximumPercent(
                  typeof component?.maximumPercent === "string"
                    ? component.maximumPercent
                    : "",
                );
                setMinimumWins(component?.minimumWins !== false);
                setSide(
                  typeof component?.side === "string" ? component.side : "both",
                );
                clearProof();
              }}
            >
              <option value="commission">佣金</option>
              <option value="platform">平台费</option>
              <option value="fundCommission">基金佣金</option>
            </select>
          </label>
          <label>
            方式
            <select
              value={basis}
              onChange={(e) => {
                setBasis(e.target.value);
                clearProof();
              }}
            >
              <option value="share">每股</option>
              <option value="order">每单</option>
              <option value="percent">百分比</option>
              <option value="permille">千分比</option>
              <option value="free">明确免收</option>
            </select>
          </label>
          <label>
            适用方向
            <select
              value={side}
              onChange={(e) => {
                setSide(e.target.value);
                clearProof();
              }}
            >
              <option value="both">买入与卖出</option>
              <option value="buy">买入</option>
              <option value="sell">卖出</option>
            </select>
          </label>
          {basis !== "free" && (
            <>
              <label>
                费率
                <input
                  value={rate}
                  onChange={(e) => {
                    setRate(e.target.value);
                    clearProof();
                  }}
                />
              </label>
              <label>
                最高费用
                <input
                  value={maximum}
                  onChange={(e) => {
                    setMaximum(e.target.value);
                    clearProof();
                  }}
                />
              </label>
              <label>
                成交额上限百分比
                <input
                  value={maximumPercent}
                  onChange={(e) => {
                    setMaximumPercent(e.target.value);
                    clearProof();
                  }}
                />
              </label>
              <label>
                最低与上限冲突时
                <select
                  value={minimumWins ? "minimum" : "maximum"}
                  onChange={(e) => {
                    setMinimumWins(e.target.value === "minimum");
                    clearProof();
                  }}
                >
                  <option value="minimum">采用最低费用</option>
                  <option value="maximum">采用费用上限</option>
                </select>
              </label>
              <label>
                最低费用
                <input
                  value={minimum}
                  onChange={(e) => {
                    setMinimum(e.target.value);
                    clearProof();
                  }}
                />
              </label>
            </>
          )}
          </fieldset>
          <button
            className="button"
            disabled={busy || !!pending || !snapshot}
            onClick={() => void preview(true)}
          >
            核对个人费率
          </button>
        </div>
      </details>
      {snapshot && (
        <section>
          <h2>历史费用核对</h2>
          <p>
            规则截至 {snapshot.ruleVersion.slice(0, 10)} · 按本人确认期间重建
          </p>
          {!snapshot.ordersComplete && (
            <p role="status">
              {snapshot.legacyCoverage.status === "unavailable"
                ? "旧原账清单尚未导入，历史订单范围未知"
                : "旧原账清单或成交映射尚未完整核对"}
            </p>
          )}
          {snapshot.unassignedOrderIds === null ? (
            <p>旧未分配订单范围未知</p>
          ) : snapshot.unassignedOrders &&
            snapshot.unassignedOrders.length > 0 ? (
            <section>
              <h3>原始未分配订单</h3>
              {snapshot.unassignedOrders.map((item) => (
                <article key={item.orderId}>
                  <p>
                    {item.input.code ?? "证券未知"} · {item.orderId}
                  </p>
                  <p>
                    数量 {item.input.quantity ?? "未知"} · 原费用{" "}
                    {item.input.fees ?? "未知"}{" "}
                    {item.input.currency ?? "币种未知"}
                  </p>
                  {snapshot.sourceAttributions.some(
                    (value) => value.orderId === item.orderId,
                  ) ? (
                    <p>归属证据已确认，尚未财务归账</p>
                  ) : (
                    <p>须逐笔核对历史归属及原现金，尚未财务归账</p>
                  )}
                </article>
              ))}
            </section>
          ) : null}
          {snapshot.items.map((item) => (
            <article key={item.orderId}>
              <label>
                <input
                  type="checkbox"
                  checked={!!selection[item.orderId]}
                  disabled={!!item.exclusion || busy || !!pending}
                  onChange={(e) => {
                    if (item.recordRevision === null) return;
                    const recordRevision = item.recordRevision;
                    clearProof();
                    setSelection((values) => {
                      const copy = { ...values };
                      if (e.target.checked)
                        copy[item.orderId] = {
                          orderId: item.orderId,
                          revision: item.revision,
                          recordRevision,
                          instrumentKind: "unknown",
                          wholeOrderConfirmed: false,
                          brokerOwnershipConfirmed: false,
                        };
                      else delete copy[item.orderId];
                      return copy;
                    });
                  }}
                />
                {item.code ?? "证券未知"} · 登记费用{" "}
                {item.registeredFees ?? item.fees ?? "未知"} · 实付{" "}
                {item.actualFeeKnown ? (item.fees ?? "未知") : "未知"}
              </label>
              {item.exclusion && <p>{item.exclusion}</p>}
              {selection[item.orderId] && (
                <div>
                  <label>
                    证券类型
                    <select
                      value={selection[item.orderId].instrumentKind}
                      onChange={(e) =>
                        edit(item.orderId, { instrumentKind: e.target.value })
                      }
                    >
                      <option value="unknown">待核对</option>
                      <option value="us_domestic_equity">美股普通股票</option>
                      <option value="us_etf">美股 ETF</option>
                      <option value="cn_a_equity">A 股普通股票</option>
                    </select>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={selection[item.orderId].brokerOwnershipConfirmed}
                      onChange={(e) =>
                        edit(item.orderId, {
                          brokerOwnershipConfirmed: e.target.checked,
                        })
                      }
                    />
                    已核对成交当时的账户归属
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={selection[item.orderId].wholeOrderConfirmed}
                      onChange={(e) =>
                        edit(item.orderId, {
                          wholeOrderConfirmed: e.target.checked,
                        })
                      }
                    />
                    完整独立计费订单，无未处理优惠或附加费
                  </label>
                  {item.manualReviewRequired && (
                    <label>
                      <input
                        type="checkbox"
                        checked={
                          selection[item.orderId].legacyImportConfirmed === true
                        }
                        onChange={(e) =>
                          edit(item.orderId, {
                            legacyImportConfirmed: e.target.checked
                              ? true
                              : undefined,
                          })
                        }
                      />
                      逐笔确认旧导入遗漏费用
                    </label>
                  )}
                </div>
              )}
            </article>
          ))}
          <button
            className="button"
            disabled={busy || !!pending || !Object.keys(selection).length}
            onClick={() => void preview()}
          >
            核对所选费用
          </button>
        </section>
      )}
      {proof && (
        <section>
          <h2>
            {kind.current === "fee_confirmation" ||
            kind.current === "native_fee_confirmation"
              ? "实际费用核对"
              : kind.current === "fee_baseline"
                ? "原登记基线核对"
                : kind.current === "fee_estimate"
                  ? "费率估算"
                  : "本次核对"}
          </h2>
          {kind.current === "fee_plan" && proof.data && (
            <div>
              <p>
                {proof.sourceAccount?.name} ·{" "}
                {proof.sourceAccount?.accountKind === "simulated"
                  ? "模拟"
                  : "真实"}{" "}
                · {proof.data.market??"市场未核对"} · {proof.data.effectiveFrom} — {proof.data.effectiveThrough??"开放结束"}
              </p>
              {Object.entries(proof.data.components).map(
                ([name, component]) => (
                  <p key={name}>
                    {(
                      {
                        commission: "佣金",
                        platform: "平台费",
                        fundCommission: "基金佣金",
                      } as Record<string, string>
                    )[name] ?? name}{" "}
                    ·
                    {component.basis === "free"
                      ? " 明确免收"
                      : ` ${component.rate} · ${({ share: "每股", order: "每单", percent: "百分比", permille: "千分比" } as Record<string, string>)[component.basis]}`}
                    {component.minimum !== undefined
                      ? ` · 最低 ${component.minimum}`
                      : ""}
                    {component.maximum !== undefined
                      ? ` · 最高 ${component.maximum}`
                      : ""}
                    {component.maximumPercent !== undefined
                      ? ` · 成交额上限 ${component.maximumPercent}%`
                      : ""}
                    {` · ${component.side === "buy" ? "买入" : component.side === "sell" ? "卖出" : "买入与卖出"}`}
                    {component.basis !== "free"
                      ? ` · 冲突时采用${component.minimumWins === false ? "上限" : "最低费用"}`
                      : ""}
                  </p>
                ),
              )}
              <p>不重算历史成交</p>
            </div>
          )}
          {kind.current === "fee_baseline" &&
            proof.records?.map((value) => (
              <p key={value.recordId}>
                {value.recordId} · 登记数量 {value.registered.quantity} ·
                登记成本 {value.registered.registeredCost ?? "未知"} ·
                实际费用、成本及收益未知
              </p>
            ))}
          {kind.current === "fee_estimate" &&
            proof.assessments?.map((value) => (
              <div key={value.recordId}>
                {Object.entries(value.orders).map(([order, item]) => (
                  <p key={order}>
                    {order} · 估算费用 {item.fee}
                  </p>
                ))}
                <p>
                  估算成本 {value.estimated.cost ?? "未知"} · 估算账户余额{" "}
                  {value.estimated.accountCashAfter ?? "未知"}
                </p>
                <p>
                  实付费用 {value.actual.feesKnown ? "已核实" : "未知"} ·
                  实际成本 {value.actual.cost ?? "未知"} · 实际余额{" "}
                  {value.actual.cashBalance ?? "未知"}
                </p>
              </div>
            ))}
          {proof.candidates?.map((item) => (
            <p key={item.orderId}>
              {kind.current === "fee_confirmation" ||
              kind.current === "native_fee_confirmation"
                ? `${item.originalOrderId ?? item.orderId} · 本人核实实付 ${item.newFees} ${proof.cashEffect?.currency ?? "币种未知"}`
                : `${item.orderId} · ${item.oldFees} → ${item.newFees} ${item.currency ?? ""} · 按本人规则重建`}
            </p>
          ))}
          {proof.excluded?.map((item) => (
            <p key={item.orderId}>
              {item.orderId} · {item.reason}
            </p>
          ))}
          {(kind.current === "fee_confirmation" ||
            kind.current === "native_fee_confirmation") &&
            proof.positionEffects?.map((value) => (
              <p key={value.recordId}>
                登记成本 {value.beforeCost ?? "未知"} · 核实后成本{" "}
                {(kind.current === "native_fee_confirmation"
                  ? value.actualAfterCost
                  : value.afterCost) ?? "未知"}
              </p>
            ))}
          {(kind.current === "fee_confirmation" ||
            kind.current === "native_fee_confirmation") &&
            proof.cashEffect && (
              <p>
                账户余额 {proof.cashEffect.brokerBefore ?? "未知"} →{" "}
                {proof.cashEffect.brokerAfter ?? "未知"}{" "}
                {proof.cashEffect.currency}
              </p>
            )}
          {proof.cashEffect && (
            <p>
              现金 {proof.cashEffect.before ?? "未知"} →{" "}
              {proof.cashEffect.after ?? "未知"} {proof.cashEffect.currency}
              ，差额 {proof.cashEffect.delta}
            </p>
          )}
          <button
            className="button"
            disabled={
              busy ||
              !!pending ||
              proof.canSubmit === false ||
              (!proof.preview && !proof.previewRevision) ||
              (["fee_estimate", "fee_baseline"].includes(kind.current) &&
                proof.ready !== true) ||
              Date.parse(proof.expiresAt ?? "") <= Date.now()
            }
            onClick={() => void commit()}
          >
            {kind.current === "fee_confirmation" ||
            kind.current === "native_fee_confirmation"
              ? "确认实际记账"
              : kind.current === "fee_baseline"
                ? "保存原登记基线"
                : kind.current === "fee_estimate"
                  ? "保存费率估算"
                  : "确认提交"}
          </button>
        </section>
      )}
    </section>
  );
}
