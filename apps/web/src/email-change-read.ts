/** A request ticket cannot survive refresh, hiding, or an identity boundary. */
export function emailReadGate() {
  let epoch = 0;
  let controller: AbortController | null = null;
  return {
    invalidate() {
      epoch++;
      controller?.abort();
      controller = null;
    },
    begin() {
      controller?.abort();
      const active = new AbortController();
      controller = active;
      const ticket = ++epoch;
      return {
        signal: active.signal,
        current: () => ticket === epoch && !active.signal.aborted,
      };
    },
  };
}
