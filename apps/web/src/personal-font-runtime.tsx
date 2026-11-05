import {
  beginFontCssScope,
  allowVerifiedFontCss,
  withdrawFontCss,
  revokeFontCssScope,
  applyVerifiedFontCss,
} from "./personal-font-css";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError, type Session } from "./api";
import { apiSessionSnapshot } from "./api-session";
import { useAccountStatus } from "./account-preferences";
import type { AppearanceController } from "./use-appearance";
import { isPersonalFontId } from "./personal-font-id";
import {
  fontListing,
  personalFont,
  type PersonalFont,
} from "./personal-font-state";
import { preparePersonalFont } from "./personal-font-media";
import "./personal-fonts.css";
export const fontDeniedEvent = "alcor:personal-fonts-denied";
export function announceFontDenied(epoch: number) {
  window.dispatchEvent(new CustomEvent(fontDeniedEvent, { detail: { epoch } }));
}
type Runtime = {
  ready: boolean;
  error: string;
  ensure: (
    font: PersonalFont,
    current: () => boolean,
    signal: AbortSignal,
  ) => Promise<void>;
  refresh: () => void;
};
const Context = createContext<Runtime | null>(null);
export function usePersonalFontsRuntime() {
  return useContext(Context);
}
export function PersonalFontsProvider({
  session,
  appearance,
  children,
}: {
  session: Session;
  appearance: AppearanceController;
  children: ReactNode;
}) {
  return (
    <RuntimeSession
      key={JSON.stringify([
        session.instance_id,
        session.user.id,
        session.user.role,
        session.receipt_scope,
        session.csrf,
        session.expires_at,
      ])}
      {...{ session, appearance, children }}
    />
  );
}
function RuntimeSession({
  session,
  appearance,
  children,
}: {
  session: Session;
  appearance: AppearanceController;
  children: ReactNode;
}) {
  const account = useAccountStatus(),
    [visible, setVisible] = useState(
      typeof document === "undefined" || !document.hidden,
    ),
    [error, setError] = useState(""),
    [denied, setDenied] = useState(false),
    [reload, setReload] = useState(0);
  const cssToken = useRef<symbol | null>(null),
    currentAppearance = useRef(appearance);
  currentAppearance.current = appearance;
  const syncCss = () => {
    const value = currentAppearance.current;
    applyVerifiedFontCss(
      value.palette.font,
      value.settings.contentFont === "same"
        ? value.palette.font
        : value.settings.contentFont,
    );
  };
  const live = useRef(false),
    generation = useRef(0),
    binding = useRef(apiSessionSnapshot()),
    faces = useRef(new Map<string, FontFace>()),
    tasks = useRef(
      new Map<
        string,
        {
          controller: AbortController;
          promise: Promise<void>;
          interactive: boolean;
        }
      >(),
    ),
    reading = useRef<AbortController | null>(null),
    visibleRef = useRef(visible);
  const current = () =>
    live.current &&
    visibleRef.current &&
    apiSessionSnapshot().csrf === session.csrf &&
    apiSessionSnapshot().epoch === binding.current.epoch &&
    Date.now() < Date.parse(session.expires_at);
  const clear = () => {
    live.current = false;
    ++generation.current;
    reading.current?.abort();
    reading.current = null;
    for (const task of tasks.current.values()) task.controller.abort();
    tasks.current.clear();
    for (const face of faces.current.values()) document.fonts.delete(face);
    faces.current.clear();
    revokeFontCssScope(cssToken.current);
    cssToken.current = null;
  };
  useLayoutEffect(() => {
    visibleRef.current = visible;
    live.current = !!account?.ready && visible && !denied;
    return clear;
  }, [visible, account?.ready, denied]);
  useEffect(() => {
    const visibility = () => {
      if (document.hidden) {
        clear();
        setError("");
      }
      visibleRef.current = !document.hidden;
      setVisible(!document.hidden);
    };
    const retire = (event: Event) => {
      if ((event as CustomEvent).detail?.epoch !== binding.current.epoch)
        return;
      clear();
      setDenied(true);
      setError("字体读取被拒绝，请重新读取核对");
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener(fontDeniedEvent, retire);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener(fontDeniedEvent, retire);
    };
  }, []);
  useEffect(() => {
    const expires = Date.parse(session.expires_at),
      remaining = expires - Date.now();
    if (!Number.isFinite(expires) || remaining <= 0) {
      clear();
      setError("登录期限已到期或无法核对");
      return;
    }
    const timer = setTimeout(
      () => {
        if (Date.now() >= expires) {
          clear();
          window.dispatchEvent(new Event("alcor:session-expired"));
        } else setReload((n) => n + 1);
      },
      Math.min(remaining, 2147483647),
    );
    return () => clearTimeout(timer);
  }, [session.expires_at, reload]);
  async function ensure(
    font: PersonalFont,
    caller: () => boolean = () => true,
    signal?: AbortSignal,
    interactive = true,
  ) {
    personalFont(font);
    if (!current() || !caller() || signal?.aborted)
      throw new Error("字体应用状态已变化");
    const old = faces.current.get(font.id);
    if (old?.status === "loaded" && document.fonts.has(old)) return;
    const pending = tasks.current.get(font.id);
    if (pending?.controller.signal.aborted) tasks.current.delete(font.id);
    else if (pending) {
      await pending.promise;
      if (!current() || !caller() || signal?.aborted)
        throw new Error("字体应用已停止");
      return;
    }
    const version = generation.current,
      controller = new AbortController(),
      abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const valid = () =>
      current() &&
      version === generation.current &&
      caller() &&
      !controller.signal.aborted;
    const promise = (async () => {
      const face = await preparePersonalFont(
        font,
        { csrf: session.csrf, current: valid },
        controller.signal,
      );
      if (!valid()) throw new Error("字体应用已停止");
      document.fonts.add(face);
      faces.current.set(font.id, face);
      if (!cssToken.current)
        cssToken.current = beginFontCssScope(session.expires_at);
      if (!allowVerifiedFontCss(cssToken.current, font.id, face)) {
        document.fonts.delete(face);
        faces.current.delete(font.id);
        throw new Error("字体应用身份已变化");
      }
      syncCss();
      if (
        requested.every((id) => {
          const loaded = faces.current.get(id);
          return loaded?.status === "loaded" && document.fonts.has(loaded);
        })
      )
        setError("");
    })();
    tasks.current.set(font.id, { controller, promise, interactive });
    try {
      await promise;
    } finally {
      signal?.removeEventListener("abort", abort);
      if (tasks.current.get(font.id)?.promise === promise)
        tasks.current.delete(font.id);
    }
  }
  const requested = Array.from(
      new Set(
        [
          appearance.palette.font,
          appearance.settings.contentFont === "same"
            ? appearance.palette.font
            : appearance.settings.contentFont,
        ].filter(isPersonalFontId),
      ),
    ).sort(),
    key = requested.join("|");
  useEffect(() => {
    if (!current()) return;
    for (const [id, face] of faces.current)
      if (!requested.includes(id as `custom-${string}`)) {
        document.fonts.delete(face);
        faces.current.delete(id);
        if (cssToken.current) withdrawFontCss(cssToken.current, id);
      }
    for (const [id, task] of tasks.current)
      if (!task.interactive && !requested.includes(id as `custom-${string}`)) {
        task.controller.abort();
        tasks.current.delete(id);
      }
    syncCss();
    if (!requested.length) {
      setError("");
      return;
    }
    if (
      requested.every((id) => {
        const face = faces.current.get(id);
        return face?.status === "loaded" && document.fonts.has(face);
      })
    )
      return;
    const version = generation.current,
      controller = new AbortController();
    reading.current?.abort();
    reading.current = controller;
    setError("");
    void (async () => {
      const listing = fontListing(
        await api<unknown>("/personal-fonts", { signal: controller.signal }),
      );
      if (
        !current() ||
        version !== generation.current ||
        controller.signal.aborted
      )
        return;
      for (const id of requested) {
        const font = listing.fonts.find((f) => f.id === id);
        if (!font) throw new Error("已选字体尚无本人原件，请在外观中核对");
        await ensure(
          font,
          () => version === generation.current,
          controller.signal,
          false,
        );
      }
    })().catch((reason) => {
      if (version !== generation.current || controller.signal.aborted) return;
      for (const face of faces.current.values()) document.fonts.delete(face);
      faces.current.clear();
      revokeFontCssScope(cssToken.current);
      cssToken.current = null;
      if (reason instanceof ApiError && [401, 403].includes(reason.status))
        announceFontDenied(binding.current.epoch);
      setError(reason instanceof Error ? reason.message : "本人字体加载失败");
    });
    return () => controller.abort();
  }, [key, appearance.settings, visible, account?.ready, denied, reload]);
  const refresh = () => {
    clear();
    setError("");
    if (Date.now() >= Date.parse(session.expires_at)) {
      setError("登录期限已到期");
      window.dispatchEvent(new Event("alcor:session-expired"));
      return;
    }
    setDenied(false);
    live.current = !!account?.ready && visible;
    setReload((n) => n + 1);
  };
  return (
    <Context.Provider
      value={{
        ready: !!account?.ready && visible && !denied,
        ensure,
        refresh,
        error,
      }}
    >
      {children}
    </Context.Provider>
  );
}
