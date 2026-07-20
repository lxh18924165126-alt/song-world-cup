const CACHE_NAME = "song-world-cup-shell-v3";

self.addEventListener("install", (event) => {
  event.waitUntil(cacheApplicationShell());
  self.skipWaiting();
});

async function cacheApplicationShell() {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch("/");
  if (!response.ok) throw new Error("应用壳加载失败");
  await cache.put("/", response.clone());
  const html = await response.text();
  const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)]
    .map((match) => match[1]);
  await Promise.all(assetPaths.map(async (path) => {
    const asset = await fetch(path);
    if (asset.ok) await cache.put(path, asset);
  }));
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    requestUrl.origin !== self.location.origin ||
    requestUrl.pathname.startsWith("/api/")
  ) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/")),
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
