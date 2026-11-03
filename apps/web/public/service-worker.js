/* Public build assets only. Private pages, API replies and writes never enter CacheStorage. */
const CACHE_PREFIX = "alcor-api-web-public-static-";
const CACHE_NAME = CACHE_PREFIX + "v2";
const MAX_ENTRIES = 160;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const HASHED_ASSET = /^\/assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|ttf|otf|png|jpe?g|webp|gif|svg|ico)$/;
const PUBLIC_BRAND = new Set(["/assets/brand.svg"]);
const OFFLINE_HTML = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>离线</title></head><body><main><p>当前无法连接，请联网后重试。</p><button type="button" onclick="location.reload()">重试</button></main></body></html>';

self.addEventListener("install", (event) => {
  // Nothing fetched or precached: a server SPA fallback must never become an offline page.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

function offlinePage() {
  return new Response(OFFLINE_HTML, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function publicAsset(request, url) {
  if (request.method !== "GET" || url.origin !== self.location.origin || url.search || url.hash) return false;
  if (request.headers.has("Authorization") || request.headers.has("Cookie")) return false;
  if (!HASHED_ASSET.test(url.pathname) && !PUBLIC_BRAND.has(url.pathname)) return false;
  return ["script", "style", "font", "image"].includes(request.destination);
}

function publicResponse(response, request) {
  if (!response.ok || response.status !== 200 || response.redirected || response.type !== "basic") return false;
  if (/\b(?:private|no-store)\b/i.test(response.headers.get("Cache-Control") || "")) return false;
  if (response.headers.has("Content-Range") || /(?:cookie|authorization|\*)/i.test(response.headers.get("Vary") || "")) return false;
  const length = Number(response.headers.get("Content-Length"));
  if (length > MAX_ASSET_BYTES) return false;
  const type = (response.headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase();
  if (request.destination === "script") return ["text/javascript", "application/javascript"].includes(type);
  if (request.destination === "style") return type === "text/css";
  if (request.destination === "font") return /^(?:font\/|application\/(?:font|x-font|vnd\.ms-fontobject))/.test(type);
  return /^image\/(?:png|jpeg|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon)$/.test(type);
}

async function storePublic(request, response) {
  // A bounded clone cannot turn a missing/false Content-Length into unbounded cache growth.
  const reader = response.body && response.body.getReader();
  if (!reader) return;
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ASSET_BYTES) {
        await reader.cancel();
        return;
      }
      chunks.push(value);
    }
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, new Response(new Blob(chunks), { status: 200, headers: response.headers }));
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES)).map((key) => cache.delete(key)));
  } finally {
    reader.releaseLock();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // No interception of API calls, file downloads, or any mutation. In particular
  // there is no queue, retry, background sync or offline financial operation.
  if (request.method !== "GET" || url.pathname === "/api" || url.pathname.startsWith("/api/") || request.headers.has("Range")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request, { cache: "no-store" }).catch(offlinePage));
    return;
  }
  if (!publicAsset(request, url)) return;
  event.respondWith((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
    } catch {
      // Storage denial must not stop a live network asset request.
    }
    const response = await fetch(request);
    if (publicResponse(response, request)) {
      event.waitUntil(storePublic(request, response.clone()).catch(() => {}));
    }
    return response;
  })());
});
