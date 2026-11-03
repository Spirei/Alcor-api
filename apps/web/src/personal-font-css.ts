import { apiSessionSnapshot } from "./api-session.ts";
import {
  FONTS,
  fontFamily,
  type Font,
  type Appearance,
} from "./appearance-preferences.ts";
import { isPersonalFontId, personalFontFamily } from "./personal-font-id.ts";
type Permit = {
  token: symbol;
  binding: ReturnType<typeof apiSessionSnapshot>;
  ids: Set<string>;
  expiresAt: number;
};
let permit: Permit | null = null;
const marker = "alcor-personal-";
function current() {
  const now = apiSessionSnapshot();
  return (
    !!permit &&
    !!now.csrf &&
    now.epoch === permit.binding.epoch &&
    now.csrf === permit.binding.csrf &&
    Date.now() < permit.expiresAt &&
    (typeof document === "undefined" || !document.hidden)
  );
}
function clearPrivateCss() {
  if (typeof document === "undefined") return;
  const style = document.documentElement.style;
  for (const key of ["--ui-font", "--content-font"])
    if (style.getPropertyValue(key).includes(marker))
      style.setProperty(key, FONTS.system);
}
export function beginFontCssScope(expires: string) {
  const expiresAt = Date.parse(expires);
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt)
    throw new Error("登录期限无法核对");
  clearPrivateCss();
  const binding = apiSessionSnapshot();
  if (!binding.csrf) throw new Error("登录身份无法核对");
  const token = Symbol("verified-font-css");
  permit = { token, binding, ids: new Set(), expiresAt };
  return token;
}
export function allowVerifiedFontCss(
  token: symbol,
  id: string,
  face: FontFace,
) {
  if (
    permit?.token !== token ||
    !current() ||
    !isPersonalFontId(id) ||
    face.status !== "loaded" ||
    face.family !== personalFontFamily(id) ||
    !document.fonts.has(face)
  )
    return false;
  permit.ids.add(id);
  return true;
}
export function withdrawFontCss(token: symbol, id: string) {
  if (permit?.token === token) permit.ids.delete(id);
}
export function revokeFontCssScope(token: symbol | null) {
  if (!token || permit?.token !== token) return;
  permit = null;
  clearPrivateCss();
}
export function verifiedFontFamily(value: Font) {
  return isPersonalFontId(value)
    ? current() && permit!.ids.has(value)
      ? fontFamily(value)
      : FONTS.system
    : fontFamily(value);
}
export function applyVerifiedFontCss(ui: Font, content: Font) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(
    "--ui-font",
    verifiedFontFamily(ui),
  );
  document.documentElement.style.setProperty(
    "--content-font",
    verifiedFontFamily(content),
  );
}

export function stripPrivateFontChoices(value: Appearance): Appearance {
  const shared = isPersonalFontId(value.shared.font)
    ? { ...value.shared, font: "system" as const }
    : value.shared;
  const light = isPersonalFontId(value.light.font)
    ? { ...value.light, font: "system" as const }
    : value.light;
  const dark = isPersonalFontId(value.dark.font)
    ? { ...value.dark, font: "system" as const }
    : value.dark;
  const contentFont = isPersonalFontId(value.contentFont)
    ? ("same" as const)
    : value.contentFont;
  if (
    shared === value.shared &&
    light === value.light &&
    dark === value.dark &&
    contentFont === value.contentFont
  )
    return value;
  return { ...value, shared, light, dark, contentFont };
}
