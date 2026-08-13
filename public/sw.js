/* global self, caches, fetch, URL */

const CACHE_VERSION = "together-static-v5";
const PRECACHE_URLS = [
  "/offline",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/maskable-512.png",
  "/apple-touch-icon.png",
  "/assets/natural-earth-land-50m.svg",
  "/assets/natural-earth-admin0-boundaries-50m.svg",
];
const STATIC_DESTINATIONS = new Set(["font", "image", "script", "style"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          const response = await fetch(url, { cache: "reload" });
          if (!response.ok) throw new Error(`Unable to precache ${url}`);
          await cache.put(url, response);
        }),
      );
      await self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => key.startsWith("together-static-") && key !== CACHE_VERSION)
              .map((key) => caches.delete(key)),
          ),
        ),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (
    url.pathname.startsWith("/api/")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const fallback = await caches.match("/offline");
        return fallback ?? Response.error();
      }),
    );
    return;
  }

  if (
    STATIC_DESTINATIONS.has(request.destination) ||
    PRECACHE_URLS.includes(url.pathname)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const update = fetch(request)
          .then(async (response) => {
            if (response.ok && response.type === "basic") {
              const cache = await caches.open(CACHE_VERSION);
              await cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => cached ?? Response.error());
        return cached ?? update;
      }),
    );
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});
