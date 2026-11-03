/** Scoped, memory-only management reads. These snapshots never authorize a write. */
export type ReadSnapshot = {
  data: unknown | null;
  error: string;
  refreshing: boolean;
  updatedAt: number | null;
};
type Listener = () => void;
type Entry = {
  key: string;
  snapshot: ReadSnapshot;
  listeners: Map<Listener, boolean>;
  generation: number;
  controller: AbortController | null;
  flight: Promise<void> | null;
  timer: ReturnType<typeof setTimeout> | null;
  dirty: boolean;
  used: number;
};
export type StoreClock = {
  now: () => number;
  set: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clear: (timer: ReturnType<typeof setTimeout>) => void;
};
type Loader = (path: string, signal: AbortSignal) => Promise<unknown>;
export class ResourceStore {
  private entries = new Map<string, Entry>();
  private loader: Loader;
  private clock: StoreClock;
  private visible: () => boolean;
  private limit: number;
  private manual: (key: string) => boolean;
  private disposed = false;
  private blocked = false;
  private holds = 0;
  constructor(
    loader: Loader,
    options: {
      isVisible?: () => boolean;
      manual?: (key: string) => boolean;
      limit?: number;
      clock?: StoreClock;
    } = {},
  ) {
    this.loader = loader;
    this.clock = options.clock || {
      now: () => Date.now(),
      set: (run, ms) => setTimeout(run, ms),
      clear: (timer) => clearTimeout(timer),
    };
    this.visible = options.isVisible || (() => true);
    this.limit = options.limit || 32;
    this.manual = options.manual || (() => false);
  }
  retain() {
    this.holds++;
    this.disposed = false;
    return () => {
      this.holds--;
      queueMicrotask(() => {
        if (this.holds === 0) this.dispose();
      });
    };
  }
  private entry(key: string) {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        key,
        snapshot: {
          data: null,
          error: this.blocked ? "访问权限已变化，请重新核对" : "",
          refreshing: false,
          updatedAt: null,
        },
        listeners: new Map(),
        generation: 0,
        controller: null,
        flight: null,
        timer: null,
        dirty: true,
        used: this.clock.now(),
      };
      this.entries.set(key, entry);
      this.trim(entry);
    }
    return entry;
  }
  snapshot(key: string) {
    return this.entry(key).snapshot;
  }
  subscribe(key: string, listener: Listener, poll: boolean) {
    const entry = this.entry(key);
    entry.used = this.clock.now();
    entry.listeners.set(listener, poll);
    if (entry.listeners.size === 1 && (!this.manual(key) || entry.dirty))
      void this.read(entry);
    return () => {
      entry.listeners.delete(listener);
      if (!entry.listeners.size) this.clearTimer(entry);
      this.trim();
    };
  }
  private publish(entry: Entry, patch: Partial<ReadSnapshot>) {
    entry.snapshot = { ...entry.snapshot, ...patch };
    entry.listeners.forEach((_, listener) => listener());
  }
  private clearTimer(entry: Entry) {
    if (entry.timer !== null) this.clock.clear(entry.timer);
    entry.timer = null;
  }
  private trim(protect?: Entry) {
    if (this.entries.size <= this.limit) return;
    for (const entry of [...this.entries.values()]
      .filter((e) => !e.listeners.size && e !== protect)
      .sort((a, b) => a.used - b.used)) {
      if (this.entries.size <= this.limit) break;
      this.clearTimer(entry);
      entry.controller?.abort();
      entry.generation++;
      this.entries.delete(entry.key);
    }
  }
  private schedule(entry: Entry) {
    this.clearTimer(entry);
    if (
      this.disposed ||
      this.blocked ||
      this.manual(entry.key) ||
      ![...entry.listeners.values()].some(Boolean)
    )
      return;
    entry.timer = this.clock.set(() => {
      entry.timer = null;
      if (this.visible()) void this.read(entry);
    }, 5000);
  }
  private rejectAuthorization(message: string) {
    this.blocked = true;
    for (const entry of this.entries.values()) {
      entry.generation++;
      entry.dirty = false;
      this.clearTimer(entry);
      entry.controller?.abort();
      this.publish(entry, {
        data: null,
        error: message,
        refreshing: false,
        updatedAt: null,
      });
    }
  }
  private async read(entry: Entry) {
    if (
      this.disposed ||
      this.blocked ||
      !this.visible() ||
      !entry.listeners.size ||
      this.entries.get(entry.key) !== entry
    )
      return;
    if (entry.flight) return entry.flight;
    this.clearTimer(entry);
    entry.dirty = false;
    const generation = entry.generation,
      controller = new AbortController();
    entry.controller = controller;
    this.publish(entry, { refreshing: true });
    entry.flight = Promise.resolve().then(async () => {
      try {
        const data = await this.loader(entry.key, controller.signal);
        if (
          !this.disposed &&
          this.entries.get(entry.key) === entry &&
          entry.generation === generation &&
          !controller.signal.aborted
        )
          this.publish(entry, {
            data,
            error: "",
            refreshing: false,
            updatedAt: this.clock.now(),
          });
      } catch (error) {
        if (
          this.disposed ||
          this.entries.get(entry.key) !== entry ||
          entry.generation !== generation ||
          controller.signal.aborted
        )
          return;
        const status = (error as { status?: number })?.status;
        if (status === 401 || status === 403) {
          this.rejectAuthorization("访问权限已变化，请重新核对");
          return;
        }
        this.publish(entry, {
          ...(status === 404 ? { data: null, updatedAt: null } : {}),
          error: error instanceof Error ? error.message : "读取失败",
          refreshing: false,
        });
      } finally {
        entry.flight = null;
        entry.controller = null;
        if (this.disposed || this.entries.get(entry.key) !== entry) return;
        if (entry.dirty && !this.blocked) void this.read(entry);
        else this.schedule(entry);
      }
    });
    return entry.flight;
  }
  reload(key: string) {
    this.blocked = false;
    const entry = this.entry(key);
    entry.generation++;
    entry.dirty = true;
    entry.controller?.abort();
    void this.read(entry);
  }
  invalidate(prefixes: string[], discard = false) {
    for (const entry of this.entries.values())
      if (prefixes.some((p) => entry.key.startsWith(p))) {
        entry.generation++;
        entry.dirty = true;
        entry.controller?.abort();
        if (discard)
          this.publish(entry, { data: null, updatedAt: null, error: "" });
        void this.read(entry);
      }
  }
  resume() {
    if (!this.visible() || this.blocked) return;
    for (const entry of this.entries.values())
      if (entry.listeners.size && (!this.manual(entry.key) || entry.dirty))
        void this.read(entry);
  }
  dispose() {
    this.disposed = true;
    for (const entry of this.entries.values()) {
      entry.generation++;
      this.clearTimer(entry);
      entry.controller?.abort();
      entry.listeners.clear();
      entry.snapshot = {
        data: null,
        error: "",
        refreshing: false,
        updatedAt: null,
      };
    }
    this.entries.clear();
  }
  get size() {
    return this.entries.size;
  }
}
