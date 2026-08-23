const CACHE_NAME = "madiba-sfa-shell-v2";
const PRECACHE_URLS = [
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-maskable.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    )).then(() => self.clients.claim()),
  );
});

function shouldUseNetworkOnly(url) {
  return url.pathname.startsWith("/api/")
    || url.pathname.startsWith("/_next/")
    || url.pathname.endsWith(".js")
    || url.pathname.endsWith(".css")
    || url.pathname.endsWith(".json");
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (shouldUseNetworkOnly(url)) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => response)
      .catch(async () => {
        if (event.request.mode === "navigate") {
          const cached = await caches.match("/");
          if (cached) return cached;
        }
        return Response.error();
      }),
  );
});
