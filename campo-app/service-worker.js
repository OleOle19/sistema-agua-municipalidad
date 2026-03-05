const VERSION = "2026-03-05-3";
const CACHE_NAME = "campo-app-static-" + VERSION;
const APP_ROOT = self.location.pathname.replace(/\/service-worker\.js$/, "");
const PRECACHE = [
  APP_ROOT + "/",
  APP_ROOT + "/index.html",
  APP_ROOT + "/styles.css",
  APP_ROOT + "/app.js",
  APP_ROOT + "/manifest.webmanifest",
  APP_ROOT + "/icon-192.svg",
  APP_ROOT + "/icon-512.svg"
];
const STATIC_EXT_RE = /\.(?:css|js|svg|png|jpg|jpeg|webp|ico|webmanifest)$/i;

function shouldHandleRequest(url, requestMode) {
  if (!url.pathname.startsWith(APP_ROOT)) return false;
  if (requestMode === "navigate") return true;
  return STATIC_EXT_RE.test(url.pathname);
}

function toCacheKey(request) {
  const url = new URL(request.url);
  if (request.mode === "navigate") return APP_ROOT + "/index.html";
  return url.origin + url.pathname + url.search;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith("campo-app-static-") && k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!shouldHandleRequest(url, event.request.mode)) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(APP_ROOT + "/index.html", cloned)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(APP_ROOT + "/index.html"))
    );
    return;
  }

  const cacheKey = toCacheKey(event.request);
  event.respondWith(
    caches.match(cacheKey).then((cached) => {
      const networkPromise = fetch(event.request)
        .then((response) => {
          if (response && response.ok && response.type === "basic") {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, cloned)).catch(() => {});
          }
          return response;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(networkPromise);
        return cached;
      }
      return networkPromise.then((response) => response || caches.match(cacheKey));
    })
  );
});
