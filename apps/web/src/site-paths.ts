const aliases: Record<string, string> = {
  "/holdings": "/portfolio", "/records": "/portfolio", "/watchlist": "/portfolio",
  "/asset-analysis": "/portfolio", "/asset-pnl-analysis": "/portfolio",
  "/global": "/market", "/quotes": "/market", "/earnings": "/market",
  "/trading": "/feed", "/library": "/shared-assets", "/activities": "/activity",
  "/quote-pool": "/market",
};
export function legacySitePath(path: string): string | null {
  return aliases[path] ?? null;
}
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(decoded)) return null;
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin || /^\/(?:api|uploads|assets|login|register|setup|forgot-password|reset-password|password-reset|verify-email)(?:\/|$)/i.test(decodeURIComponent(parsed.pathname))) return null;
    return (legacySitePath(parsed.pathname) ?? parsed.pathname) + parsed.search + parsed.hash;
  } catch { return null; }
}
export function loginDestination(pathname: string, search: string, hash: string): string {
  const query = new URLSearchParams(search);
  return safeReturnPath(query.get("returnTo")) ?? safeReturnPath(query.get("next")) ??
    safeReturnPath(pathname + search + hash) ?? "/";
}
