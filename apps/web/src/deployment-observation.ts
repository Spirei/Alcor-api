/** A lost publication response can only be followed by bounded reads of its original UUID. */
export type RequestObservation = { request_id: string; started_at: number };
export const observationWindow = 15 * 60000;

export function createRequestLifetime() {
  let generation = 0,
    active = false;
  return {
    activate() {
      active = true;
      const current = ++generation;
      return () => {
        if (generation === current) {
          active = false;
          generation++;
        }
      };
    },
    capture() {
      const current = generation;
      return () => active && generation === current;
    },
  };
}

export function requestObservation(
  previous: RequestObservation | undefined,
  request_id: string,
  created_at?: string,
  now = Date.now(),
): RequestObservation {
  if (previous?.request_id === request_id) return previous;
  const created = Date.parse(created_at || "");
  return {
    request_id,
    started_at: Number.isFinite(created) ? Math.min(created, now) : now,
  };
}

export function observationActive(
  observation: RequestObservation,
  now = Date.now(),
) {
  return now < observation.started_at + observationWindow;
}

export async function sendObservedRequest<T>(
  id: string,
  start: (id: string) => void,
  send: () => Promise<T>,
): Promise<T> {
  start(id);
  return send();
}

type Clock = {
  now: () => number;
  set: (run: () => void, delay: number) => unknown;
  clear: (timer: unknown) => void;
};
const clock: Clock = {
  now: Date.now,
  set: (run, delay) => setTimeout(run, delay),
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export function observeOriginalRequest<T>(
  observation: RequestObservation,
  options: {
    read: (id: string, signal: AbortSignal) => Promise<T>;
    result: (result: T) => boolean;
    error: (error: unknown) => boolean;
    expired: (id: string) => void;
    hidden: () => boolean;
    visibility: (resume: () => void) => () => void;
    current?: () => boolean;
    clock?: Clock;
  },
) {
  const time = options.clock || clock;
  let stopped = false,
    reading = false,
    timer: unknown,
    deadline: unknown,
    controller: AbortController | undefined;
  function stop() {
    stopped = true;
    time.clear(timer);
    time.clear(deadline);
    controller?.abort();
  }
  function expire() {
    if (stopped) return;
    stop();
    if (options.current?.() !== false) options.expired(observation.request_id);
  }
  function schedule(delay: number) {
    if (stopped) return;
    time.clear(timer);
    const remaining = observation.started_at + observationWindow - time.now();
    if (remaining <= 0) {
      expire();
    } else timer = time.set(() => void read(), Math.min(delay, remaining));
  }
  async function read() {
    if (stopped || reading) return;
    if (options.current?.() === false) return stop();
    if (!observationActive(observation, time.now())) return schedule(0);
    if (options.hidden()) return schedule(observationWindow);
    reading = true;
    controller = new AbortController();
    let delay = 5000;
    try {
      const result = await options.read(
        observation.request_id,
        controller.signal,
      );
      if (!stopped && options.current?.() !== false && !options.result(result))
        stop();
    } catch (error) {
      delay = 15000;
      if (
        !stopped &&
        !controller.signal.aborted &&
        options.current?.() !== false &&
        !options.error(error)
      )
        stop();
    } finally {
      reading = false;
      if (options.current?.() === false) stop();
      else schedule(options.hidden() ? observationWindow : delay);
    }
  }
  const unsubscribe = options.visibility(() => {
    if (options.hidden()) {
      controller?.abort();
      schedule(observationWindow);
    } else {
      time.clear(timer);
      void read();
    }
  });
  deadline = time.set(
    expire,
    Math.max(0, observation.started_at + observationWindow - time.now()),
  );
  schedule(5000);
  return () => {
    stop();
    unsubscribe();
  };
}
