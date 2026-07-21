const CACHE_PREFIX = "song-world-cup-shell-v4-";
const SCOPE_URL = new URL(self.registration.scope);
const SCOPE_PATH = SCOPE_URL.pathname.endsWith("/") ? SCOPE_URL.pathname : `${SCOPE_URL.pathname}/`;
const APP_SHELL_URL = new URL(SCOPE_PATH, self.location.origin).href;
const API_PATH = `${SCOPE_PATH}api/`;
const CACHE_NAME = `${CACHE_PREFIX}${encodeURIComponent(SCOPE_PATH)}`;

self.addEventListener("install", (event) => {
  event.waitUntil(cacheApplicationShell());
  self.skipWaiting();
});

async function cacheApplicationShell() {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch(APP_SHELL_URL, { cache: "no-store" });
  if (!response.ok) throw new Error("应用壳加载失败");
  await cache.put(APP_SHELL_URL, response.clone());
  const html = await response.text();
  const assetPaths = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)]
    .map((match) => match[1]);
  await Promise.all(assetPaths.map(async (path) => {
    const assetUrl = new URL(path, APP_SHELL_URL).href;
    const asset = await fetch(assetUrl);
    if (asset.ok) await cache.put(assetUrl, asset);
  }));
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    requestUrl.origin !== self.location.origin ||
    requestUrl.pathname.startsWith(API_PATH)
  ) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(APP_SHELL_URL, copy));
          return response;
        })
        .catch(() => caches.match(APP_SHELL_URL)),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    })),
  );
});
