import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, ApiError } from "./api";
import type { Session } from "./api";
import { defaultAppearance, parseAppearance } from "./appearance-preferences";
import type { AppearanceController } from "./use-appearance";
import {
  readPreferenceDraft,
  rebasePreferenceDraft,
  savePreferenceDraft,
} from "./preference-draft";
import type {
  AvatarStatus,
  Preferences,
  PreferencePatch as Patch,
} from "./preference-draft";
export type { AvatarStatus } from "./preference-draft";
import { AccountPreferenceContext as Context } from "./account-preference-context";
export {
  useAccountStatus,
  useAccountAppearance,
} from "./account-preference-context";
export function AccountPreferencesProvider({
  session,
  appearance,
  children,
}: {
  session: Session;
  appearance: AppearanceController;
  children: ReactNode;
}) {
  const key =
    "alcor.account-preferences." + session.instance_id + "." + session.user.id;
  const appearanceKey = key + ".appearance";
  const draftScope = JSON.stringify([
    session.instance_id,
    session.user.id,
    session.user.role,
    session.expires_at,
  ]);
  const [status, setStatus] = useState<AvatarStatus>("online"),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const live = useRef(true),
    loaded = useRef(false),
    saving = useRef(false),
    paused = useRef(false);
  const revision = useRef<string | null>(null),
    queue = useRef<Patch>({}),
    flight = useRef<Patch | null>(null),
    baseline = useRef<Preferences>({
      appearance: defaultAppearance(),
      avatar_status: "online",
      revision: null,
    }),
    autoRetries = useRef(0);
  const initialEdit = useRef(appearance.editVersion.current),
    retryRead = useRef<() => void>(() => {});
  const current = useRef(appearance),
    statusRef = useRef(status),
    lastAppearance = useRef("");
  current.current = appearance;
  statusRef.current = status;
  function cache(value = current.current.settings) {
    try {
      localStorage.setItem(appearanceKey, JSON.stringify(value));
      localStorage.setItem(key + ".status", statusRef.current);
    } catch {
      /* PG remains authoritative. */
    }
  }
  function persistDraft() {
    if (!live.current) return;
    const patch = { ...flight.current, ...queue.current };
    try {
      savePreferenceDraft(
        sessionStorage,
        draftScope,
        Object.keys(patch).length
          ? {
              revision: revision.current,
              patch,
              base: baseline.current,
            }
          : null,
      );
    } catch {
      /* Keep the live queue; a failed save stays visible. */
    }
  }
  function normalized(value: Preferences): Preferences {
    return {
      ...value,
      appearance: parseAppearance(value.appearance || defaultAppearance()),
    };
  }
  function showPatch(remote: Preferences, patch: Patch) {
    const chosen = parseAppearance(patch.appearance || remote.appearance);
    lastAppearance.current = JSON.stringify(chosen);
    current.current.replace(chosen);
    statusRef.current = patch.avatar_status || remote.avatar_status;
    setStatus(statusRef.current);
    cache(chosen);
  }
  async function flush(force = false) {
    if (
      !live.current ||
      !loaded.current ||
      saving.current ||
      (paused.current && !force) ||
      !Object.keys(queue.current).length
    )
      return;
    saving.current = true;
    if (force && paused.current) {
      try {
        const remote = normalized(
          await api<Preferences>("/account/preferences"),
        );
        if (!live.current) return;
        const resolved = rebasePreferenceDraft(
          remote,
          {
            revision: revision.current,
            patch: queue.current,
            base: baseline.current,
          },
          true,
        );
        queue.current = resolved.kind === "saved" ? {} : resolved.patch;
        revision.current = remote.revision;
        baseline.current = remote;
        showPatch(remote, resolved.patch);
        if (!Object.keys(queue.current).length) {
          paused.current = false;
          saving.current = false;
          setError("");
          persistDraft();
          return;
        }
      } catch (e) {
        if (live.current)
          setError(e instanceof Error ? e.message : "账户设置核对失败");
        saving.current = false;
        return;
      }
    }
    paused.current = false;
    const patch = queue.current;
    queue.current = {};
    flight.current = patch;
    persistDraft();
    try {
      const result = await api<Preferences>(
        "/account/preferences",
        {
          method: "PATCH",
          keepalive: true,
          body: JSON.stringify({ ...patch, revision: revision.current }),
        },
        session.csrf,
      );
      if (!live.current) return;
      revision.current = result.revision;
      baseline.current = normalized(result);
      setError("");
      cache();
      try {
        localStorage.setItem(key + ".committed", String(result.revision));
      } catch {}
    } catch (e) {
      if (!live.current) return;
      queue.current = { ...patch, ...queue.current };
      paused.current = true;
      if (e instanceof ApiError && e.status === 409) {
        try {
          const remote = normalized(
            await api<Preferences>("/account/preferences"),
          );
          if (!live.current) return;
          const resolved = rebasePreferenceDraft(remote, {
            revision: revision.current,
            patch: queue.current,
            base: baseline.current,
          });
          if (resolved.kind === "saved") {
            queue.current = {};
            revision.current = remote.revision;
            baseline.current = remote;
            paused.current = false;
            showPatch(remote, resolved.patch);
          } else if (resolved.kind === "retry" && autoRetries.current++ < 1) {
            queue.current = resolved.patch;
            revision.current = remote.revision;
            baseline.current = remote;
            paused.current = false;
            showPatch(remote, resolved.patch);
          }
        } catch {
          /* Retain the intent and original version for a later check. */
        }
      }
      if (live.current)
        setError(
          paused.current
            ? e instanceof Error
              ? e.message
              : "账户设置保存失败"
            : "",
        );
    } finally {
      flight.current = null;
      saving.current = false;
      persistDraft();
      if (live.current && !paused.current) void flush();
    }
  }
  function enqueue(patch: Patch) {
    queue.current = { ...queue.current, ...patch };
    autoRetries.current = 0;
    persistDraft();
    void flush();
  }
  useLayoutEffect(() => {
    live.current = true;
    current.current.bindStorage(appearanceKey);
    let cached: unknown = null;
    try {
      cached = JSON.parse(localStorage.getItem(appearanceKey) || "null");
    } catch {}
    const initial = parseAppearance(cached || defaultAppearance());
    lastAppearance.current = JSON.stringify(initial);
    baseline.current = {
      appearance: initial,
      avatar_status: "online",
      revision: null,
    };
    current.current.replace(initial);
    return () => {
      live.current = false;
      current.current.bindStorage(null);
      queueMicrotask(() => {
        if (!live.current) {
          try {
            savePreferenceDraft(sessionStorage, draftScope, null);
          } catch {}
        }
      });
    };
  }, [key]);
  useEffect(() => {
    let controller: AbortController | null = null;
    const load = () => {
      if (saving.current) return;
      const first = !loaded.current;
      let restored = null;
      if (first)
        try {
          restored = readPreferenceDraft(
            sessionStorage,
            draftScope,
            parseAppearance,
          );
        } catch {}
      controller?.abort();
      const request = new AbortController();
      controller = request;
      void api<Preferences>("/account/preferences", { signal: request.signal })
        .then((raw) => {
          const result = normalized(raw);
          if (!live.current || request.signal.aborted || saving.current) return;
          const intent = Object.keys(queue.current).length
            ? {
                revision: revision.current,
                base: baseline.current,
                patch: queue.current,
              }
            : restored;
          const resolved = intent
            ? rebasePreferenceDraft(result, intent)
            : { kind: "saved" as const, patch: {} };
          const decision = resolved.kind;
          queue.current = decision === "saved" ? {} : resolved.patch;
          const chosen = parseAppearance(
            queue.current.appearance ||
              result.appearance ||
              defaultAppearance(),
          );
          revision.current =
            decision === "conflict" && intent
              ? intent.revision
              : result.revision;
          baseline.current =
            decision === "conflict" && intent ? intent.base : result;
          paused.current = decision === "conflict";
          lastAppearance.current = JSON.stringify(chosen);
          current.current.replace(chosen);
          statusRef.current =
            queue.current.avatar_status || result.avatar_status;
          setStatus(statusRef.current);
          cache(chosen);
          loaded.current = true;
          setReady(true);
          setError(
            paused.current
              ? "有未保存的账户设置，账号已在其他页面更新，请核对后重试"
              : "",
          );
          persistDraft();
          void flush();
        })
        .catch((e) => {
          if (live.current && !request.signal.aborted)
            setError(e instanceof Error ? e.message : "账户设置读取失败");
        });
    };
    retryRead.current = load;
    load();
    const visible = () => {
      if (document.visibilityState === "visible") load();
    };
    const committed = (event: StorageEvent) => {
      if (event.key === key + ".committed") visible();
    };
    window.addEventListener("focus", visible);
    window.addEventListener("online", visible);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("storage", committed);
    return () => {
      controller?.abort();
      window.removeEventListener("focus", visible);
      window.removeEventListener("online", visible);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("storage", committed);
    };
  }, [key, draftScope]);
  useEffect(() => {
    if (!ready && appearance.editVersion.current === initialEdit.current)
      return;
    const encoded = JSON.stringify(appearance.settings);
    if (encoded === lastAppearance.current) return;
    lastAppearance.current = encoded;
    cache();
    enqueue({ appearance: appearance.settings });
  }, [appearance.settings, ready]);
  function select(value: AvatarStatus) {
    statusRef.current = value;
    setStatus(value);
    cache();
    enqueue({ avatar_status: value });
  }
  return (
    <Context.Provider value={{ ready, status, select, appearance }}>
      {children}
      {error && (
        <div className="account-preferences-error notice error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => {
              if (!loaded.current) retryRead.current();
              else void flush(true);
            }}
          >
            重试
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
