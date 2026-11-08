/**
 * The offline shell for the two tools.
 *
 * Deliberately hand-written and deliberately small. Workbox would be a dependency and a build step
 * for a cache whose contents fit on one screen, and the failure mode it is easiest to ship — a
 * service worker nobody can update — is a configuration problem, not a code-size one.
 *
 * The rules:
 *   - The tool pages and their assets are cached as they are used, then served cache-first. Once
 *     a location is chosen, `/times` and `/qibla` need nothing from the network ever again: the
 *     computation is local and the city list is a static module.
 *   - Everything is scoped to one versioned cache. Bumping VERSION drops the old one whole, which
 *     is the only cache invalidation strategy that cannot go subtly wrong.
 *   - `skipWaiting` + `clients.claim` so a republished site reaches an installed copy on the next
 *     launch rather than the one after. `_headers` serves this file with `Cache-Control: no-cache`
 *     for the same reason; without that a stale worker can pin a stale site indefinitely.
 *   - Navigations fall back to the cached page when the network is gone, and to `/times` when the
 *     requested page was never cached — an installed app that opens on a blank error is worse than
 *     one that opens on the thing it was installed for.
 *
 * ## The CSP, and the mistake that shipped
 *
 * A service worker's fetches ARE governed by a Content-Security-Policy — the one delivered with
 * *this file*, not the one on the page. The first version of this worker shipped under the site's
 * page policy, which is `connect-src 'none'`, so every fetch here was refused, the precache was
 * empty, and navigations resolved to `Response.error()`: the worker took the site over and then
 * could not serve it. `/sw.js` is now sent its own policy (`connect-src 'self'`), which is the
 * narrowest thing that lets it keep a copy of our own pages.
 *
 * The pages themselves keep `connect-src 'none'`. That is the claim that matters and it is
 * unchanged: the page that reads your coordinate still cannot send it anywhere. This file never
 * sees it — it proxies navigations and asset GETs, and every request it makes is same-origin.
 *
 * ## Failing safe
 *
 * Because that mistake broke the live site rather than merely disabling offline, the worker now
 * proves it can fetch before it intercepts anything. Until the probe answers, and forever if the
 * answer is no, every request passes straight through to the browser. A worker that cannot fetch
 * must get out of the way, not take the site down with it.
 */
const VERSION = 'v2';
const CACHE = `simple-prayer-${VERSION}`;

/** The minimum that makes an installed copy useful with no network at all. */
const SHELL = ['/times', '/qibla'];

/**
 * Whether this worker is allowed to fetch at all: `null` until the probe answers, then a boolean.
 * The fetch handler refuses to intercept anything while this is not `true`, which is what keeps a
 * blocked worker harmless instead of fatal.
 */
let fetchAllowed = null;

const probe = fetch(new Request('/manifest.webmanifest', { cache: 'no-store' }))
  .then(() => {
    fetchAllowed = true;
  })
  .catch(() => {
    fetchAllowed = false;
  });

self.addEventListener('install', (event) => {
  event.waitUntil(
    probe
      .then(() => (fetchAllowed ? caches.open(CACHE) : Promise.reject(new Error('fetch blocked'))))
      // `reload` so installing never picks up a stale copy from the HTTP cache.
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
      // A failed precache must not fail the install: the worker is still useful for what it can
      // cache at runtime, and the site works online regardless.
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Not yet proved able to fetch, or proved unable: stay out of the way entirely.
  if (fetchAllowed !== true) return;

  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the worker itself, and never let it serve a stale copy of itself.
  if (url.pathname === '/sw.js') return;

  // The press-kit downloads are large zips and full-size images for writers on a computer. The
  // offline copy is for the tools, so they go straight to the network and are never cached here.
  if (url.pathname.startsWith('/press/files/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallback = await caches.match('/times');
          return fallback ?? Response.error();
        })
    );
    return;
  }

  // Assets are content-addressed by Astro (`/_astro/*`) or stable by name (fonts, icons), so
  // cache-first costs nothing and is what makes the second launch instant.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
    )
  );
});
