import {
  isPersonalFontId,
  personalFontFamily,
  type PersonalFontId,
} from "./personal-font-id.ts";
export type Mode = "system" | "light" | "dark";
export type BuiltinFont = "system" | "sans" | "serif" | "mono";
export type Font = BuiltinFont | PersonalFontId;
export type Accent =
  | "default"
  | "blue"
  | "green"
  | "yellow"
  | "pink"
  | "orange"
  | "purple"
  | "black"
  | "custom";
export type VisualStyle = "neutral" | "neutral-gray" | "muse" | "meta";
export type Palette = {
  theme:
    "alcor" | "neutral-gray" | "muse" | "meta" | "soft" | "contrast" | "custom";
  style: VisualStyle;
  accent: Accent;
  customAccent: string;
  background: string | null;
  foreground: string | null;
  font: Font;
};
export type Appearance = {
  version: 1;
  mode: Mode;
  separateModes: boolean;
  shared: Palette;
  light: Palette;
  dark: Palette;
  uiSize: number;
  contentSize: number;
  codeSize: number;
  motion: "system" | "on" | "off";
  translucent: boolean;
  contrast: number;
  fullWidth: boolean;
  contentWidth: "compact" | "standard" | "wide";
  contentAlign: "left" | "center";
  sidebarCollapsed: boolean;
  pointer: boolean;
  smoothing: boolean;
  uiStyle: "regular" | "medium";
  contentStyle: "regular" | "medium";
  codeStyle: "regular" | "medium";
  contentFont: Font | "same";
  codeFont: "system" | "mono";
};
export const APPEARANCE_KEY = "alcor.appearance.v1";
export const ACCENTS = [
  { value: "default", label: "默认", color: "#1a1c1f" },
  { value: "blue", label: "蓝色", color: "#4166e9" },
  { value: "green", label: "绿色", color: "#4eb39d" },
  { value: "yellow", label: "黄色", color: "#f6cb4b" },
  { value: "pink", label: "粉色", color: "#e86ea5" },
  { value: "orange", label: "橙色", color: "#ef846b" },
  { value: "purple", label: "紫色", color: "#9561ef" },
  { value: "black", label: "黑色", color: "#000000" },
] as const;
export const FONTS: Record<BuiltinFont, string> = {
  system:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  sans: 'Arial, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif',
  serif: 'Georgia, "Songti SC", "Noto Serif CJK SC", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "PingFang SC", monospace',
};
export function fontFamily(value: Font) {
  return isPersonalFontId(value)
    ? '"' + personalFontFamily(value) + '", ' + FONTS.system
    : FONTS[value];
}
function fontChoice(value: unknown, fallback: Font = "system"): Font {
  return isPersonalFontId(value)
    ? value
    : choice(
        value,
        ["system", "sans", "serif", "mono"],
        fallback as BuiltinFont,
      );
}
export function defaultPalette(): Palette {
  return {
    theme: "alcor",
    style: "neutral",
    accent: "default",
    customAccent: "#4166E9",
    background: null,
    foreground: null,
    font: "system",
  };
}
export function defaultAppearance(): Appearance {
  return {
    version: 1,
    mode: "system",
    separateModes: false,
    shared: defaultPalette(),
    light: defaultPalette(),
    dark: defaultPalette(),
    uiSize: 14,
    contentSize: 14,
    codeSize: 12,
    motion: "system",
    translucent: true,
    contrast: 45,
    fullWidth: false,
    contentWidth: "compact",
    contentAlign: "left",
    sidebarCollapsed: false,
    pointer: false,
    smoothing: true,
    uiStyle: "regular",
    contentStyle: "regular",
    codeStyle: "regular",
    contentFont: "same",
    codeFont: "system",
  };
}
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
function choice<T extends string>(
  value: unknown,
  values: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && values.includes(value as T)
    ? (value as T)
    : fallback;
}
const hex = (v: unknown) =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : null;
const size = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.min(max, Math.max(min, Math.round(v)))
    : fallback;
