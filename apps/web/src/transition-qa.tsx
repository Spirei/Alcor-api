/** Local opt-in measurement, removed from normal builds. No user data or credentials are recorded. */
import { useLayoutEffect } from "react";

const enabled =
  import.meta.env.VITE_UI_PERF === "1" &&
  ["127.0.0.1", "localhost"].includes(location.hostname);
const delay = enabled
  ? Math.min(1500, Math.max(0, Number(import.meta.env.VITE_UI_DELAY_MS) || 0))
  : 0;
type Sample = {
  seq: number;
  path: string;
  start: number;
  commitMs: number | null;
  contentMs: number | null;
  twoRafMs: number | null;
};
const samples: Sample[] = [];
const reads: Record<string, number> = {};
let pending: Sample | null = null;
const round = (n: number) => Math.round(n * 10) / 10;
function publish() {
  if (!enabled) return;
  const output = document.querySelector<HTMLOutputElement>(
    "[data-transition-qa]",
  );
  if (!output) return;
  output.textContent = JSON.stringify({
    viewport: { width: innerWidth, height: innerHeight },
    delayMs: delay,
    reads,
    samples,
  });
  const completed = samples.filter((s) => s.contentMs !== null).at(-1);
  output.dataset.completedSeq = String(completed?.seq || 0);
  output.dataset.framesSeq = String(
    samples.filter((s) => s.twoRafMs !== null).at(-1)?.seq || 0,
  );
}
export function beginNavigation(path: string) {
  if (!enabled || path === location.pathname) return;
  pending = {
    seq: (samples.at(-1)?.seq || 0) + 1,
    path,
    start: performance.now(),
    commitMs: null,
    contentMs: null,
    twoRafMs: null,
  };
  samples.push(pending);
  if (samples.length > 40) samples.shift();
  publish();
}
export function useNavigationCommit(path: string) {
  useLayoutEffect(() => {
    if (!enabled || pending?.path !== path) return;
    const row = pending;
    row.commitMs = round(performance.now() - row.start);
    publish();
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        row.twoRafMs = round(performance.now() - row.start);
        publish();
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [path]);
}
export function usePanelReady(path: string, ready: boolean) {
  useLayoutEffect(() => {
    if (
      enabled &&
      ready &&
      pending?.path === path &&
      pending.contentMs === null
    ) {
      pending.contentMs = round(performance.now() - pending.start);
      publish();
    }
  }, [path, ready]);
}
export function readStarted(path: string) {
  if (!enabled) return;
  const group = path.startsWith("/tasks") ? "tasks" : path.split("?")[0];
  reads[group] = (reads[group] || 0) + 1;
  publish();
}
export async function delayRead(signal: AbortSignal) {
  if (!delay) return;
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const aborted = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", aborted);
      resolve();
    }, delay);
    signal.addEventListener("abort", aborted, { once: true });
  });
}
export function TransitionQA() {
  useLayoutEffect(() => {
    publish();
  }, []);
  return enabled ? (
    <output
      data-transition-qa
      aria-label="本地切换验收"
      style={{
        position: "fixed",
        right: 8,
        bottom: 8,
        zIndex: 1000,
        width: 420,
        maxWidth: "95vw",
        maxHeight: 140,
        overflow: "auto",
        fontSize: 10,
        lineHeight: 1.4,
        background: "#fff",
        color: "#111",
        border: "1px solid #bbb",
        padding: 8,
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}
    />
  ) : null;
}
