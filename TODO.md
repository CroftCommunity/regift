# TODO — regift

> Known work only — items whose shape is already decided. Open questions belong in the
> backlog of record, `discovery/alpha/ROADMAP_TODO.md` (`CroftC/.claude/TRACKING.md`).

## 1. Remove the assisted step — the courier ladder

Today a page cannot read `www.reddit.com/....json` (no CORS; non-browser TLS is refused), so
the person opens the post data and pastes it. The ladder that removes that, in order:

1. **Browser extension courier** (desktop Chromium/Firefox; Firefox for Android). The
   croft-pwa Croft Bridge pattern (`croft-pwa/docs/CONTENT-FETCH.md`): the page asks, the
   extension reads with the browser's own TLS and cookie jar, per-host consent. The core
   already routes on `Courier.canRead`; this is a second web courier that reports
   `reddit.com` readable when the bridge is detected.
2. **Capacitor Android shell** — native courier (CapacitorHttp, or a hidden WebView
   navigation if the OS HTTP stack is refused), SEND intent-filter for share-in,
   `@capacitor/share` for share-out. Same `dist/`. Decide the WebView-memory question first
   (item 2).

Deferred because the pure-PWA loop had to be proven end to end first, and was (2026-08-30).

## 2. Measure a large mux on a real phone

The e2e proves the mux on 2-second fixtures in desktop Chromium. Nobody has measured a
~100 MB input in Android System WebView (single-thread core grows from 32 MB). Run it on
the Pixel with a long v.redd.it post; record wall-clock and whether it survives. Outcome
decides: input cap, mandatory trim, or a native ffmpeg on Android. `[device: android]`

## 3. Quality choice

`pickTracks` takes the best video with no height cap. Offer a cap (e.g. 720p for a smaller
file) in the UI; the core already accepts `maxHeight`.

## 4. A pure-JS fMP4 muxer

The CMAF tracks are fragmented MP4; joining two into one is a container rewrite a few
hundred lines of TypeScript could do, replacing the 31 MB ffmpeg core for the common case.
Measure before building: the SW caches the core after first use, so the cost is one download.

## 5. Facebook and other sources

Out of scope until the Reddit loop has a courier that needs no assistance. yt-dlp's
extractors are the living reference; definitions should be data, not code.
