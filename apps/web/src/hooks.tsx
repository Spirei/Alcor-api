import {
  managementReadAllowed,
  manualManagementRead,
} from "./management-read-policy";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { api } from "./api";
import { ResourceStore } from "./resource-store";

const ResourceContext = createContext<ResourceStore | null>(null);
function createStore() {
  return new ResourceStore(
    (path, signal) => {
      if (!managementReadAllowed(path)) throw new Error("内容暂时无法读取");
      return api(
        path,
        { signal },
        undefined,
        path === "/deployment" || path.startsWith("/deployment/")
          ? 30000
          : 10000,
      );
    },
    {
      isVisible: () => !document.hidden,
      manual: manualManagementRead,
    },
  );
}
function useStoreLifetime(store: ResourceStore, owned: boolean) {
  useEffect(() => {
    if (!owned) return;
    const release = store.retain();
    const visible = () => {
      if (!document.hidden) store.resume();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      release();
    };
  }, [store, owned]);
}
export function ResourceProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createStore);
  useStoreLifetime(store, true);
  return (
    <ResourceContext.Provider value={store}>
      {children}
    </ResourceContext.Provider>
  );
}
export function useResource<T>(path: string, poll = false) {
  const shared = useContext(ResourceContext);
  const [local] = useState(createStore);
  const store = shared || local;
  useStoreLifetime(store, !shared);
  const subscribe = useCallback(
    (notify: () => void) => store.subscribe(path, notify, poll),
    [store, path, poll],
  );
  const read = useCallback(() => store.snapshot(path), [store, path]);
  const snapshot = useSyncExternalStore(subscribe, read, read);
  const reload = useCallback(() => store.reload(path), [store, path]);
  return { ...snapshot, data: snapshot.data as T | null, reload };
}
export function useTaskInvalidation() {
  const store = useContext(ResourceContext);
  return useCallback(
    () =>
      store?.invalidate(["/tasks", "/system/overview", "/profile/activity"]),
    [store],
  );
}
export function useProfileInvalidation() {
  const store = useContext(ResourceContext);
  return useCallback(() => store?.invalidate(["/profile"]), [store]);
}
export function useConnectionInvalidation() {
  const store = useContext(ResourceContext);
  return useCallback(
    () => store?.invalidate(["/system/overview"], true),
    [store],
  );
}

export function useMigrationInvalidation() {
  const store = useContext(ResourceContext);
  return useCallback(
    () => store?.invalidate(["/system/migration?summary=1"]),
    [store],
  );
}

export function useDeploymentInvalidation() {
  const store = useContext(ResourceContext);
  return useCallback(() => store?.invalidate(["/deployment"], true), [store]);
}

const domainReads: Record<string, string[]> = {
  profile: ["/profile"],
  portfolio: [
    "/portfolio",
    "/records",
    "/account-assets",
    "/account/cash",
    "/account/fund",
    "/account/trading",
  ],
  brokers: ["/broker", "/account/broker", "/portfolio", "/account-assets"],
  watch: ["/watch", "/account/watch", "/records", "/portfolio"],
  alerts: ["/notifications", "/alerts", "/account/notifications"],
  resources: ["/resources", "/account/resources"],
  feed: ["/feed"],
  settings: [
    "/account/preferences",
    "/account/settings",
    "/fees",
    "/fire",
    "/cards",
  ],
  authorization: ["/account/", "/devices", "/sources", "/profile"],
};
export function useAccountInvalidation() {
  const store = useContext(ResourceContext);
  return useCallback(
    (domains: string[], discard: boolean) => {
      store?.invalidate(
        [...new Set(domains.flatMap((domain) => domainReads[domain] || []))],
        discard,
      );
    },
    [store],
  );
}
