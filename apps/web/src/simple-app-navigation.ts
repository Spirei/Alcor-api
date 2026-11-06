/** Same-document traversals must not destroy a typed ledger form before consent. */
const key = "alcorSimpleLedgerIndex";
const recoveryTarget = "alcorSimpleLedgerRecoveryTarget",
  recoveryFor = "alcorSimpleLedgerRecoveryFor";
type State = Record<string, unknown>;
type Entry = {
  url: string;
  state: State;
  index: number | null;
  routerIndex: number | null;
};
type Port = {
  read: () => { url: string; state: unknown };
  replace: (state: State, url: string) => void;
  push: (state: State, url: string) => void;
  move: (delta: number) => void;
  guarded: (url: string) => boolean;
  active: () => boolean;
  confirm: () => Promise<boolean>;
  apply: () => void;
};
const stateObject = (value: unknown): State =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : {};
const indexOf = (state: State) =>
  [state[key]].find(
    (value) =>
      typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
  ) as number | undefined;
const routerIndexOf = (state: State) =>
  typeof state.idx === "number" &&
  Number.isSafeInteger(state.idx) &&
  state.idx >= 0
    ? state.idx
    : null;
const distance = (from: Entry, to: Entry) =>
  from.index !== null && to.index !== null
    ? to.index - from.index
    : from.routerIndex !== null && to.routerIndex !== null
      ? to.routerIndex - from.routerIndex
      : 0;
const same = (a: Entry, b: Entry) =>
  a.url === b.url &&
  (a.index === null || b.index === null || a.index === b.index);
export class SimpleLedgerNavigation {
  private accepted: Entry;
  private restoring = false;
  private allowed: Entry | null = null;
  private pending: {
    target: Entry;
    answer?: boolean;
    recovery: boolean;
  } | null = null;
  private disposed = false;
  private unsafeTraversal = false;
  private recoveryPair: { id: string; index: number } | null = null;
  private port: Port;
  constructor(port: Port) {
    this.port = port;
    const current = port.read(),
      state = stateObject(current.state),
      index =
        indexOf(state) ??
        (typeof state.idx === "number" &&
        Number.isSafeInteger(state.idx) &&
        state.idx >= 0
          ? state.idx
          : 0);
    state[key] = index;
    port.replace(state, current.url);
    this.accepted = {
      url: current.url,
      state,
      index,
      routerIndex: routerIndexOf(state),
    };
    const recoveryId = state[recoveryFor];
    this.unsafeTraversal =
      typeof recoveryId === "string" ||
      typeof state[recoveryTarget] === "string";
    if (typeof recoveryId === "string")
      this.recoveryPair = { id: recoveryId, index };
  }
  push(url: string) {
    if (this.disposed || this.pending || this.restoring) return false;
    const current = stateObject(this.port.read().state),
      index = (this.accepted.index ?? 0) + 1;
    const state: State = {
      ...current,
      [key]: index,
      ...(typeof current.idx === "number" ? { idx: current.idx + 1 } : {}),
    };
    delete state[recoveryFor];
    delete state[recoveryTarget];
    this.recoveryPair = null;
    this.port.push(state, url);
    const actual = stateObject(this.port.read().state);
    this.accepted = {
      url,
      state: actual,
      index,
      routerIndex: routerIndexOf(actual),
    };
    return true;
  }
  /** true means the capture listener must withhold this event from the router. */
  pop(): boolean {
    if (this.disposed) return false;
    const current = this.port.read(),
      state = stateObject(current.state),
      target = {
        url: current.url,
        state,
        index: indexOf(state) ?? null,
        routerIndex: routerIndexOf(state),
      };
    if (this.restoring) {
      if (same(target, this.accepted)) {
        this.restoring = false;
        this.finish();
      } else this.restore(target);
      return true;
    }
    if (this.allowed && same(target, this.allowed)) {
      this.allowed = null;
      this.accepted = target;
      this.port.apply();
      return false;
    }
    if (this.pending && same(target, this.accepted)) return true;
    if (target.url === this.accepted.url || !this.port.guarded(target.url)) {
      this.accepted = target;
      this.port.apply();
      return false;
    }
    if (same(target, this.accepted)) return true;
    if (this.pending) {
      this.restore(target);
      return true;
    }
    const pending = { target, recovery: false } as NonNullable<
      SimpleLedgerNavigation["pending"]
    >;
    this.pending = pending;
    this.restore(target);
    void this.port.confirm().then(
      (answer) => {
        if (this.disposed || this.pending !== pending) return;
        pending.answer = answer && this.port.active();
        this.finish();
      },
      () => {
        if (this.disposed || this.pending !== pending) return;
        pending.answer = false;
        this.finish();
      },
    );
    return true;
  }
  private restore(target: Entry) {
    const adjacent =
      this.recoveryPair &&
      this.accepted.index === this.recoveryPair.index &&
      this.accepted.state[recoveryFor] === this.recoveryPair.id &&
      target.state[recoveryTarget] === this.recoveryPair.id;
    if (adjacent && this.pending) this.pending.recovery = true;
    const delta = adjacent
      ? 1
      : this.unsafeTraversal
        ? 0
        : distance(target, this.accepted);
    if (delta) {
      this.restoring = true;
      this.port.move(delta);
    } else {
      // No trustworthy traversal index: preserve the original target entry and
      // append one recovery anchor. push emits no pop event, so rejection cannot
      // recurse or overwrite the destination the user tried to reach.
      const source = this.accepted,
        index = (source.index ?? source.routerIndex ?? 0) + 1;
      this.unsafeTraversal = true;
      const id = crypto.randomUUID();
      target = { ...target, state: { ...target.state, [recoveryTarget]: id } };
      this.port.replace(target.state, target.url);
      const state: State = {
        ...source.state,
        [key]: index,
        [recoveryFor]: id,
        ...(typeof source.state.idx === "number"
          ? { idx: source.state.idx + 1 }
          : {}),
      };
      delete state[recoveryTarget];
      this.port.push(state, source.url);
      const actual = stateObject(this.port.read().state);
      this.accepted = {
        url: source.url,
        state: actual,
        index,
        routerIndex: routerIndexOf(actual),
      };
      this.recoveryPair = { id, index };
      this.restoring = false;
      if (this.pending) {
        this.pending.target = target;
        this.pending.recovery = true;
      }
    }
  }
  private finish() {
    const pending = this.pending;
    if (!pending || this.restoring || pending.answer === undefined) return;
    this.pending = null;
    if (!pending.answer || this.disposed || !this.port.active()) return;
    this.allowed = pending.target;
    if (pending.recovery) this.port.move(-1);
    else {
      const delta = distance(this.accepted, pending.target);
      if (delta) this.port.move(delta);
    }
  }
  dispose() {
    this.disposed = true;
    this.pending = null;
    this.allowed = null;
  }
}

export async function changeSimpleLedgerStep(
  current: string,
  next: string,
  hasEditing: boolean,
  confirm: () => Promise<boolean>,
  apply: (next: string) => void,
  isCurrent: () => boolean = () => true,
) {
  if (current === next) return false;
  if (hasEditing && !(await confirm())) return false;
  if (!isCurrent()) return false;
  apply(next);
  return true;
}
