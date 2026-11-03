import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCENTS,
  contrastRatio,
  navigationColors,
  activePalette,
  defaultAppearance,
  parseAppearance,
  presetPalette,
  readableInk,
  resolvedColors,
  resolvedAccent,
  resolvedMode,
} from "../src/appearance-preferences.ts";

test("legacy mode survives the first appearance upgrade; unknown versions do not apply styles", () => {
  assert.equal(parseAppearance(null, "dark").mode, "dark");
  assert.equal(
    parseAppearance({ version: 2, shared: { background: "#FF0000" } }, "light")
      .shared.background,
    null,
  );
  assert.equal(parseAppearance([], "unexpected").mode, "system");
});
test("stored CSS and font input is restricted; malformed preferences cannot inject styles", () => {
  const p = parseAppearance({
    version: 1,
    shared: {
      background: "red;display:none",
      foreground: "#abcdef",
      font: "url(https://invalid)",
      accent: "pink",
      customAccent: "#123abc",
    },
    translucent: "false",
    unknown: "ignored",
  });
  assert.equal(p.shared.background, null);
  assert.equal(p.shared.foreground, "#ABCDEF");
  assert.equal(p.shared.font, "system");
  assert.equal(p.shared.accent, "pink");
  assert.equal(p.shared.customAccent, "#123ABC");
  assert.equal(p.translucent, true);
  assert.equal("unknown" in p, false);
});
test("older layout preferences adopt compact left alignment and retain explicit full width", () => {
  const older = parseAppearance({
    version: 1,
    fullWidth: true,
    sidebarCollapsed: true,
  });
  assert.equal(older.contentWidth, "compact");
  assert.equal(older.contentAlign, "left");
  assert.equal(older.fullWidth, true);
  assert.equal(older.sidebarCollapsed, true);
  const invalid = parseAppearance({
    version: 1,
    contentWidth: "9999px",
    contentAlign: "right",
  });
  assert.equal(invalid.contentWidth, "compact");
  assert.equal(invalid.contentAlign, "left");
});
test("untrusted numeric settings remain bounded and finite", () => {
  const p = parseAppearance({
    version: 1,
    uiSize: 400,
    contentSize: 1,
    codeSize: Number.NaN,
    contrast: Infinity,
  });
  assert.deepEqual(
    [p.uiSize, p.contentSize, p.codeSize, p.contrast],
    [20, 12, 12, 45],
  );
});
test("system changes select the correct independent palette, with explicit modes taking precedence", () => {
  const p = defaultAppearance();
  p.separateModes = true;
  p.light.accent = "green";
  p.dark.accent = "purple";
  assert.equal(activePalette(p, false).accent, "green");
  assert.equal(activePalette(p, true).accent, "purple");
  p.mode = "light";
  assert.equal(resolvedMode(p, true), "light");
  assert.equal(activePalette(p, true).accent, "green");
  p.separateModes = false;
  assert.equal(activePalette(p, true), p.shared);
});
test("shared presets adapt their colors to light and dark instead of leaving white content in dark mode", () => {
  const p = presetPalette("soft", "light");
  assert.equal(resolvedColors(p, "light").background, "#FAF9F6");
  assert.equal(resolvedColors(p, "dark").background, "#242321");
  p.theme = "custom";
  p.background = "#123456";
  assert.equal(resolvedColors(p, "dark").background, "#123456");
});
test("primary button foreground chooses readable black or white for preset and custom colors", () => {
  assert.equal(readableInk("#FFFFFF"), "#000000");
  assert.equal(readableInk("#F6CB4B"), "#000000");
  assert.equal(readableInk("#000000"), "#FFFFFF");
  assert.equal(readableInk("#123456"), "#FFFFFF");
});
test("serialization roundtrip preserves separate custom palettes and advanced options", () => {
  const p = defaultAppearance();
  p.separateModes = true;
  p.light = {
    ...p.light,
    theme: "custom",
    background: "#FAFAF1",
    accent: "green",
  };
  p.dark.accent = "purple";
  p.uiSize = 18;
  p.contentSize = 20;
  p.motion = "on";
  p.fullWidth = true;
  p.contentWidth = "standard";
  p.contentAlign = "center";
  assert.deepEqual(parseAppearance(JSON.parse(JSON.stringify(p))), p);
});

test("navigation capsules keep white labels with every selected accent", () => {
  for (const accent of ACCENTS) {
    const result = navigationColors(accent.color);
    assert.ok(contrastRatio(result.background, "#FFFFFF") >= 4.5);
    assert.equal(result.foreground, "#FFFFFF");
  }
  assert.deepEqual(navigationColors("#4166E9"), {
    background: "#4166E9",
    foreground: "#FFFFFF",
  });
});

