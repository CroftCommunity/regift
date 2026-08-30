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

The e2e proves the mux on 2-second fixtures in desktop Chromium, and the 2026-08-30 device
run only exercised short clips. Nobody has measured a large input in Android System WebView
(single-thread core grows from 32 MB); the ceiling of interest is Bluesky's new 300 MB /
10-minute limit, since that is the biggest file a destination will take. Run a multi-minute
v.redd.it post on the Pixel; record wall-clock and whether it survives. Outcome decides:
input cap, mandatory trim, or a native ffmpeg in the app. A laptop cannot stand in — the
2026-08-30 probing got the laptop's IP refused by Reddit within hours (see E158).
`[device: android]`

## 2a. Verify Google Photos shows the embedded credit

Shipped 2026-08-30: images carry the credit as EXIF/iTXt/GIF-comment, videos as MP4
container tags. Photos is expected to show description/author in its info panel for
images; for video it is unverified. Regift something of each kind, open ⓘ in Photos,
record what is visible. Outcome decides whether the extra ffmpeg tagging pass for
non-Reddit mp4s (a full core load for cosmetics) stays or goes. `[device: android]`

## 3. A pure-JS fMP4 muxer

The CMAF tracks are fragmented MP4; joining two into one is a container rewrite a few
hundred lines of TypeScript could do, replacing the 31 MB ffmpeg core for the common case.
Measure before building: the SW caches the core after first use, so the cost is one download.

## 4. Pixelfed (gram.social)

Classified and refused with the reason (status endpoints `302 → /login` on two instances,
2026-08-30). The open question — is there any unauthenticated door at all — is the backlog's,
not this pile's: **E157** in `discovery/alpha/ROADMAP_TODO.md`, which needs a full
gram.social post link to probe. If E157 closes the door, Pixelfed becomes a line item in
§1: the native courier reads it the way it will read Reddit pictures.

## 5. Facebook and other sources

Out of scope until the Reddit loop has a courier that needs no assistance. yt-dlp's
extractors are the living reference; definitions should be data, not code.
