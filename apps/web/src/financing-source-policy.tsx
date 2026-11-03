import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";
import { requestId } from "./request-id";
import type { FinancingHead, FinancingPolicy } from "./financing-state";

type Source = {
  state: "not_captured" | "blocked" | "available";
  manifestId: string | null;
  policyKnown: boolean;
  policy: FinancingPolicy | null;
  message?: string;
  originalReceiptCount?: number;
};
type Proof = {
  previewRevision: string;
  expiresAt: string;
  policy: FinancingPolicy | null;
};
export function FinancingSourcePolicy({
  session,
  head,
  generation,
  blocked,
  onSubmit,
}: {
  session: Session;
  head: FinancingHead;
  generation: number;
  blocked: boolean;
  onSubmit: (data: Record<string, unknown>, proof: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false),
    [visible, setVisible] = useState(
      typeof document === "undefined" ? true : !document.hidden,
    ),
    [source, setSource] = useState<Source | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [proof, setProof] = useState<Proof | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const epoch = useRef(0),
    live = useRef(false),
    body = useRef<Record<string, unknown> | null>(null);
  const scope = [
    session.user.id,
    session.user.role,
    session.instance_id,
    session.receipt_scope,
    session.csrf,
    head.accountKind,
    head.revision,
  ].join(":");
  function clear() {
    epoch.current++;
    body.current = null;
    setProof(null);
  }
  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useLayoutEffect(() => {
    live.current = open && visible;
    clear();
    setSource(null);
    setConfirmed(false);
    setError("");
    return () => {
      live.current = false;
      clear();
    };
  }, [open, visible, scope, generation]);
  useEffect(() => {
    if (!open || !visible) return;
    const current = epoch.current,
      controller = new AbortController();
    api<Source>(
      `/financing/policy/source?accountKind=${encodeURIComponent(head.accountKind)}`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (live.current && epoch.current === current) setSource(value);
      })
      .catch((reason) => {
        if (!controller.signal.aborted && epoch.current === current)
          setError(reason instanceof Error ? reason.message : "读取失败");
      });
    return () => controller.abort();
  }, [open, visible, scope, generation, head.accountKind]);
  useEffect(() => {
    if (blocked) clear();
  }, [blocked]);
  useEffect(() => {
    if (!proof) return;
    const remaining = Date.parse(proof.expiresAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      clear();
      return;
    }
    const timer = setTimeout(clear, remaining);
    return () => clearTimeout(timer);
  }, [proof]);
  async function preview() {
    if (
      !live.current ||
      busy ||
      blocked ||
      !confirmed ||
      source?.state !== "available" ||
      !source.policyKnown ||
      !source.manifestId
    )
      return;
    clear();
    const current = epoch.current;
    setBusy(true);
    setError("");
    const data = {
      requestId: requestId(),
      manifestId: source.manifestId,
      targetUserId: session.user.id,
      accountKind: head.accountKind,
      revision: head.revision,
      sourcePolicyKindConfirmed: true,
    };
    try {
      const value = await api<Proof>(
        "/financing/policy/preview",
        { method: "POST", body: JSON.stringify(data) },
        session.csrf,
      );
      if (live.current && current === epoch.current) {
        body.current = data;
        setProof(value);
      }
    } catch (reason) {
      if (current === epoch.current) {
        setError(reason instanceof Error ? reason.message : "预览失败");
        if (reason instanceof ApiError && [401, 403].includes(reason.status)) {
          setSource(null);
          setConfirmed(false);
          clear();
        }
      }
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!live.current || busy || blocked || !proof || !body.current) return;
    if (Date.parse(proof.expiresAt) <= Date.now()) {
      clear();
      return;
    }
    const data = body.current,
      token = proof.previewRevision;
    setBusy(true);
    clear();
    try {
      const done = await onSubmit(data, token);
      if (live.current) {
        setConfirmed(false);
        if (!done) setError("请查询原请求回执");
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>原政策来源</summary>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {source?.state === "not_captured" && (
        <p role="status">尚未捕获原融资政策</p>
      )}
      {source?.state === "blocked" && (
        <p role="status">{source.message || "原融资政策尚未核实"}</p>
      )}
      {source?.state === "available" && source.policyKnown && (
        <>
          <dl className="portfolio-proof">
            <div>
              <dt>原政策</dt>
              <dd>
                {source.policy
                  ? `${source.policy.currency} · 额度 ${source.policy.limit ?? "未设置"}`
                  : "未配置"}
              </dd>
            </div>
            <div>
              <dt>原请求回执</dt>
              <dd>{source.originalReceiptCount ?? "未知"}</dd>
            </div>
            {source.policy && (
              <>
                <div>
                  <dt>初始保证金金额</dt>
                  <dd>{source.policy.initialMargin ?? "未设置"}</dd>
                </div>
                <div>
                  <dt>维持保证金金额</dt>
                  <dd>{source.policy.maintenanceMargin ?? "未设置"}</dd>
                </div>
              </>
            )}
          </dl>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy || blocked}
              onChange={(event) => {
                clear();
                setConfirmed(event.target.checked);
              }}
            />
            将原政策仅归属此{head.accountKind === "real" ? "真实" : "模拟"}账本
          </label>
          <button
            className="button"
            disabled={busy || blocked || !confirmed}
            onClick={() => void preview()}
          >
            预览迁入
          </button>
        </>
      )}
      {proof && (
        <div className="financial-preview">
          <p>
            {proof.policy
              ? `${proof.policy.currency} · 额度 ${proof.policy.limit ?? "未设置"}`
              : "原政策未配置"}
          </p>
          <button
            className="button"
            disabled={busy || blocked || !confirmed}
            onClick={() => void commit()}
          >
            确认迁入
          </button>
        </div>
      )}
    </details>
  );
}
