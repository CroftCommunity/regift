// Leveled console logger — "the console is the debugger of a backendless app".
// debug/info are gated behind ?debug=1 or localStorage 'regift-debug'; warn/error
// always emit. Every risky boundary (SW lifecycle, storage, later auth/PDS)
// should log through this so a failure is diagnosable from the console alone.
//
// Gotcha to carry forward from arecipe: a `?debug=1` query does not survive an
// OAuth redirect — the localStorage flag is the durable switch around auth.

const TAG = '[regift]';

function debugEnabled(): boolean {
  try {
    if (new URLSearchParams(location.search).get('debug') === '1') return true;
    return localStorage.getItem('regift-debug') === '1';
  } catch {
    return false;
  }
}

export const log = {
  debug(...args: unknown[]): void {
    if (debugEnabled()) console.debug(TAG, ...args);
  },
  info(...args: unknown[]): void {
    if (debugEnabled()) console.info(TAG, ...args);
  },
  warn(...args: unknown[]): void {
    console.warn(TAG, ...args);
  },
  error(...args: unknown[]): void {
    console.error(TAG, ...args);
  },
};
