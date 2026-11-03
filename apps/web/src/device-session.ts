/** Security lists are live views: hiding or changing identity discards the view. */
export function observeDeviceSession(
  page: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">,
  session: Pick<Window, "addEventListener" | "removeEventListener">,
  callbacks: {
    active: (value: boolean) => void;
    clear: () => void;
    read: () => void;
  },
): () => void {
  let enabled = true;
  const visibility = () => {
    if (page.hidden) callbacks.clear();
    else if (enabled) callbacks.read();
  };
  const expired = () => {
    enabled = false;
    callbacks.active(false);
    callbacks.clear();
  };
  callbacks.active(true);
  callbacks.clear();
  if (!page.hidden) callbacks.read();
  page.addEventListener("visibilitychange", visibility);
  session.addEventListener("alcor:session-expired", expired);
  return () => {
    enabled = false;
    callbacks.active(false);
    callbacks.clear();
    page.removeEventListener("visibilitychange", visibility);
    session.removeEventListener("alcor:session-expired", expired);
  };
}

export async function readDeviceState<T>(
  gate: { begin: () => { signal: AbortSignal; current: () => boolean } },
  read: (signal: AbortSignal) => Promise<T>,
  callbacks: {
    active: () => boolean;
    clear: () => void;
    publish: (value: T) => void;
    failed: (error: unknown) => void;
    done: () => void;
  },
): Promise<void> {
  const ticket = gate.begin();
  callbacks.clear();
  try {
    const value = await read(ticket.signal);
    if (ticket.current() && callbacks.active()) callbacks.publish(value);
  } catch (error) {
    if (ticket.current() && callbacks.active()) callbacks.failed(error);
  } finally {
    if (ticket.current() && callbacks.active()) callbacks.done();
  }
}
