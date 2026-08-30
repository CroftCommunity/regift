// Service worker source — bundled by build.mjs to a stable-named dist/sw.js with
// the precache manifest injected via `define`. skipWaiting + clients.claim so a
// shipped update (which may carry a fix) is never stranded behind a stale
// worker. The routing decision lives in the pure, unit-tested swStrategy().
//
// This file is typed against the DOM lib (not WebWorker) to keep one tsconfig;
// the SW globals we use are declared locally and cast from `self`.
import { swStrategy } from './sw-nav';

declare const __PRECACHE__: readonly string[];
declare const __CACHE__: string;

interface ExtEvent {
  waitUntil(p: Promise<unknown>): void;
}
interface FetchEventLike {
  readonly request: Request;
  respondWith(r: Promise<Response>): void;
}
interface MessageEventLike {
  readonly data: unknown;
}
interface SWGlobal {
  addEventListener(type: 'install' | 'activate', cb: (e: ExtEvent) => void): void;
  addEventListener(type: 'fetch', cb: (e: FetchEventLike) => void): void;
  addEventListener(type: 'message', cb: (e: MessageEventLike) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  location: { origin: string };
}

const sw = self as unknown as SWGlobal;

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(__CACHE__);
      // Per-asset tolerance: one missing precache entry must not brick install.
      await Promise.all(
        __PRECACHE__.map((url) =>
          cache.add(url).catch(() => {
            /* tolerate a single miss */
          }),
        ),
      );
      // NB: no skipWaiting() here. The Croft default is "ask, don't ambush" — an
      // updated worker WAITS until the page asks it to take over (the update
      // toast, or the Settings → Update button, posts SKIP_WAITING below). A
      // first install has no active worker to wait behind, so it activates and
      // clients.claim()s immediately (offline works on first visit). Apps that
      // need a patch to land unconditionally (e.g. a safety fix) instead call
      // skipWaiting() here — see docs/PRACTICES.md → "Service-worker updates".
    })(),
  );
});

// The page asks the waiting worker to take over (user-initiated update).
sw.addEventListener('message', (event) => {
  const data = event.data;
  if (typeof data === 'object' && data !== null && 'type' in data && data.type === 'SKIP_WAITING') {
    void sw.skipWaiting();
  }
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== __CACHE__).map((k) => caches.delete(k)));
      await sw.clients.claim();
    })(),
  );
});

async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) {
    const cache = await caches.open(__CACHE__);
    await cache.put(request, res.clone());
  }
  return res;
}

async function networkFirst(request: Request): Promise<Response> {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(__CACHE__);
      await cache.put(request, res.clone());
    }
    return res;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

sw.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const strategy = swStrategy({
    method: request.method,
    mode: request.mode,
    accept: request.headers.get('accept') ?? '',
    sameOrigin: url.origin === sw.location.origin,
  });
  if (strategy === 'network-first') event.respondWith(networkFirst(request));
  else if (strategy === 'cache-first') event.respondWith(cacheFirst(request));
});
