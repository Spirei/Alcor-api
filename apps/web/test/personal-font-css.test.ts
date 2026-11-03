import assert from "node:assert/strict";
import test from "node:test";
import { bindApiSession } from "../src/api-session.ts";
import { defaultAppearance, FONTS } from "../src/appearance-preferences.ts";
import { personalFontFamily } from "../src/personal-font-id.ts";
import {
  beginFontCssScope,
  allowVerifiedFontCss,
  withdrawFontCss,
  revokeFontCssScope,
  verifiedFontFamily,
  applyVerifiedFontCss,
  stripPrivateFontChoices,
} from "../src/personal-font-css.ts";
const a = `custom-1-${"a".repeat(64)}.ttf` as const,
  b = `custom-2-${"b".repeat(64)}.woff2` as const;
function documentFixture() {
  const old = (globalThis as any).document,
    properties = new Map<string, string>(),
    fonts = new Set<any>(),
    doc = {
      hidden: false,
      fonts,
      documentElement: {
        style: {
          getPropertyValue: (key: string) => properties.get(key) ?? "",
          setProperty: (key: string, value: string) =>
            properties.set(key, value),
        },
      },
    };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: doc,
  });
  return {
    doc,
    properties,
    fonts,
    restore() {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: old,
      });
    },
  };
}
function loaded(id: string) {
  return { status: "loaded", family: personalFontFamily(id) } as FontFace;
}
test("saved custom IDs alone never enter CSS; only a loaded registered face in the current session can publish its private family", () => {
  const f = documentFixture();
  bindApiSession("one");
  const token = beginFontCssScope(new Date(Date.now() + 3600000).toISOString());
  try {
    assert.equal(verifiedFontFamily(a), FONTS.system);
    applyVerifiedFontCss(a, a);
    assert.ok(!f.properties.get("--ui-font")?.includes("alcor-personal"));
    const face = loaded(a);
    assert.equal(allowVerifiedFontCss(token, a, face), false);
    f.fonts.add(face);
    assert.equal(
      allowVerifiedFontCss(token, a, {
        ...face,
        status: "loading",
      } as FontFace),
      false,
    );
    assert.equal(allowVerifiedFontCss(token, a, face), true);
    applyVerifiedFontCss(a, a);
    assert.ok(f.properties.get("--ui-font")?.includes(personalFontFamily(a)));
    assert.ok(
      f.properties.get("--content-font")?.includes(personalFontFamily(a)),
    );
  } finally {
    revokeFontCssScope(token);
    bindApiSession(null);
    f.restore();
  }
});
test("logout/retire synchronously clears both private CSS vars and later appearance renders cannot restore the old identifier", () => {
  const f = documentFixture();
  bindApiSession("one");
  const token = beginFontCssScope(new Date(Date.now() + 3600000).toISOString()),
    face = loaded(a);
  try {
    f.fonts.add(face);
    assert.ok(allowVerifiedFontCss(token, a, face));
    applyVerifiedFontCss(a, a);
    revokeFontCssScope(token);
    assert.equal(f.properties.get("--ui-font"), FONTS.system);
    assert.equal(f.properties.get("--content-font"), FONTS.system);
    applyVerifiedFontCss(a, a);
    assert.ok(
      ![...f.properties.values()].some((v) => v.includes("alcor-personal")),
    );
    assert.equal(verifiedFontFamily("serif"), FONTS.serif);
  } finally {
    revokeFontCssScope(token);
    bindApiSession(null);
    f.restore();
  }
});
test("identity changes fail closed before cleanup and a stale previous scope cannot revoke a new owner verified face", () => {
  const f = documentFixture();
  bindApiSession("one");
  const first = beginFontCssScope(new Date(Date.now() + 3600000).toISOString()),
    faceA = loaded(a);
  let second: symbol | null = null;
  try {
    f.fonts.add(faceA);
    assert.ok(allowVerifiedFontCss(first, a, faceA));
    applyVerifiedFontCss(a, a);
    bindApiSession("two");
    assert.equal(verifiedFontFamily(a), FONTS.system);
    second = beginFontCssScope(new Date(Date.now() + 3600000).toISOString());
    assert.ok(!f.properties.get("--ui-font")?.includes("alcor-personal"));
    const faceB = loaded(b);
    f.fonts.add(faceB);
    assert.ok(allowVerifiedFontCss(second, b, faceB));
    revokeFontCssScope(first);
    assert.ok(verifiedFontFamily(b).includes(personalFontFamily(b)));
    assert.equal(verifiedFontFamily(a), FONTS.system);
  } finally {
    revokeFontCssScope(second);
    bindApiSession(null);
    f.restore();
  }
});
test("an inactive theme or hidden document cannot reuse a withdrawn private CSS permission; builtins retain their exact family", () => {
  const f = documentFixture();
  bindApiSession("one");
  const token = beginFontCssScope(new Date(Date.now() + 3600000).toISOString()),
    face = loaded(a);
  try {
    f.fonts.add(face);
    assert.ok(allowVerifiedFontCss(token, a, face));
    applyVerifiedFontCss(a, "mono");
    withdrawFontCss(token, a);
    applyVerifiedFontCss("serif", "mono");
    assert.equal(f.properties.get("--ui-font"), FONTS.serif);
    assert.equal(f.properties.get("--content-font"), FONTS.mono);
    assert.equal(verifiedFontFamily(a), FONTS.system);
    assert.ok(allowVerifiedFontCss(token, a, face));
    f.doc.hidden = true;
    assert.equal(verifiedFontFamily(a), FONTS.system);
    assert.equal(allowVerifiedFontCss(token, a, face), false);
  } finally {
    revokeFontCssScope(token);
    bindApiSession(null);
    f.restore();
  }
});
test("anonymous/session memory sanitization removes private IDs without mutating PG/cache objects or changing builtin/public appearance", () => {
  const original = defaultAppearance();
  original.shared.font = a;
  original.light.font = "serif";
  original.dark.font = b;
  original.contentFont = a;
  original.mode = "dark";
  original.shared.customAccent = "#123456";
  original.uiSize = 17;
  const before = JSON.stringify(original),
    clean = stripPrivateFontChoices(original);
  assert.equal(JSON.stringify(original), before);
  assert.equal(clean.shared.font, "system");
  assert.equal(clean.light.font, "serif");
  assert.equal(clean.dark.font, "system");
  assert.equal(clean.contentFont, "same");
  assert.equal(clean.mode, "dark");
  assert.equal(clean.shared.customAccent, "#123456");
  assert.equal(clean.uiSize, 17);
  assert.ok(!JSON.stringify(clean).includes("custom-"));
  const publicOnly = defaultAppearance();
  publicOnly.shared.font = "mono";
  assert.equal(stripPrivateFontChoices(publicOnly), publicOnly);
});
