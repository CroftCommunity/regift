// Build stamp, injected by build.mjs via esbuild `define`. Falls back to a
// sentinel so a non-built import (e.g. a stray unit test) never throws.
declare const __CROFT_VERSION__: string;

export const VERSION: string =
  typeof __CROFT_VERSION__ === 'string' ? __CROFT_VERSION__ : 'v0 dev+nobuild';
