# regift

**Share a post in, get the video out.** regift is a Croft PWA you share a Reddit post to
from the Android share sheet; it extracts the video *on your device* — video and audio
tracks fetched straight from Reddit's CDN and joined with ffmpeg.wasm — and hands the
finished file to the next app through the same share sheet: Google Photos, Bluesky,
whatever is installed. No server, no account, no ads. Nothing you share leaves your device
except to the app you hand the file to.

Live: <https://croftcommunity.github.io/regift/> (install it from the browser menu; the
share target only registers for an *installed* PWA).

## What works today (2026-08-30)

```
Reddit post ──share──► regift ──► read post ──► fetch tracks ──► mux ──► share sheet
                                   │              (v.redd.it,    (ffmpeg.wasm,
                                   │               CORS-open)     on-device)
                                   └── JSONP with your browser's Reddit cookies; if refused,
                                       an assisted route (old Reddit long-press, or share the data)
```

- **Share in.** The Web Share Target receives `url`, `text` or `title`; the first http(s)
  link in any of them is the post.
- **Reading the post.** reddit.com sends no CORS headers, so a page cannot `fetch` the
  post's JSON — but Reddit still honours `?jsonp=`, and a `<script>` load carries your
  browser's own Reddit cookies, so regift reads the post with no step from you when you are
  signed in to Reddit in that browser. When that is refused (signed out, third-party cookies
  blocked), the assisted step offers the quickest route — open on old Reddit, long-press the
  title, Share link to regift (the title *is* the `v.redd.it` link) — or the post data:
  select all, share the selection to regift, or paste it. A `/s/` link from Reddit's own
  share button is a redirect only a browser can follow: open it, then share from *the
  browser's* menu instead.
- **Everything after that is automatic** and runs in the page: the DASH manifest and the
  best video + audio tracks come from `v.redd.it` (which is CORS-open, unsigned), and
  ffmpeg.wasm stream-copies them into one MP4 (no re-encode).
- **Share out.** `navigator.share({ files })` on Android Chrome opens the system share
  sheet; elsewhere, Save downloads the file.

Why the assisted step exists, and the courier ladder that removes it (a browser extension
on desktop/Firefox; a native shell on Android), is recorded in
`plans/2026-08-30-plan-regift-slice.md`.

## Built for a native release without a rewrite

The core (`src/core/`) is platform-free and never touches `fetch`, `window` or the DOM. It
depends on three ports (`src/core/ports.ts`): a **Courier** that reads URLs and *says
which origins it can read*, a **Muxer**, and a **ShareOut**. The web adapters live in
`src/adapters/web/`. A Capacitor Android shell is the same `dist/` plus native adapters —
a courier that can read reddit.com (removing the assisted step), the SEND intent-filter,
and `@capacitor/share` — not a second app.

## Quick start

```
npm install         # refuses on the wrong Node — see .nvmrc + .npmrc
npm test            # the gate: lint · typecheck · unit · build · e2e
npm run build       # → dist/  (self-contained static site, ffmpeg core vendored)
npm run serve       # serve dist/ at http://localhost:4173
```

Node is pinned to `.nvmrc` (22) and enforced by `engine-strict`; use a version manager that
reads the pin (`fnm install`, `eval "$(fnm env --use-on-cd)"`).

## Layout

- `src/core/` — the platform-free pipeline: `share-in`, `reddit/{link,post,dash}`,
  `pipeline`, `ports`.
- `src/adapters/web/` — `fetch-courier`, `ffmpeg-muxer`, `share-out`.
- `src/pages/` — one entry per HTML shell (`index`, `settings`); `src/nav.ts`, `theme.ts`,
  `sw*.ts`, `log.ts`, `version.ts` are the croft-pwa chassis.
- `tests/unit/` (vitest, node) · `tests/e2e/` (Playwright against the built bundle;
  the mux test runs the real ffmpeg.wasm) · `tests/fixtures/` (a captured DASH manifest,
  hand-shaped post listings, and 2-second synthetic media tracks).
- `build.mjs` — esbuild + content hashes + CSP/SRI + service worker + vendored ffmpeg core.
- `plans/` — dated plans (Problem / Approach / Reasoning). `TODO.md` — known, deferred work.

## Licence

AGPL-3.0-only. ffmpeg.wasm (`@ffmpeg/core`) is LGPL/GPL and vendored into `dist/` at build
time from the pinned npm package.