test("META restores its gray canvas, raised surfaces and blue capsule fill in both modes", () => {
  const p = presetPalette("meta", "light");
  assert.equal(p.style, "meta");
  assert.deepEqual(resolvedColors(p, "light"), {
    background: "#F0F2F5",
    foreground: "#1C1E21",
    surface: "#FFFFFF",
  });
  assert.deepEqual(resolvedColors(p, "dark"), {
    background: "#18191A",
    foreground: "#E4E6EB",
    surface: "#242526",
  });
  assert.equal(resolvedAccent(p, "light"), "#0866FF");
  assert.equal(resolvedAccent(p, "dark"), "#3D91FF");
  assert.deepEqual(navigationColors(resolvedAccent(p, "light")), {
    background: "#0866FF",
    foreground: "#FFFFFF",
  });
  const settings = defaultAppearance();
  settings.shared = p;
  assert.deepEqual(
    parseAppearance(JSON.parse(JSON.stringify(settings))).shared,
    p,
  );
});
test("color customization preserves META structure; choosing Alcor restores neutral surfaces", () => {
  const p = {
    ...presetPalette("meta", "light"),
    theme: "custom" as const,
    background: "#F1F5FA",
    accent: "green" as const,
  };
  assert.equal(resolvedColors(p, "light").surface, "#FFFFFF");
  assert.equal(resolvedColors(p, "light").background, "#F1F5FA");
  assert.equal(resolvedAccent(p, "light"), "#4eb39d");
  const neutral = presetPalette("alcor", "light");
  assert.equal(neutral.style, "neutral");
  assert.equal(resolvedColors(neutral, "light").surface, "#FFFFFF");
  assert.equal(resolvedAccent(neutral, "light"), "#0D0D0D");
  assert.equal(
    parseAppearance({ version: 1, shared: { theme: "meta" } }).shared.style,
    "meta",
  );
});

test("the three optional styles keep distinct day/night tokens and survive browser storage", () => {
  const backgrounds = new Set<string>();
  for (const theme of ["neutral-gray", "muse", "meta"] as const) {
    for (const mode of ["light", "dark"] as const) {
      const p = presetPalette(theme, mode),
        settings = defaultAppearance();
      settings.mode = mode;
      settings.shared = p;
      const restored = parseAppearance(JSON.parse(JSON.stringify(settings)));
      assert.equal(restored.shared.theme, theme);
      assert.equal(restored.shared.style, theme);
      const colors = resolvedColors(restored.shared, mode);
      assert.notEqual(colors.background, colors.surface);
      assert.ok(contrastRatio(colors.foreground, colors.surface) >= 4.5);
      const capsule = navigationColors(resolvedAccent(restored.shared, mode));
      assert.equal(capsule.foreground, "#FFFFFF");
      if (mode === "light") backgrounds.add(colors.background);
    }
  }
  assert.equal(backgrounds.size, 3);
});

test("removed Liquid Glass preferences safely return to Alcor without glass styling", () => {
  const p = parseAppearance({
    version: 1,
    shared: {
      theme: "liquid-glass",
      style: "liquid-glass",
      background: "#E8EDF5",
      foreground: "#1D293A",
      accent: "default",
    },
    light: { theme: "liquid-glass", style: "liquid-glass" },
    dark: { theme: "liquid-glass", style: "liquid-glass" },
  });
  for (const palette of [p.shared, p.light, p.dark]) {
    assert.equal(palette.theme, "alcor");
    assert.equal(palette.style, "neutral");
    assert.equal(resolvedColors(palette, "light").background, "#FFFFFF");
    assert.equal(resolvedAccent(palette, "light"), "#0D0D0D");
  }
});

test("white capsule text stays legible across every theme, mode and pale custom fill", () => {
  for (const theme of ["alcor", "neutral-gray", "muse", "meta", "soft", "contrast"] as const) {
    for (const mode of ["light", "dark"] as const) {
      const p = presetPalette(theme, mode);
      const result = navigationColors(resolvedAccent(p, mode));
      assert.equal(result.foreground, "#FFFFFF");
      assert.ok(contrastRatio(result.background, result.foreground) >= 4.5, theme + mode);
    }
  }
  for (const fill of ["#FFFFFF", "#ECECEC", "#FFFF00", "#FFCCDD", "#000000"]) {
    const result = navigationColors(fill);
    assert.ok(contrastRatio(result.background, result.foreground) >= 4.5);
  }
});
