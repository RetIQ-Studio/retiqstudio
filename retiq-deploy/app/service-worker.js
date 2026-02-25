/* RetIQ PWA Service Worker (v1) */
const CACHE_NAME = "retiq-v1-cache-2026-02-20";
const ASSETS = [
  "./",
  "./index.html",
  "./offline.html",
  "./manifest.webmanifest",
  "./success.html",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle same-origin GET requests
  if (req.method !== "GET") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;

      try {
        const fresh = await fetch(req);
        // Cache a copy of successful same-origin responses
        if (fresh && fresh.status === 200 && new URL(req.url).origin === self.location.origin) {
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (e) {
        // Offline fallback for navigation
        if (req.mode === "navigate") {
          return cache.match("./offline.html");
        }
        throw e;
      }
    })()
  );
});
