import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { api, type Session } from "./api";
import {
  AccountChangeObserver,
  accountDomains,
  type AccountChange,
  type AccountSignal,
} from "./account-change-observer";
import { useAccountInvalidation } from "./hooks";
type Listener = (change: AccountChange) => void;
const AccountChanges = createContext<Set<Listener> | null>(null);
export function AccountChangeProvider({
  session,
  children,
}: {
  session: Session;
  children: ReactNode;
}) {
  const identity = JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.receipt_scope,
    session.csrf,
    session.expires_at,
  ]);
  const listeners = useMemo(() => new Set<Listener>(), [identity]);
  const invalidate = useAccountInvalidation();
  useEffect(() => {
    const observer = new AccountChangeObserver({
      identity: {
        instanceId: session.instance_id,
        userId: session.user.id,
        role: session.user.role,
      },
      read: (signal, context) =>
        api<AccountSignal>("/account/changes", {
          signal,
          headers: context ? { "X-Alcor-Context": context } : undefined,
        }),
      visible: () => !document.hidden,
      changed: (change) => {
        invalidate(
          change.retire ? accountDomains : change.domains,
          change.retire,
        );
        listeners.forEach((listener) => {
          try {
            listener(change);
          } catch {
            console.error("Account change listener failed");
          }
        });
      },
      retired: () => window.dispatchEvent(new Event("alcor:session-recheck")),
    });
    const visible = () =>
      document.hidden ? observer.pause() : observer.resume();
    const online = () => observer.resume();
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", online);
    observer.resume();
    return () => {
      observer.dispose();
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", online);
    };
  }, [identity, invalidate, listeners]);
  return (
    <AccountChanges.Provider value={listeners}>
      {children}
    </AccountChanges.Provider>
  );
}
export function useAccountChanges(domains: string[], onChange: Listener) {
  const listeners = useContext(AccountChanges),
    callback = useRef(onChange);
  callback.current = onChange;
  const key = domains.join("|");
  useEffect(() => {
    const accepted = new Set(key.split("|"));
    const listener: Listener = (change) => {
      if (
        change.retire ||
        change.domains.some((domain) => accepted.has(domain))
      )
        callback.current(change);
    };
    listeners?.add(listener);
    return () => {
      listeners?.delete(listener);
    };
  }, [listeners, key]);
}
