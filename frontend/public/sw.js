// This project no longer enables next-pwa in next.config.js, but older builds
// registered a Workbox service worker that may still be controlling browsers
// and serving stale, cached app routes. This replacement worker self-destructs:
// it deletes every cache, unregisters itself, and force-reloads open tabs so
// the app is served fresh from the network again.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop ALL caches (these are just HTTP response caches — safe to clear).
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));

      // Remove this service worker entirely so it stops intercepting requests.
      await self.registration.unregister();

      // Force every open tab to reload from the network, not the dead cache.
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        client.navigate(client.url);
      }
    })()
  );
});
