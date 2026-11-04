/** Render only server-produced mail HTML, inside an opaque-origin sandbox. */
export function mailPreviewDocument(
  html: string,
  mode: "light" | "dark",
  origin?: string,
) {
  if (!/<html\b[^>]*>/i.test(html) || !/<head\b[^>]*>/i.test(html)) return null;
  let banner = "";
  if (origin) {
    try {
      const url = new URL(origin);
      if (!/^https?:$/.test(url.protocol) || url.origin !== origin) return null;
      banner = " " + new URL("/api/system-assets/mail-banner", url).href;
    } catch {
      return null;
    }
  }
  return html
    .replace(/<html\b[^>]*>/i, `<html lang="zh-CN" data-theme="${mode}">`)
    .replace(
      /<head\b[^>]*>/i,
      `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:${banner}; form-action 'none'; base-uri 'none'">`,
    );
}
