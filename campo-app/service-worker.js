const VERSION = "2026-02-25-1";
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
  if (!url.pathname.startsWith(APP_ROOT)) return;

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

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const cloned = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned)).catch(() => {});
        return response;
      });
    })
  );
});
