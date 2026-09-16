// Service worker source — bundled by build.mjs to a stable-named dist/sw.js with
// the precache manifest injected via `define`. skipWaiting + clients.claim so a
// shipped update (which may carry a fix) is never stranded behind a stale
// worker. The routing decision lives in the pure, unit-tested swStrategy().
//
// The worker is also the app's ONE endpoint: a file share arrives as a POST
// (multipart/form-data) that no static host answers, so this file takes it,
// parks the files, and redirects to the page — see src/sw-nav.ts for why that
// is the only way a Reddit picture gets in, and for the one-release caveat.
//
// This file is typed against the DOM lib (not WebWorker) to keep one tsconfig;
// the SW globals we use are declared locally and cast from `self`.
import { swStrategy, isShareTarget, shareInboxKey, shareTargetLanding, INBOX_CACHE } from './sw-nav';
import { sharedMedia } from './core/share-in';

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
  location: { origin: string; href: string };
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
      // Spare the share inbox: it is not a build artefact, and a share that
      // landed moments before this activation is still waiting to be collected.
      await Promise.all(keys.filter((k) => k !== __CACHE__ && k !== INBOX_CACHE).map((k) => caches.delete(k)));
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

/** A form field as a string, or null — `getAll` also yields Files. */
function field(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * The share POST: park the media, then send the person to the page.
 *
 * NOTHING here may throw. A share that fails to park must still land the person
 * on the page (with the strings, if those survived) rather than on the host's
 * "405" — the file is lost either way, but the app is not.
 */
async function receiveShare(request: Request): Promise<Response> {
  const base = sw.location.href;
  let landing = 'index.html';
  try {
    const form = await request.formData();
    const media = sharedMedia(form.getAll('media').filter((v): v is File => typeof v !== 'string'));
    // One share at a time: whatever is in the inbox is either already collected
    // or superseded by this share.
    await caches.delete(INBOX_CACHE);
    const cache = await caches.open(INBOX_CACHE);
    await Promise.all(
      media.map((item, i) =>
        cache.put(
          shareInboxKey(base, i),
          // The filename rides as a header because a Response has nowhere else
          // to put it; percent-encoded because header values are latin-1 and a
          // shared file is named in whatever script its owner uses.
          new Response(item.file, {
            headers: { 'content-type': item.mime, 'x-regift-filename': encodeURIComponent(item.filename) },
          }),
        ),
      ),
    );
    landing = shareTargetLanding(
      { title: field(form.get('title')), text: field(form.get('text')), url: field(form.get('url')) },
      media.length,
    );
  } catch {
    // Land on the page anyway; it says what arrived (nothing) in words.
  }
  // 303: the browser follows it with a GET, so a reload never re-posts.
  return Response.redirect(new URL(landing, base).href, 303);
}

sw.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (isShareTarget({ method: request.method, sameOrigin: url.origin === sw.location.origin, path: url.pathname })) {
    event.respondWith(receiveShare(request));
    return;
  }
  const strategy = swStrategy({
    method: request.method,
    mode: request.mode,
    accept: request.headers.get('accept') ?? '',
    sameOrigin: url.origin === sw.location.origin,
  });
  if (strategy === 'network-first') event.respondWith(networkFirst(request));
  else if (strategy === 'cache-first') event.respondWith(cacheFirst(request));
});
