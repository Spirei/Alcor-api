import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
/** Read-only existing licensed history; this component never registers demand or calls a source. */
type Version = {
  revision: string;
  usable: boolean;
  revoked: boolean;
  policy: {
    source: string;
    historyFrames?: string[];
    historyMarkets?: string[];
    historyInstruments?: string[];
    historyAdjustments?: string[];
  } | null;
};
type Fact = {
  factId: string;
  at: string;
  c: string | null;
  pageId?: string;
  sourcePageId?: string;
};
const choices = [
  {
    id: "spy",
    name: "标普500 ETF（SPY，代理基准）",
    instrument: "equity",
    market: "US",
    code: "SPY",
  },
  {
    id: "qqq",
    name: "纳斯达克 ETF（QQQ，代理基准）",
    instrument: "equity",
    market: "US",
    code: "QQQ",
  },
  {
    id: "dia",
    name: "道琼斯 ETF（DIA，代理基准）",
    instrument: "equity",
    market: "US",
    code: "DIA",
  },
  {
    id: "hsi",
    name: "恒生 ETF（02800，代理基准）",
    instrument: "equity",
    market: "HK",
    code: "02800",
  },
  {
    id: "sse",
    name: "上证指数（真实指数，非ETF）",
    instrument: "index",
    market: "CN",
    code: "000001",
  },
];
export function SimpleBenchmark({ active }: { active: boolean }) {
  const [versions, setVersions] = useState<Version[]>([]),
    [source, setSource] = useState(""),
    [choice, setChoice] = useState("spy"),
    [adjust, setAdjust] = useState(""),
    [from, setFrom] = useState(""),
    [through, setThrough] = useState(""),
    [facts, setFacts] = useState<Fact[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState(false);
  const epoch = useRef(0),
    controller = useRef<AbortController | null>(null),
    alive = useRef(active);
  alive.current = active;
  function invalidate() {
    epoch.current++;
    controller.current?.abort();
    setFacts([]);
    setMessage("");
    setBusy(false);
  }
  function clear() {
    epoch.current++;
    controller.current?.abort();
    setVersions([]);
    setSource("");
    setFacts([]);
    setMessage("");
    setBusy(false);
  }
  useEffect(() => {
    if (!active) clear();
    return () => {
      epoch.current++;
      controller.current?.abort();
    };
  }, [active]);
  useEffect(() => {
    const hide = () => {
      if (document.hidden) clear();
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);
  async function readSources() {
    if (!active || document.hidden || busy) return;
    const run = ++epoch.current,
      c = new AbortController();
    controller.current = c;
    setBusy(true);
    try {
      const result = await api<{ versions: Version[] }>("/market/sources", {
        signal: c.signal,
      });
      if (run === epoch.current && alive.current && !document.hidden) {
        const usable = result.versions.filter(
          (v) =>
            v.usable && !v.revoked && v.policy?.historyFrames?.includes("day"),
        );
        setVersions(usable);
        if (source && !usable.some((v) => v.revision === source)) {
          invalidate();
          setSource("");
          setMessage("原来源许可已不可用，已撤下保留展示");
        }
      }
    } catch (e) {
      if (run === epoch.current) {
        if (e instanceof ApiError && [401, 403].includes(e.status)) clear();
        setMessage(e instanceof Error ? e.message : "来源暂不可读");
      }
    } finally {
      if (run === epoch.current) setBusy(false);
    }
  }
  async function read() {
    const benchmark = choices.find((v) => v.id === choice),
      version = versions.find((v) => v.revision === source);
    if (!benchmark || !version || !adjust || !active || busy || document.hidden)
      return;
    const run = ++epoch.current,
      c = new AbortController();
    controller.current = c;
    setBusy(true);
    setFacts([]);
    setMessage("");
    try {
      const params = new URLSearchParams({
        source_revision: source,
        market: benchmark.market,
        code: benchmark.code,
        instrument: benchmark.instrument,
        kind: "bars",
        frame: "day",
        adjust,
        session: "REGULAR",
        limit: "3000",
        ...(from ? { start: from } : {}),
        ...(through ? { through } : {}),
      });
      const value = await api<{
        facts: Fact[];
        coverage: { assurance?: string };
        pagination?: { hasMore?: boolean };
      }>("/market/history?" + params, { signal: c.signal });
      if (run === epoch.current && alive.current && !document.hidden) {
        setFacts(value.facts);
        setMessage(
          `只读保留日线，覆盖 ${value.coverage?.assurance || "未核实"}${value.pagination?.hasMore ? "；范围仍有后续，当前不是完整历史" : ""}`,
        );
      }
    } catch (e) {
      if (run === epoch.current) {
        if (e instanceof ApiError && [401, 403].includes(e.status)) clear();
        setMessage(e instanceof Error ? e.message : "基准未有已许可保留事实");
      }
    } finally {
      if (run === epoch.current) setBusy(false);
    }
  }
  const chosen = choices.find((v) => v.id === choice)!,
    version = versions.find((v) => v.revision === source),
    first = facts.find(
      (v) => v.c !== null && Number.isFinite(Number(v.c)) && Number(v.c) > 0,
    );
  const base = first ? Number(first.c) : null;
  return (
    <details
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (!event.currentTarget.open) clear();
      }}
    >
      <summary>查看独立许可的已保留市场基准（不采集）</summary>
      {open && (
        <>
          <p>
            ETF代理基准与本人投资收益独立展示；没有原件或许可不补行情，不以当前价格倒推过去。为避免虚假对齐，按来源实际日期逐条展示。
          </p>
          <button disabled={busy || !active} onClick={() => void readSources()}>
            读取当前可用历史来源
          </button>
          <label>
            明确来源
            <select
              value={source}
              onChange={(e) => {
                invalidate();
                setSource(e.target.value);
                setAdjust("");
                setFacts([]);
              }}
            >
              <option value="">请选择已安装版本</option>
              {versions.map((v) => (
                <option key={v.revision} value={v.revision}>
                  {v.policy?.source} · {v.revision}
                </option>
              ))}
            </select>
          </label>
          <label>
            基准
            <select
              value={choice}
              onChange={(e) => {
                invalidate();
                setChoice(e.target.value);
                setFacts([]);
              }}
            >
              {choices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            复权口径
            <select
              value={adjust}
              onChange={(e) => {
                invalidate();
                setAdjust(e.target.value);
              }}
            >
              <option value="">请选择</option>
              {version?.policy?.historyAdjustments?.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            开始日期
            <input
              type="date"
              value={from}
              onChange={(e) => {
                invalidate();
                setFrom(e.target.value);
              }}
            />
          </label>
          <label>
            结束日期
            <input
              type="date"
              value={through}
              onChange={(e) => {
                invalidate();
                setThrough(e.target.value);
              }}
            />
          </label>
          <button
            disabled={
              !source ||
              !adjust ||
              busy ||
              !active ||
              !version?.policy?.historyMarkets?.includes(chosen.market) ||
              !version?.policy?.historyInstruments?.includes(chosen.instrument)
            }
            onClick={() => void read()}
          >
            只读已保留基准观察
          </button>
          {message && <p role="status">{message}</p>}
          <table>
            <thead>
              <tr>
                <th>来源日期</th>
                <th>原收盘价</th>
                <th>相对首个已观察收盘变化（近似）</th>
              </tr>
            </thead>
            <tbody>
              {facts.map((row) => (
                <tr key={row.factId}>
                  <td>{row.at}</td>
                  <td>{row.c ?? "未知"}</td>
                  <td>
                    {base !== null &&
                    row.c !== null &&
                    Number.isFinite(Number(row.c)) &&
                    Number(row.c) > 0 &&
                    Number.isFinite(Number(row.c) / base)
                      ? ((Number(row.c) / base - 1) * 100).toFixed(6) + " %"
                      : "未知"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </details>
  );
}
