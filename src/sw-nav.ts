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