function palette(v: unknown): Palette {
  const p = record(v);
  return {
    theme: choice(
      p.theme,
      ["alcor", "neutral-gray", "muse", "meta", "soft", "contrast", "custom"],
      "alcor",
    ),
    style: choice(
      p.style,
      ["neutral", "neutral-gray", "muse", "meta"],
      choice(p.theme, ["neutral-gray", "muse", "meta", "neutral"], "neutral"),
    ),
    accent: choice(
      p.accent,
      [...ACCENTS.map((a) => a.value), "custom"],
      "default",
    ),
    customAccent: hex(p.customAccent) || "#4166E9",
    background: hex(p.background),
    foreground: hex(p.foreground),
    font: fontChoice(p.font),
  };
}
// Only recognized appearance values reach CSS. Unknown versions never apply saved styles.
export function parseAppearance(
  value: unknown,
  legacyMode?: unknown,
): Appearance {
  const defaults = defaultAppearance(),
    p = record(value);
  defaults.mode = choice(legacyMode, ["system", "light", "dark"], "system");
  if (p.version !== 1) return defaults;
  const result = {
    ...defaults,
    mode: choice(p.mode, ["system", "light", "dark"], defaults.mode),
    shared: palette(p.shared),
    light: palette(p.light),
    dark: palette(p.dark),
    uiSize: size(p.uiSize, 12, 20, 14),
    contentSize: size(p.contentSize, 12, 24, 14),
    codeSize: size(p.codeSize, 10, 20, 12),
    contrast: size(p.contrast, 0, 100, 45),
    motion: choice(p.motion, ["system", "on", "off"], "system"),
    contentWidth: choice(
      p.contentWidth,
      ["compact", "standard", "wide"],
      "compact",
    ),
    contentAlign: choice(p.contentAlign, ["left", "center"], "left"),
    uiStyle: choice(p.uiStyle, ["regular", "medium"], "regular"),
    contentStyle: choice(p.contentStyle, ["regular", "medium"], "regular"),
    codeStyle: choice(p.codeStyle, ["regular", "medium"], "regular"),
    contentFont: isPersonalFontId(p.contentFont)
      ? p.contentFont
      : choice(
          p.contentFont,
          ["same", "system", "sans", "serif", "mono"],
          "same",
        ),
    codeFont: choice(p.codeFont, ["system", "mono"], "system"),
  };
  for (const key of [
    "separateModes",
    "translucent",
    "fullWidth",
    "sidebarCollapsed",
    "pointer",
    "smoothing",
  ] as const) {
    if (typeof p[key] === "boolean") result[key] = p[key];
  }
  return result;
}
export function resolvedMode(
  settings: Appearance,
  systemDark: boolean,
): "light" | "dark" {
  return settings.mode === "system"
    ? systemDark
      ? "dark"
      : "light"
    : settings.mode;
}
export function activePalette(settings: Appearance, dark: boolean): Palette {
  return settings.separateModes
    ? settings[resolvedMode(settings, dark)]
    : settings.shared;
}
export function styleTokens(style: VisualStyle, mode: "light" | "dark") {
  const values: Record<
    Exclude<VisualStyle, "neutral">,
    Record<
      "light" | "dark",
      {
        background: string;
        foreground: string;
        surface: string;
        sidebar: string;
        accent: string;
      }
    >
  > = {
    "neutral-gray": {
      light: {
        background: "#F5F6F8",
        foreground: "#252A32",
        surface: "#FFFFFF",
        sidebar: "#ECEFF3",
        accent: "#536174",
      },
      dark: {
        background: "#181C23",
        foreground: "#E1E6EF",
        surface: "#222832",
        sidebar: "#1D232D",
        accent: "#AAB9D0",
      },
    },
    muse: {
      light: {
        background: "#FAFBFC",
        foreground: "#202124",
        surface: "#FFFFFF",
        sidebar: "#F3F4F5",
        accent: "#0064E0",
      },
      dark: {
        background: "#17191C",
        foreground: "#E7E9ED",
        surface: "#222427",
        sidebar: "#1D1F22",
        accent: "#1993FF",
      },
    },
    meta: {
      light: {
        background: "#F0F2F5",
        foreground: "#1C1E21",
        surface: "#FFFFFF",
        sidebar: "#E4E6EB",
        accent: "#0866FF",
      },
      dark: {
        background: "#18191A",
        foreground: "#E4E6EB",
        surface: "#242526",
        sidebar: "#242526",
        accent: "#3D91FF",
      },
    },
  };
  return style === "neutral" ? null : values[style][mode];
}
export function presetPalette(
  theme: Palette["theme"],
  mode: "light" | "dark",
): Palette {
  const p = defaultPalette();
  p.theme = theme;
  if (theme === "neutral-gray" || theme === "muse" || theme === "meta") {
    p.style = theme;
    const tokens = styleTokens(theme, mode)!;
    p.background = tokens.background;
    p.foreground = tokens.foreground;
  }
  if (theme === "soft") {
    p.background = mode === "dark" ? "#242321" : "#FAF9F6";
    p.foreground = mode === "dark" ? "#EAE7E0" : "#242321";
  }
  if (theme === "contrast") {
    p.background = mode === "dark" ? "#000000" : "#FFFFFF";
    p.foreground = mode === "dark" ? "#FFFFFF" : "#000000";
  }
  return p;
}
export function resolvedColors(p: Palette, mode: "light" | "dark") {
  // Presets adapt to the active mode even when light/dark share one preference.
  const preset = p.theme === "custom" ? p : presetPalette(p.theme, mode);
  const background =
    preset.background || (mode === "dark" ? "#212121" : "#FFFFFF");
  return {
    background,
    foreground: preset.foreground || (mode === "dark" ? "#ECECEC" : "#0D0D0D"),
    surface: styleTokens(p.style, mode)?.surface || background,
  };
}
export function resolvedAccent(p: Palette, mode: "light" | "dark") {
  if (p.accent === "default")
    return (
      styleTokens(p.style, mode)?.accent || resolvedColors(p, mode).foreground
    );
  return p.accent === "custom"
    ? p.customAccent
    : ACCENTS.find((a) => a.value === p.accent)!.color;
}

export function readableInk(color: string) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "#000000" : "#FFFFFF";
}

function luminance(color: string) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}
export function contrastRatio(first: string, second: string) {
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export function navigationColors(accent: string) {
  // White labels are a product preference. Adjust the fill, not the label,
  // including custom colors and the near-white default accent in dark mode.
  let background = accent;
  const rgb = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16));
  for (
    let percent = 99;
    contrastRatio(background, "#FFFFFF") < 4.5 && percent >= 0;
    percent--
  ) {
    background =
      "#" +
      rgb
        .map((c) =>
          Math.round((c * percent) / 100)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("");
  }
  return { background, foreground: "#FFFFFF" };
}
