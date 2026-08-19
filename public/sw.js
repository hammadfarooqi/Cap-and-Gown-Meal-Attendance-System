/**
 * Cap & Gown Meal Attendance System — station app service worker.
 *
 * Why this exists: IndexedDB holds everything a tablet needs to serve a meal,
 * but the app shell is fetched over the network. Without this file, reloading
 * a tablet during a Wi-Fi outage shows a browser error and the warm cache is
 * unreachable. This makes the shell survive the outage too.
 *
 * NETWORK FIRST, deliberately. Cache-first is the usual advice because it is
 * faster, but it means a tablet keeps running old code after a fix is
 * deployed. For a system that has to be fixable mid-semester that is the
 * wrong trade. An online tablet always gets current code; the cache only
 * comes out when the network does not answer.
 */

const CACHE = "cap-station-v1";
const SHELL = "/station";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Seed the shell. Everything else caches itself on first successful use,
      // because bundle filenames are content-hashed and cannot be listed here.
      await cache.add(SHELL).catch(() => {});
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop every older version, so a tablet that lives four years does not
      // accumulate the shell of every build it has ever seen.
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // NEVER cache the API. A stale answer is worse than no answer: the tablet
  // could resolve a card from an old response, or believe a sync succeeded
  // when it did not. A failed call is already handled correctly upstream.
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    // A navigation with nothing cached for this exact URL still gets the
    // shell. The app boots from IndexedDB from there.
    if (request.mode === "navigate") {
      const shell = await cache.match(SHELL);
      if (shell) return shell;
    }

    return Response.error();
  }
}
