/* RetIQ PWA Service Worker (v1.6) */
const CACHE_NAME = "retiq-v1-cache-2026-03-01";
const ASSETS = [
  "./",
  "./index.html",
  "./offline.html",
  "./manifest.webmanifest",
  "./success.html",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./fonts/dm-sans-v17-latin-300.woff2",
  "./fonts/dm-sans-v17-latin-regular.woff2",
  "./fonts/dm-sans-v17-latin-500.woff2",
  "./fonts/dm-sans-v17-latin-600.woff2",
  "./fonts/dm-sans-v17-latin-700.woff2",
  "./fonts/jetbrains-mono-v24-latin-regular.woff2",
  "./fonts/jetbrains-mono-v24-latin-500.woff2"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Future update flow: page sends this when user clicks "Update now"
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle same-origin GET requests
  if (req.method !== "GET") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Stale-while-revalidate: serve cached immediately, fetch fresh in background
      const cached = await cache.match(req);

      const fetchPromise = fetch(req).then((fresh) => {
        if (fresh && fresh.status === 200 && new URL(req.url).origin === self.location.origin) {
          cache.put(req, fresh.clone());
        }
        return fresh;
      }).catch(() => null);

      if (cached) {
        fetchPromise; // fire-and-forget
        return cached;
      }

      // No cache — must wait for network
      const fresh = await fetchPromise;
      if (fresh) return fresh;

      // Offline fallback for navigation
      if (req.mode === "navigate") {
        return cache.match("./offline.html");
      }
      return new Response("Offline", { status: 503 });
    })()
  );
});
