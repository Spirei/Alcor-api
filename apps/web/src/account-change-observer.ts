export const accountDomains = [
  "profile",
  "portfolio",
  "watch",
  "brokers",
  "alerts",
  "resources",
  "feed",
  "settings",
  "authorization",
];
export type AccountChange = { domains: string[]; retire: boolean };
export type AccountSignal = {
  userId: string;
  instanceId: string;
  context: string;
  epoch: string;
  binding: {
    userId: string;
    instanceId: string;
    role: string;
    principal: string;
    scopes: string[];
    sessionVersion: number;
    apiVersion: number;
  };
  domains: Record<
    string,
    { state: string; revision: number | null; commitSignalComplete: boolean }
  >;
};
type Identity = { userId: string; instanceId: string; role: string };
type Clock = {
  set: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clear: (id: ReturnType<typeof setTimeout>) => void;
};
type ObserverOptions = {
  identity: Identity;
  read: (signal: AbortSignal, context?: string) => Promise<AccountSignal>;
  visible: () => boolean;
  changed: (change: AccountChange) => void;
  retired: () => void;
  clock?: Clock;
};
function validate(value: AccountSignal, identity: Identity) {
  const b = value?.binding;
  if (
    !b ||
    value.userId !== identity.userId ||
    value.instanceId !== identity.instanceId ||
    b.userId !== identity.userId ||
    b.instanceId !== identity.instanceId ||
    b.role !== identity.role ||
    !b.principal ||
    !Array.isArray(b.scopes) ||
    !b.scopes.every((s) => typeof s === "string") ||
    !Number.isSafeInteger(b.sessionVersion) ||
    b.apiVersion !== 1 ||
    !/^[a-f0-9]{64}$/.test(value.context) ||
    !value.epoch ||
    !value.domains
  )
    throw new Error("account_change_binding");
  for (const name of accountDomains) {
    const domain = value.domains[name];
    if (
      !domain ||
      !["observed", "partial", "unavailable", "forbidden"].includes(
        domain.state,
      ) ||
      typeof domain.commitSignalComplete !== "boolean" ||
      !(
        domain.revision === null ||
        (Number.isSafeInteger(domain.revision) && domain.revision >= 0)
      )
    )
      throw new Error("account_change_payload");
  }
}
export function accountSignalDelta(
  previous: AccountSignal | null,
  next: AccountSignal,
  identity: Identity,
): AccountChange {
  validate(next, identity);
  if (
    previous &&
    (previous.context !== next.context ||
      JSON.stringify(previous.binding) !== JSON.stringify(next.binding))
  )
    throw new Error("account_change_binding");
  if (previous && previous.epoch !== next.epoch)
    return { domains: [...accountDomains], retire: true };
  const changed = accountDomains.filter((name) => {
    const a = previous?.domains[name],
      b = next.domains[name];
    return a
      ? a.revision !== b.revision ||
          a.state !== b.state ||
          a.commitSignalComplete !== b.commitSignalComplete ||
          (b.state !== "observed" && b.state !== "forbidden") ||
          (!b.commitSignalComplete && b.state !== "forbidden")
      : true;
  });
  return {
    domains: changed,
    retire: changed.some((name) => {
      const a = previous?.domains[name],
        b = next.domains[name];
      return (
        b.state === "forbidden" ||
        (!!a &&
          a.revision !== null &&
          (b.revision === null || b.revision < a.revision))
      );
    }),
  };
}
/** These cursors invalidate reads; they never confirm a balance or financial operation. */
export class AccountChangeObserver {
  private previous: AccountSignal | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flight: AbortController | null = null;
  private stopped = false;
  private failures = 0;
  private clock: Clock;
  private options: ObserverOptions;
  constructor(options: ObserverOptions) {
    this.options = options;
    this.clock = options.clock || {
      set: (run, ms) => setTimeout(run, ms),
      clear: (id) => clearTimeout(id),
    };
  }
  private clear() {
    if (this.timer !== null) this.clock.clear(this.timer);
    this.timer = null;
  }
  pause() {
    this.clear();
    this.flight?.abort();
    this.flight = null;
  }
  dispose() {
    this.stopped = true;
    this.pause();
    this.previous = null;
  }
  resume() {
    if (this.stopped || !this.options.visible() || this.flight) return;
    this.clear();
    const request = new AbortController();
    this.flight = request;
    void this.options
      .read(request.signal, this.previous?.context)
      .then((value) => {
        if (
          this.stopped ||
          request.signal.aborted ||
          this.flight !== request ||
          !this.options.visible()
        )
          return;
        const change = accountSignalDelta(
          this.previous,
          value,
          this.options.identity,
        );
        this.previous = value;
        this.failures = 0;
        if (change.domains.length) this.options.changed(change);
      })
      .catch((error: unknown) => {
        if (this.stopped || request.signal.aborted || this.flight !== request)
          return;
        const status = (error as { status?: number })?.status;
        if (
          status === 401 ||
          status === 403 ||
          (error instanceof Error && error.message === "account_change_binding")
        ) {
          this.options.changed({ domains: [...accountDomains], retire: true });
          this.dispose();
          this.options.retired();
        } else this.failures++;
      })
      .finally(() => {
        if (this.flight !== request) return;
        this.flight = null;
        if (!this.stopped && this.options.visible())
          this.timer = this.clock.set(
            () => this.resume(),
            Math.min(60000, 15000 * 2 ** Math.min(this.failures, 2)),
          );
      });
  }
}
