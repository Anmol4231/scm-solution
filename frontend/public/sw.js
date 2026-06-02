// This project no longer enables next-pwa in next.config.js, but older builds
// may still have this public service worker registered in users' browsers.
// Keep a tiny cleanup worker here so existing registrations update, stop
// intercepting app routes, and remove stale Workbox runtime caches.
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.includes("workbox") || key === "dev" || key === "start-url")
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});
