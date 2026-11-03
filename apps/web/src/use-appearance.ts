import {
  verifiedFontFamily,
  stripPrivateFontChoices,
} from "./personal-font-css";
import { useLayoutEffect, useState, useRef } from "react";
import {
  APPEARANCE_KEY,
  FONTS,
  activePalette,
  defaultAppearance,
  parseAppearance,
  navigationColors,
  resolvedColors,
  resolvedAccent,
  styleTokens,
  resolvedMode,
} from "./appearance-preferences";
import type { Appearance, Palette } from "./appearance-preferences";

function readAppearance() {
  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem("alcor.theme");
    return stripPrivateFontChoices(
      parseAppearance(
        JSON.parse(localStorage.getItem(APPEARANCE_KEY) || "null"),
        legacy,
      ),
    );
  } catch {
    return parseAppearance(null, legacy);
  }
}
export function useAppearance() {
  const [settings, setSettings] = useState(readAppearance);
  const storageKey = useRef(APPEARANCE_KEY);
  const editVersion = useRef(0);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [systemMotion, setSystemMotion] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useLayoutEffect(() => {
    const dark = matchMedia("(prefers-color-scheme: dark)"),
      motion = matchMedia("(prefers-reduced-motion: reduce)");
    const syncDark = () => setSystemDark(dark.matches),
      syncMotion = () => setSystemMotion(motion.matches);
    dark.addEventListener("change", syncDark);
    motion.addEventListener("change", syncMotion);
    const storage = (event: StorageEvent) => {
      if (
        event.storageArea === localStorage &&
        storageKey.current === APPEARANCE_KEY &&
        (event.key === storageKey.current || event.key === null)
      )
        try {
          setSettings(
            stripPrivateFontChoices(
              parseAppearance(
                JSON.parse(localStorage.getItem(storageKey.current) || "null"),
              ),
            ),
          );
        } catch {
          setSettings(defaultAppearance());
        }
    };
    window.addEventListener("storage", storage);
    return () => {
      dark.removeEventListener("change", syncDark);
      motion.removeEventListener("change", syncMotion);
      window.removeEventListener("storage", storage);
    };
  }, []);
  const mode = resolvedMode(settings, systemDark),
    palette = activePalette(settings, systemDark);
  const colors = resolvedColors(palette, mode);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const accent = resolvedAccent(palette, mode);
    const tokens = styleTokens(palette.style, mode);
    const neutral = palette.accent === "default" && palette.style === "neutral";
    const selected = navigationColors(accent);
    root.dataset.theme = mode;
    root.dataset.appearanceStyle = palette.style;
    root.dataset.reducedMotion = String(
      settings.motion === "system" ? systemMotion : settings.motion === "on",
    );
    root.dataset.fullWidth = String(settings.fullWidth);
    root.dataset.contentAlign = settings.contentAlign;
    root.dataset.pointer = String(settings.pointer);
    root.dataset.translucent = String(settings.translucent);
    root.dataset.smoothing = "true";
    const vars: Record<string, string> = {
      "--content-width": `${{ compact: 960, standard: 1080, wide: 1200 }[settings.contentWidth]}px`,
      "--bg": colors.background,
      "--surface": colors.surface,
      "--ink": colors.foreground,
      "--side": tokens
        ? tokens.sidebar
        : mode === "dark"
          ? `color-mix(in srgb, ${colors.background}, #000000 28%)`
          : `color-mix(in srgb, ${colors.background}, ${colors.foreground} 2.5%)`,
      "--soft": `color-mix(in srgb, ${colors.background}, ${colors.foreground} 5%)`,
      "--hover": `color-mix(in srgb, ${colors.background}, ${colors.foreground} 8%)`,
      "--selected": `color-mix(in srgb, ${colors.background}, ${colors.foreground} 10%)`,
      "--muted": `color-mix(in srgb, ${colors.foreground} ${52 + settings.contrast * 0.24}%, ${colors.background})`,
      "--faint": `color-mix(in srgb, ${colors.foreground} ${42 + settings.contrast * 0.2}%, ${colors.background})`,
      "--edge": `color-mix(in srgb, ${colors.foreground} ${7 + settings.contrast * 0.11}%, ${colors.background})`,
      "--nav-selected": neutral
        ? `color-mix(in srgb, ${colors.background}, ${colors.foreground} 10%)`
        : selected.background,
      "--nav-hover": neutral
        ? `color-mix(in srgb, ${colors.background}, ${colors.foreground} 8%)`
        : `color-mix(in srgb, ${colors.background}, ${accent} 10%)`,
      "--nav-ink": neutral ? colors.foreground : selected.foreground,
      "--primary": selected.background,
      "--primary-ink": "#FFFFFF",
      "--accent": accent,
      "--focus": `color-mix(in srgb, ${accent} 65%, ${colors.foreground})`,
      "--ui-size": `${settings.uiSize}px`,
      "--content-size": `${settings.contentSize}px`,
      "--code-size": "12px",
      "--ui-font": verifiedFontFamily(palette.font),
      "--content-font": verifiedFontFamily(
        settings.contentFont === "same" ? palette.font : settings.contentFont,
      ),
      "--code-font": FONTS.mono,
      "--ui-weight": settings.uiStyle === "medium" ? "500" : "400",
      "--content-weight": settings.contentStyle === "medium" ? "500" : "400",
      "--code-weight": "400",
    };
    for (const [key, value] of Object.entries(vars))
      root.style.setProperty(key, value);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", colors.background);
  }, [
    settings,
    systemMotion,
    mode,
    palette,
    colors.background,
    colors.foreground,
    colors.surface,
  ]);
  function update(patch: Partial<Appearance>) {
    editVersion.current++;
    setSettings((previous) => {
      const parsed = parseAppearance({ ...previous, ...patch });
      const next =
        storageKey.current === APPEARANCE_KEY
          ? stripPrivateFontChoices(parsed)
          : parsed;
      try {
        localStorage.setItem(storageKey.current, JSON.stringify(next));
        localStorage.setItem("alcor.theme", next.mode);
      } catch {
        /* Browser storage can be unavailable; keep the active preference in memory. */
      }
      return next;
    });
  }
  function updatePalette(patch: Partial<Palette>) {
    const key = settings.separateModes ? mode : "shared";
    update({ [key]: { ...palette, ...patch } });
  }
  function separate(value: boolean) {
    update(
      value
        ? { separateModes: true, light: { ...palette }, dark: { ...palette } }
        : { separateModes: false, shared: { ...palette } },
    );
  }
  return {
    settings,
    editVersion,
    bindStorage: (key: string | null) => {
      storageKey.current = key || APPEARANCE_KEY;
      if (key === null) setSettings(stripPrivateFontChoices);
    },
    replace: (value: unknown) => setSettings(parseAppearance(value)),
    reducedMotion:
      settings.motion === "system" ? systemMotion : settings.motion === "on",
    mode,
    palette,
    colors,
    update,
    updatePalette,
    separate,
    reset: () => update(defaultAppearance()),
  };
}
export type AppearanceController = ReturnType<typeof useAppearance>;
