import { PrivateAmount } from "./financial-display";
import { FireProgress } from "./fire-progress";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { requestId } from "./request-id";
import { SelectMenu } from "./select-menu";
import {
  buildFire,
  clearFireRequests,
  emptyFireChanges,
  fireAsset,
  fireCurrencies,
  fireCurrencyLocked,
  fireFields,
  fireReceipt,
  fireRows,
  fireText,
  fireYear,
  readFireRequest,
  releaseFireRequest,
  retainFireRequest,
  rowFields,
  type Fire,
  type FireChanges,
} from "./fire-state";
import "./fire.css";
const base = "/fire-settings";
type Snapshot = { fire: Fire; revision: number };
const validId = (id: string) =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
function dateLabel(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    return "时间待核对";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
export function FireAnnualTable({
  rows,
  year,
  disabled,
  onChange,
  onRemove,
  editable = true,
}: {
  rows: Record<string, unknown>[];
  year: number;
  disabled: boolean;
  onChange: (year: number, key: string, value: string) => void;
  onRemove: (year: number) => void;
  editable?: boolean;
}) {
  return (
    <div className="fire-table-scroll">
      <table>
        <caption>年度手填记录</caption>
        <thead>
          <tr>
            <th scope="col">年份</th>
            {rowFields.map((field) => (
              <th scope="col" key={field.key}>
                {field.label}
              </th>
            ))}
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const y = Number(row.year),
              duplicate = rows.filter((r) => Number(r.year) === y).length > 1,
              readOnly = y < year || duplicate;
            return (
              <tr key={y + ":" + index}>
                <th scope="row">
                  {y}
                  {y < year && <small>已结束</small>}
                  {duplicate && <small>重复年份待核对</small>}
                </th>
                {rowFields.map((field) => (
                  <td key={field.key}>
                    {readOnly || !editable ? (
                      <PrivateAmount>
                        {fireText(row[field.key]) || "—"}
                      </PrivateAmount>
                    ) : (
                      <input
                        aria-label={y + " " + field.label}
                        inputMode="decimal"
                        value={fireText(row[field.key])}
                        disabled={disabled}
                        onChange={(event) =>
                          onChange(y, field.key, event.target.value)
                        }
                      />
                    )}
                  </td>
                ))}
                <td>
                  {editable && y > year && !duplicate && (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={disabled}
                      aria-label={"移除 " + y + " 年"}
                      onClick={() => onRemove(y)}
                    >
                      移除
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
export function FirePage({
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
    <FireSession
      key={JSON.stringify([scope, session.csrf, session.expires_at])}
      {...{ session, active, scope }}
    />
  );
}
function FireSession({
  session,
  active,
  scope,
}: {
  session: Session;
  active: boolean;
  scope: string;
}) {
  const year = fireYear();
  const [visible, setVisible] = useState(
      typeof document === "undefined" || !document.hidden,
    ),
    [locked, setLocked] = useState(false),
    [ready, setReady] = useState(false),
    [journalReady, setJournalReady] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [changes, setChanges] = useState<FireChanges>(emptyFireChanges),
    [newYear, setNewYear] = useState(String(year));
  const [amount, setAmount] = useState(""),
    [usd, setUsd] = useState(""),
    [assetCurrency, setAssetCurrency] = useState("");
  const [busy, setBusy] = useState(false),
    [pending, setPending] = useState<string | null>(null),
    [lookup, setLookup] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const live = useRef(false),
    epoch = useRef(0),
    read = useRef(0),
    original = useRef<string | null>(null),
    operationKind = useRef<"plan" | "asset" | null>(null),
    rejected = useRef<number | undefined>(undefined);
  const work = useRef<AbortController | null>(null),
    reading = useRef<AbortController | null>(null);
  const displayed = useCallback(
    () => apiSessionSnapshot().csrf === session.csrf,
    [session.csrf],
  );
  const clearObservation = useCallback(() => {
    setAmount("");
    setUsd("");
    setAssetCurrency("");
  }, []);
  const pause = useCallback(() => {
    live.current = false;
    ++epoch.current;
    ++read.current;
    work.current?.abort();
    work.current = null;
    reading.current?.abort();
    reading.current = null;
    setBusy(false);
    setReady(false);
    setSnapshot(null);
    clearObservation();
  }, [clearObservation]);
  const fail = useCallback(
    (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "读取失败");
      if (
        !displayed() ||
        (reason instanceof ApiError &&
          ([401, 403].includes(reason.status) ||
            reason.code === "session_changed"))
      ) {
        pause();
        setLocked(true);
        setChanges(emptyFireChanges());
        setLookup("");
        setNotice("");
        original.current = null;
        setPending(null);
        operationKind.current = null;
        rejected.current = undefined;
        try {
          clearFireRequests(sessionStorage);
        } catch {}
      }
    },
    [displayed, pause],
  );
  useLayoutEffect(() => {
    live.current = active && visible && !locked && displayed();
    ++epoch.current;
    setReady(false);
    return pause;
  }, [active, visible, locked, displayed, pause]);
  useEffect(() => {
    const change = () => {
      if (document.hidden) pause();
      setVisible(!document.hidden);
    };
    change();
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, [pause]);
  useEffect(() => {
    if (!live.current || !displayed()) return;
    try {
      const id = readFireRequest(sessionStorage, scope);
      original.current = id;
      setPending(id);
      setJournalReady(true);
    } catch (reason) {
      setLocked(true);
      fail(reason);
    }
  }, [active, visible, scope, displayed, fail]);
  const load = useCallback(async () => {
    if (!live.current || !displayed()) return;
    const generation = epoch.current,
      sequence = ++read.current,
      controller = new AbortController();
    reading.current?.abort();
    reading.current = controller;
    setReady(false);
    setSnapshot(null);
    try {
      const value = await api<Snapshot>(base, { signal: controller.signal });
      if (
        !live.current ||
        !displayed() ||
        generation !== epoch.current ||
        sequence !== read.current
      )
        return;
      if (
        !value.fire ||
        typeof value.fire !== "object" ||
        Array.isArray(value.fire) ||
        !Number.isSafeInteger(value.revision) ||
        value.revision < 0
      )
        throw new Error("规划状态待核对");
      setSnapshot(value);
      setReady(true);
      setError("");
    } catch (reason) {
      if (
        live.current &&
        generation === epoch.current &&
        sequence === read.current &&
        !controller.signal.aborted
      )
        fail(reason);
    } finally {
      if (reading.current === controller) reading.current = null;
    }
  }, [displayed, fail]);
  useEffect(() => {
    if (active && visible && !locked) void load();
  }, [active, visible, locked, load]);
  function known(value: unknown, id: string) {
    const receipt = fireReceipt(value, id);
    if (original.current === id) {
      releaseFireRequest(sessionStorage, scope, id);
      original.current = null;
      setPending(null);
      if (operationKind.current === "plan") setChanges(emptyFireChanges());
      operationKind.current = null;
      rejected.current = undefined;
    }
    setLookup(receipt.requestId);
    setNotice("已保存 · " + receipt.requestId);
    setError("");
    clearObservation();
    void load();
  }
  function releaseRejected(id: string) {
    releaseFireRequest(sessionStorage, scope, id);
    original.current = null;
    setPending(null);
    operationKind.current = null;
    rejected.current = undefined;
    setNotice("上次保存未受理，请核对当前规划");
    void load();
  }
  async function check(id = original.current ?? lookup.trim()) {
    if (!live.current || !displayed() || work.current || !validId(id)) {
      if (!validId(id)) setError("请输入有效操作编号");
      return;
    }
    const generation = epoch.current,
      controller = new AbortController();
    work.current = controller;
    setBusy(true);
    setError("");
    try {
      const value = await api<unknown>(base + "/operations/" + id, {
        signal: controller.signal,
      });
      if (live.current && displayed() && generation === epoch.current)
        known(value, id);
    } catch (reason) {
      if (live.current && generation === epoch.current) {
        if (
          reason instanceof ApiError &&
          reason.status === 404 &&
          original.current === id &&
          rejected.current !== undefined
        )
          releaseRejected(id);
        else fail(reason);
      }
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (generation === epoch.current) setBusy(false);
      }
    }
  }
  async function save(observation: boolean) {
    if (
      !live.current ||
      !displayed() ||
      work.current ||
      original.current ||
      !ready ||
      !journalReady ||
      !snapshot
    )
      return;
    let fire: Fire, assetRecord: ReturnType<typeof fireAsset> | undefined;
    try {
      fire = observation
        ? snapshot.fire
        : buildFire(snapshot.fire, changes, year);
      if (observation) assetRecord = fireAsset(amount, usd, assetCurrency);
    } catch (reason) {
      fail(reason);
      return;
    }
    const id = requestId(),
      generation = epoch.current,
      controller = new AbortController();
    const body = JSON.stringify({
      fire,
      ...(assetRecord ? { assetRecord } : {}),
      requestId: id,
      expectedRevision: snapshot.revision,
    });
    if (new TextEncoder().encode(body).byteLength > 256 * 1024 + 2048) {
      setError("规划数据过大");
      return;
    }
    try {
      retainFireRequest(sessionStorage, scope, id);
    } catch (reason) {
      fail(reason);
      return;
    }
    original.current = id;
    operationKind.current = observation ? "asset" : "plan";
    rejected.current = undefined;
    setPending(id);
    setNotice("");
    setError("");
    work.current = controller;
    setBusy(true);
    clearObservation();
    try {
      const result = await api<unknown>(
        base,
        { method: "PUT", body, signal: controller.signal },
        session.csrf,
      );
      if (live.current && displayed() && generation === epoch.current)
        known(result, id);
    } catch (reason) {
      if (live.current && generation === epoch.current) {
        fail(reason);
        if (
          reason instanceof ApiError &&
          [400, 404, 405, 409, 413, 415, 422, 429].includes(reason.status)
        ) {
          rejected.current = reason.status;
          try {
            const result = await api<unknown>(base + "/operations/" + id, {
              signal: controller.signal,
            });
            if (live.current && displayed() && generation === epoch.current)
              known(result, id);
          } catch (lookupError) {
            if (live.current && generation === epoch.current) {
              if (lookupError instanceof ApiError && lookupError.status === 404)
                releaseRejected(id);
              else fail(lookupError);
            }
          }
        }
      }
    } finally {
      if (work.current === controller) {
        work.current = null;
        if (generation === epoch.current) setBusy(false);
      }
    }
  }
  const fire = snapshot?.fire ?? {},
    currencyLocked = fireCurrencyLocked(fire, year),
    currency = currencyLocked
      ? fireText(fire.baseCurrency)
      : (changes.fields.baseCurrency ?? fireText(fire.baseCurrency)),
    blocked = busy || !!pending || !ready || !journalReady || locked;
  const rows: Record<string, unknown>[] = [
    ...fireRows(fire)
      .filter(
        (row) =>
          Number(row.year) <= year ||
          !changes.removed.includes(Number(row.year)),
      )
      .map((row) =>
        Number(row.year) < year
          ? row
          : { ...row, ...changes.rows[String(row.year)] },
      ),
    ...changes.added.map((y) => ({ year: y, ...changes.rows[String(y)] })),
  ].sort((a, b) => Number(a.year) - Number(b.year));
  const options = [
    { value: "", label: currencyLocked ? "未知" : "选择币种" },
    ...fireCurrencies.map((value) => ({ value, label: value })),
    ...(!fireCurrencies.includes(currency as (typeof fireCurrencies)[number]) &&
    currency
      ? [{ value: currency, label: currency + " · 待核对" }]
      : []),
  ];
  const dirty =
    Object.keys(changes.fields).length > 0 ||
    Object.keys(changes.rows).length > 0 ||
    changes.added.length > 0 ||
    changes.removed.length > 0;
  const history = Array.isArray(fire.assetHistory) ? fire.assetHistory : [];
  const [editing, setEditing] = useState(false);
  const currentRows = rows.filter((row) => Number(row.year) === year);
  return (
    <section className="fire-planning-page">
      <header className="page-heading">
        <h1>FIRE 规划</h1>
        <div className="fire-heading-actions">
          <button
            type="button"
            className="button secondary"
            disabled={blocked || (editing && dirty)}
            onClick={() => setEditing(!editing)}
          >
            {editing ? "退出编辑" : "编辑规划"}
          </button>
          <button
            className="button"
            disabled={busy || locked}
            onClick={() => void load()}
          >
            重新读取
          </button>
        </div>
      </header>
      {error && <p role="alert">{error}</p>}
      {notice && (
        <p role="status" className="fire-request-id">
          {notice}
        </p>
      )}
      {pending && (
        <div className="fire-pending" role="status">
          <p>等待原操作结果</p>
          <p className="fire-request-id">{pending}</p>
          <button
            className="button"
            disabled={busy || locked}
            onClick={() => void check()}
          >
            查询原回执
          </button>
        </div>
      )}
      <FireProgress
        progress={currentRows.length === 1 ? currentRows[0].progress : null}
        current={changes.fields.currentInput ?? fireText(fire.currentInput)}
        target={changes.fields.fireTargetBase ?? fireText(fire.fireTargetBase)}
        currency={currency}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save(false);
        }}
      >
        <details className="workspace-tools" open={editing}>
          <summary>规划参数</summary>
          <div className="fire-currency">
            <label>
              规划币种
              <SelectMenu
                label="规划币种"
                value={currency}
                options={options}
                variant="field"
                disabled={blocked || !editing || currencyLocked}
                onChange={(value) =>
                  setChanges((old) => ({
                    ...old,
                    fields: { ...old.fields, baseCurrency: value },
                  }))
                }
              />
            </label>
            {currencyLocked && (
              <span>
                已结束年度币种固定
                {!fireText(fire.baseCurrency) ? " · 未知" : ""}
              </span>
            )}
          </div>
          <div className="fire-fields">
            {fireFields.map((field) => (
              <label key={field.key}>
                {field.label}
                <input
                  inputMode="decimal"
                  disabled={blocked || !editing}
                  value={changes.fields[field.key] ?? fireText(fire[field.key])}
                  onChange={(event) =>
                    setChanges((old) => ({
                      ...old,
                      fields: {
                        ...old.fields,
                        [field.key]: event.target.value,
                      },
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <p className="fire-source">
            年度金额 · {currency || "币种未知"} · 手填
          </p>
        </details>
        {Array.isArray(fire.tableRows) &&
          fireRows(fire).length !== fire.tableRows.length && (
            <p role="alert">部分年度记录待核对</p>
          )}
        <FireAnnualTable
          rows={rows}
          editable={editing}
          year={year}
          disabled={blocked}
          onChange={(y, key, value) =>
            setChanges((old) => ({
              ...old,
              rows: { ...old.rows, [y]: { ...old.rows[y], [key]: value } },
            }))
          }
          onRemove={(y) =>
            setChanges((old) => ({
              ...old,
              added: old.added.filter((v) => v !== y),
              removed: [...old.removed, y],
            }))
          }
        />
        {editing && (
          <div className="fire-year-add">
            <label>
              年份
              <input
                inputMode="numeric"
                value={newYear}
                disabled={blocked}
                onChange={(event) => setNewYear(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="button secondary"
              disabled={blocked}
              onClick={() => {
                const y = Number(newYear);
                if (
                  !Number.isSafeInteger(y) ||
                  y < year ||
                  y > 9999 ||
                  rows.some((row) => Number(row.year) === y)
                ) {
                  setError("年份重复或已结束");
                  return;
                }
                setChanges((old) => ({ ...old, added: [...old.added, y] }));
              }}
            >
              添加年份
            </button>
          </div>
        )}
        <div className="fire-actions">
          <button className="button" disabled={blocked || !dirty}>
            保存规划
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy || !!pending || !dirty}
            onClick={() => setChanges(emptyFireChanges())}
          >
            放弃草稿
          </button>
        </div>
      </form>
      <section className="fire-observations">
        <h2>手填资产观察</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save(true);
          }}
        >
          <div className="fire-fields">
            <label>
              原币金额
              <input
                inputMode="decimal"
                value={amount}
                disabled={blocked}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
            </label>
            <label>
              观察币种
              <SelectMenu
                label="观察币种"
                value={assetCurrency}
                options={[
                  { value: "", label: "选择币种" },
                  ...fireCurrencies.map((value) => ({ value, label: value })),
                ]}
                variant="field"
                disabled={blocked}
                onChange={setAssetCurrency}
              />
            </label>
            {assetCurrency !== "USD" && (
              <label>
                美元金额（手填）
                <input
                  inputMode="decimal"
                  value={usd}
                  disabled={blocked}
                  onChange={(event) => setUsd(event.target.value)}
                  required
                />
              </label>
            )}
          </div>
          <button
            className="button"
            disabled={
              blocked ||
              !amount ||
              !assetCurrency ||
              (assetCurrency !== "USD" && !usd)
            }
          >
            记录观察
          </button>
        </form>
        <div className="fire-history" aria-label="手填资产观察记录">
          {history.map((raw, index) => {
            const row =
              raw && typeof raw === "object"
                ? (raw as Record<string, unknown>)
                : {};
            return (
              <div className="fire-history-row" key={index}>
                <time>{dateLabel(row.recordedAt)}</time>
                <span>
                  <PrivateAmount>
                    {fireText(row.amountBase) || "—"}
                  </PrivateAmount>{" "}
                  {fireText(row.currency) || "币种未知"}
                </span>
                {!(
                  row.currency === "USD" && row.amountBase === row.amountUsd
                ) && (
                  <span>
                    <PrivateAmount>
                      {fireText(row.amountUsd) || "—"}
                    </PrivateAmount>{" "}
                    USD
                  </span>
                )}
                <small>手填</small>
              </div>
            );
          })}
          {ready && history.length === 0 && <p>暂无资产观察</p>}
        </div>
      </section>
      <form
        className="fire-lookup"
        onSubmit={(event) => {
          event.preventDefault();
          void check(lookup.trim());
        }}
      >
        <label>
          操作编号
          <input
            value={lookup}
            disabled={locked}
            onChange={(event) => setLookup(event.target.value)}
          />
        </label>
        <button
          className="button secondary"
          disabled={busy || locked || !validId(lookup.trim())}
        >
          查询回执
        </button>
      </form>
    </section>
  );
}
