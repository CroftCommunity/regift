# TODO — regift

> Known work only — items whose shape is already decided. Open questions belong in the
> backlog of record, `discovery/alpha/ROADMAP_TODO.md` (`CroftC/.claude/TRACKING.md`).

## 1. The Android app — the resilient courier (decided 2026-08-30)

The PWA now reads a post with no user step by JSONP, **when the browser carries Reddit
cookies and sends them cross-site**. That is a real courier but not a resilient one: a
browser that blocks third-party cookies (Brave Shields), a signed-out browser, or Reddit
retiring `jsonp=` each drop it to the assisted step. The resilient courier is a local app,
because it is a real user on a real device on a real network — the shape Reddit must keep
admitting.

**Build it as a Capacitor Android shell on the same `dist/`, and start with the
hidden-WebView courier, not CapacitorHttp** (owner decision, 2026-08-30): a real
Chrome-engine navigation to the post's `.json`, cookies in the system CookieManager,
indistinguishable from the person tapping the link. CapacitorHttp (the OS HTTP stack) is
an optimisation to measure afterwards, not the first rung — its fingerprint is the one
unknown, and the WebView has none. Then the SEND intent-filter for share-in and
`@capacitor/share` for share-out. The core does not change; `Courier.canRead` is the seam.

Second courier for desktop/Firefox: the croft-pwa Croft Bridge extension pattern
(`croft-pwa/docs/CONTENT-FETCH.md`), reporting `reddit.com` readable when detected.

## 2. Measure a large mux on a real phone

The e2e proves the mux on 2-second fixtures in desktop Chromium. Nobody has measured a
~100 MB input in Android System WebView (single-thread core grows from 32 MB). Run it on
the Pixel with a long v.redd.it post; record wall-clock and whether it survives. Outcome
decides: input cap, mandatory trim, or a native ffmpeg on Android. `[device: android]`

## 3. A pure-JS fMP4 muxer

The CMAF tracks are fragmented MP4; joining two into one is a container rewrite a few
hundred lines of TypeScript could do, replacing the 31 MB ffmpeg core for the common case.
Measure before building: the SW caches the core after first use, so the cost is one download.

## 4. Facebook and other sources

Out of scope until the Reddit loop has a courier that needs no assistance. yt-dlp's
extractors are the living reference; definitions should be data, not code.
