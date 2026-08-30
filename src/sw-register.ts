// Service-worker registration + the "ask, don't ambush" update flow. A failure
// is logged and swallowed (progressive enhancement). `updateViaCache: 'none'` so
// sw.js itself is not HTTP-cached and a shipped update is discovered promptly.
//
// The default policy (docs/PRACTICES.md → "Service-worker updates"): an updated
// worker WAITS; we surface it (the update toast + Settings → Update) and only
// take it over when the user asks (applyUpdate → SKIP_WAITING → reload on
// controllerchange). No under-the-feet swap of a live session.
import { log } from './log';

let registration: ServiceWorkerRegistration | null = null;
let updateWaiting = false;
let applying = false;
const listeners = new Set<() => void>();

function announce(): void {
  updateWaiting = true;
  for (const cb of listeners) cb();
}

function watch(reg: ServiceWorkerRegistration): void {
  registration = reg;
  // An update that installed before this page loaded is already waiting.
  if (reg.waiting && navigator.serviceWorker.controller) announce();
  reg.addEventListener('updatefound', () => {
    const installing = reg.installing;
    if (!installing) return;
    installing.addEventListener('statechange', () => {
      // "installed" + an existing controller means this is an update, not the
      // first install — it is now waiting.
      if (installing.state === 'installed' && navigator.serviceWorker.controller) announce();
    });
  });
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  // Reload once the worker we asked for takes control. Guarded so first-install
  // clients.claim() (which also fires controllerchange) does not reload.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applying) location.reload();
  });
  window.addEventListener('load', () => {
    // Relative so the scope is the deploy directory (root or a subpath).
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(
      (reg) => {
        log.info('sw registered', reg.scope);
        watch(reg);
      },
      (err) => log.warn('sw registration failed', err),
    );
  });
}

/** Register a callback for when an update is waiting (fires immediately if already). */
export function onUpdateAvailable(cb: () => void): void {
  listeners.add(cb);
  if (updateWaiting) cb();
}

export function isUpdateWaiting(): boolean {
  return updateWaiting;
}

/** Ask the waiting worker to take over; the page reloads on controllerchange. */
export function applyUpdate(): void {
  const waiting = registration?.waiting;
  if (!waiting) return;
  applying = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

/** Poll for an update now; resolves true if one is (now) waiting. */
export async function checkForUpdate(): Promise<boolean> {
  if (!registration) return false;
  try {
    await registration.update();
  } catch (err) {
    log.warn('sw update check failed', err);
    return false;
  }
  if (registration.waiting && navigator.serviceWorker.controller) announce();
  return updateWaiting;
}
