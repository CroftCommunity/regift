# CLAUDE.md — notes for agents working in this repo

## Identity (workspace architecture)

**Scope:** regift — a Croft PWA that receives a shared social-platform post, extracts the
media on-device, and hands the file to the next app via the share sheet. Reddit video,
Bluesky, Mastodon and Tumblr media → anywhere, today. **Not this repo:** any server, any account with the source platform, any
publishing to a destination (the destination app does its own upload).
**Provides:** the platform-free extraction core + web adapters. **Consumes:** the croft-pwa
chassis (build, SW, tokens, gate). Card + altitudes: `CroftC/.claude/ARCHITECTURE.md`.

## The gate

```
npm test          # lint · typecheck · unit (vitest) · build · e2e (playwright)
```

CI runs this exact command (`.github/workflows/ci.yml`, the workspace CI shape). Node is
pinned (`.nvmrc` 22) and enforced (`.npmrc` engine-strict). The e2e tier drives the BUILT
bundle on Chromium, and `tests/e2e/regift.spec.ts` runs the **real ffmpeg.wasm** from
`dist/vendor/ffmpeg/` — a mux failure there is a real failure, not a mock drift.

Local e2e gotcha (chassis): the Playwright server on 4183/4184 is reused off-CI; a stale one
serving an older `dist/` fails SRI silently. `lsof -ti :4183 -ti :4184 | xargs kill -9`.

## The shape, and the rule that keeps native cheap

`src/core/` is platform-free: no `fetch`, no `window`, no DOM, unit-tested in node. It talks
to the shell only through `src/core/ports.ts` — **Courier** (`canRead(url)` is the load-
bearing method: a page cannot read reddit.com, a native HTTP stack can), **Muxer**,
**ShareOut**. Web adapters in `src/adapters/web/`. **Do not import an adapter from core,
and do not let a DOM type into core** — that is the whole preparation for the Capacitor
shell (same `dist/`, native adapters, nothing else).

Measured facts the design rests on (2026-08-30, real Chromium, residential IP; re-measure
before assuming they still hold):

- `v.redd.it` sends `access-control-allow-origin: *`; the DASH manifest and every
  `CMAF_*.mp4` track answer 200 **unsigned**. `DASH_*.mp4` names 403. `packaged-media.redd.it`
  (pre-muxed MP4s) sends no CORS.
- `www.reddit.com/...json` has no CORS and 403s non-browser TLS; a browser navigation
  passes (a `loid` cookie is set on first visit to old.reddit.com). A *second cold* profile
  minutes later was refused — reputation counts repeated cold bootstraps.
- `www.reddit.com/....json?jsonp=<cb>` loaded as a `<script>` from a foreign origin FIRES
  the callback with the full post when the browser carries Reddit cookies; cold, the
  script errors (403). This is the PWA's no-step courier; it is not the resilient one
  (`TODO.md` §1). CSP admits `https://www.reddit.com` in `script-src` for it, nothing else.
- old.reddit's post title anchor is the bare `https://v.redd.it/<id>` (`a.title[href]`,
  `.thing[data-url]`) — the no-JSON fallback: long-press → Share link → regift.
- **Bluesky:** AppView + plc.directory + PDS `getBlob` are all `ACAO *`; the blob is the
  ORIGINAL upload (no mux). `cdn.bsky.app` sends no CORS — images come from the PDS too.
- **Mastodon:** `/api/v1/statuses/:id` and the files host are `ACAO *` (mastodon.social).
- **Tumblr:** v2 needs a key; the legacy `<blog>.tumblr.com/api/read/json?id=` answers as
  JavaScript (`var tumblr_api_read = {…}`) with no CORS, loaded as a script; both media CDNs
  are `ACAO *`. A `video` post may be a YouTube embed — refused by name.
- **Pixelfed:** status endpoints `302 → /login` without a session on gram.social and
  pixelfed.social; refused with the reason.
- A `/s/` share link 307s; appending `.json` to it lands on the subreddit root, not the post.
- Reddit's mobile web share button sends `navigator.share({ url })` with only the `/s/` link.

## Conventions

- **TDD, RED first.** Core behaviour gets a vitest test before code; page wiring gets an e2e.
  Fixtures are the contract: `tests/fixtures/reddit/` (captured manifest, shaped listings),
  `tests/fixtures/media/` (2-second synthetic tracks made with ffmpeg.wasm itself).
- **Hex only in `tokens.css`**; components use `var()`. Relative paths only. Pages, not
  modals. Mobile-first: tap targets ≥44px, no overflow at 320/360/390 (measured by element
  geometry, not `scrollWidth` alone).
- **CSP is `default-src 'none'`**; `connect-src 'self' https:` (the app fetches media from
  hosts the person chose — decided 2026-08-30, why in `build.mjs`); `script-src` names exactly
  the two legacy-read origins (`https://www.reddit.com` JSONP, `https://*.tumblr.com`) plus
  `'wasm-unsafe-eval'`. Adding a script origin is a design decision, not a fix. Widening it is a design decision, not a fix.
- **ffmpeg core is vendored same-origin by `build.mjs`** from the pinned npm package, never
  precached (31 MB), fetched on first mux, kept by the SW's cache-first rule.
- No YouTube — not in code, copy, or listings.
- Commit on a `claude/<feature>` branch in a worktree; land by PR; ask before merging
  unless told (`CroftC/.claude/COORDINATION.md`). Every landing writes its `CHANGELOG.md`
  entry first (`CroftC/.claude/CHANGELOGS.md`).

## Known gaps

`TODO.md` — known, deferred work with the why. The two that matter most: the assisted step
(a courier ladder removes it: extension, then native), and no on-device measurement yet of a
~100 MB mux in Android WebView.
