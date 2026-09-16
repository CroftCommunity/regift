// Pure service-worker routing decision, extracted so it is unit-testable with no
// SW runtime (the SW itself, sw.ts, is a thin shell around this). The recipe:
//
//   - non-GET            → skip (never intercept)
//   - navigations / HTML → network-first (a shipped update is picked up next
//                          open; the cached shell is the offline fallback)
//   - same-origin assets → cache-first (content-hashed names make staleness
//                          structurally impossible)
//   - cross-origin       → skip (NEVER call respondWith, so Playwright route
//                          fixtures and later PDS/CDN traffic behave identically
//                          with and without the worker)

export type SwStrategy = 'network-first' | 'cache-first' | 'skip';

export interface SwRequestInfo {
  readonly method: string;
  readonly mode: string;
  readonly accept: string;
  readonly sameOrigin: boolean;
}

export function swStrategy(req: SwRequestInfo): SwStrategy {
  if (req.method !== 'GET') return 'skip';
  if (req.mode === 'navigate' || req.accept.includes('text/html')) return 'network-first';
  if (req.sameOrigin) return 'cache-first';
  return 'skip';
}

// ---------------------------------------------------------------------------
// The file share target. A share that carries FILES cannot be a GET — the OS
// posts multipart/form-data — and no static host (GitHub Pages included)
// answers a POST, so the service worker IS the endpoint: it takes the POST,
// parks the files in a cache, and redirects (303) to the page, which collects
// them. The bytes never cross an origin, so CORS never applies — which is the
// only way a Reddit picture gets in at all (see src/core/share-in.ts for the
// 2026-09-16 header measurements).
//
// The deliberate caveat, one release wide: Chrome honours the POST action only
// through a worker that knows this route, and the Croft policy is "ask, don't
// ambush" — an updated worker WAITS for the person to tap Update
// (src/sw-register.ts). So between Chrome picking up the new manifest and that
// tap, a share can POST past the old worker to the host, which answers no POST
// and the share is lost. The fix would be skipWaiting(), which trades this one
// window for ambushing every live session on every future release — a worse
// deal. Flagged, not fixed; the person's next attempt, after the update lands,
// works.

/** The path segment the manifest's `share_target.action` points at. */
export const SHARE_TARGET_PATH = 'share-target';

/** Where the worker parks a share's files for the page to collect. Kept out of
 *  the versioned precache so an activation does not eat a share in flight. */
export const INBOX_CACHE = 'regift-share-inbox';

export interface ShareTargetInfo {
  readonly method: string;
  readonly sameOrigin: boolean;
  readonly path: string;
}

/** Is this the share POST the worker must answer itself? */
export function isShareTarget(req: ShareTargetInfo): boolean {
  if (req.method.toUpperCase() !== 'POST') return false;
  if (!req.sameOrigin) return false;
  return req.path.split('/').pop() === SHARE_TARGET_PATH;
}

/** The cache key for one file of a share. `base` is any URL inside the deploy
 *  (the worker passes its own href, the page passes location.href), so both
 *  sides derive the same key at a root or under a subpath. */
export function shareInboxKey(base: string, index: number): string {
  return new URL(`share-inbox/${index}`, base).href;
}

export interface ShareTargetFields {
  readonly title?: string | null | undefined;
  readonly text?: string | null | undefined;
  readonly url?: string | null | undefined;
}

/**
 * Where the worker redirects after parking a share: the page, told how many
 * files are waiting, plus whatever strings came with them. A share can carry
 * BOTH a picture and the link it came from — the link is what becomes the
 * credit — so neither is dropped, and a file-less share lands exactly as the
 * old GET target delivered it.
 */
export function shareTargetLanding(fields: ShareTargetFields, mediaCount: number): string {
  const params = new URLSearchParams();
  if (mediaCount > 0) params.set('shared-media', String(mediaCount));
  for (const [key, value] of [
    ['title', fields.title],
    ['text', fields.text],
    ['url', fields.url],
  ] as const) {
    if (typeof value === 'string' && value !== '') params.set(key, value);
  }
  const query = params.toString();
  return query === '' ? 'index.html' : `index.html?${query}`;
}
