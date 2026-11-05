import "./cash-overview.css";
import "./page-layout.css";
import { SelectMenu } from "./select-menu";
import { WorkspaceEmpty } from "./workspace-ui";
import { RefreshCw } from "lucide-react";
import { PrivateAmount } from "./financial-display";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Session } from "./api";

type Currency = {
  currency: string;
  ownerBalance: string | null;
  registeredOwnerBalance: string | null;
  unallocatedBalance: string | null;
  registeredUnallocatedBalance: string | null;
  reservedBuyCash: string | null;
  availableOwnerBalance: string | null;
  ledgerAsOf: string | null;
  complete: boolean;
  reservationsComplete: boolean;
};
type Snapshot = {
  revision: number;
  snapshotRevision: string;
  books: { accountKind: string; currencies: Currency[] }[];
};
export function CashOverviewPanel({
  session,
  generation,
  onDenied,
}: {
  session: Session;
  generation: string;
  onDenied: (failure: unknown) => void;
}) {
  const scope = JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
    session.csrf,
    session.expires_at,
  ]);
  return <Content key={scope} generation={generation} onDenied={onDenied} />;
}
function Content({
  generation,
  onDenied,
}: {
  generation: string;
  onDenied: (failure: unknown) => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [error, setError] = useState(""),
    [kind, setKind] = useState("real"),
    [refresh, setRefresh] = useState(0);
  const epoch = useRef(0),
    denied = useRef(onDenied);
  denied.current = onDenied;
  useEffect(() => {
    if (document.hidden) return;
    const run = ++epoch.current,
      controller = new AbortController();
    setSnapshot(null);
    setError("");
    void api<Snapshot>("/account/cash-overview", { signal: controller.signal })
      .then((value) => {
        if (
          !controller.signal.aborted &&
          run === epoch.current &&
          !document.hidden
        )
          setSnapshot(value);
      })
      .catch((failure) => {
        if (controller.signal.aborted || run !== epoch.current) return;
        setError(
          failure instanceof Error ? failure.message : "资金总览读取失败",
        );
        if (
          failure instanceof ApiError &&
          [401, 403].includes(failure.status)
        ) {
          setSnapshot(null);
          denied.current(failure);
        }
      });
    const visibility = () => {
      epoch.current++;
      controller.abort();
      setSnapshot(null);
      if (!document.hidden) setRefresh((value) => value + 1);
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      epoch.current++;
      controller.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [generation, refresh]);
  const rows = snapshot?.books.find(
    (book) => book.accountKind === kind,
  )?.currencies;
  return (
    <section className="cash-overview">
      <div className="workspace-section-heading">
        <h2>原币资金</h2>
        <div className="page-toolbar-actions">
          <SelectMenu
            label="资金账本"
            value={kind}
            options={[
              { value: "real", label: "真实账本" },
              { value: "simulated", label: "模拟账本" },
            ]}
            onChange={setKind}
            variant="compact"
          />
          <button
            type="button"
            className="icon-button"
            aria-label="刷新原币资金"
            onClick={() => setRefresh((v) => v + 1)}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {!snapshot && !error && <p role="status">正在读取资金…</p>}
      {rows && rows.length === 0 && (
        <WorkspaceEmpty
          title="暂无现金记录"
          description="登记原币现金后，将在这里分别汇总。"
        />
      )}
      {!!rows?.length && (
        <div className="cash-currency-grid">
          {rows.map((row) => (
            <CashCurrencyCard key={row.currency} row={row} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Same owner ledger fields, presented without inventing external buying power. */
export function CashCurrencyCard({ row }: { row: Currency }) {
  const line = (label: string, value: string | null) => (
    <div>
      <dt>{label}</dt>
      <dd>
        <PrivateAmount>{value ?? "未知"}</PrivateAmount>
      </dd>
    </div>
  );
  return (
    <article className="cash-currency-card">
      <header>
        <strong>{row.currency}</strong>
        <span>{row.complete ? "账本资料完整" : "待核对"}</span>
      </header>
      <div className={`cash-balance${(row.ownerBalance?.length ?? 0) > 18 ? " cash-balance-precise" : ""}`}>
        <PrivateAmount>{row.ownerBalance ?? "未知"}</PrivateAmount>
        <small>内部账本余额</small>
      </div>
      <dl>
        {line("登记资金", row.registeredOwnerBalance)}
        <div>
          <dt>未分配</dt>
          <dd>
            <PrivateAmount>{row.unallocatedBalance ?? "未知"}</PrivateAmount>
            {row.unallocatedBalance === null &&
              row.registeredUnallocatedBalance !== null && (
                <small className="cash-registered-note">
                  登记值{" "}
                  <PrivateAmount>
                    {row.registeredUnallocatedBalance}
                  </PrivateAmount>
                </small>
              )}
          </dd>
        </div>
        {line("买单预留", row.reservedBuyCash)}
        {line("内部可用", row.availableOwnerBalance)}
      </dl>
      {!row.reservationsComplete && (
        <p className="cash-uncertain-note">买单预留尚未核实</p>
      )}
      <small className="cash-asof">{row.ledgerAsOf || "流水时间未知"}</small>
    </article>
  );
}
