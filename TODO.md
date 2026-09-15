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
[device done 2026-09-14: android=samsung]

**Result (2026-09-14, Samsung SM-S947U1, Chrome 152, the vendored single-thread 0.12.10
core served over `adb reverse`, synthetic clips):** a 45 MB 4-minute 720p track + 4 MB
audio muxed by stream copy in **139 ms** (49 MB out); a 60-second part cut from the same pair
in ~40 ms (12.3 MB), from the start or from 2:00 in, when `-t` is an OUTPUT option — placed
before an input it cut that track only and the audio ran the full four minutes. The wasm
heap took a **218 MB** input file plus its output without failing. Outcome: no input cap,
no mandatory trim, no native ffmpeg — the mux is not the cost. A real v.redd.it post on a
phone is still the honest end-to-end run, but the size question is answered. The encode
ceiling measured the same night is §6.

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

## 6. Shrink a local mp4 for a destination's size limit

**Decided 2026-09-14 from measurement, not yet planned.** A file shared INTO regift (a
`POST` / `multipart/form-data` share target with a `files` entry, the service worker
stashing the file and redirecting — Android Chrome only, like today's link share) is
brought under a size budget the person names, two ways: **parts** (cut at keyframes by
stream copy, each under budget, `1/N … N/N`) or **one file** (re-encode to H.264 at the
bitrate that fits, resolution capped at 360p/720p). The core reads duration, dimensions,
codec and bitrate from the container (`mvhd`/`tkhd`/`stsd`, platform-free) and states the
verdict and the ETA BEFORE any work: a stretch is a number the person sees, not a spinner.
A `Shrinker` port beside `Muxer` — the Muxer's contract stays "stream copy only". No new
dependency: the vendored core already carries libx264 (its configure string says so).

**Encode ceiling (2026-09-14, same phone and core as §2; 20 s clips, 600 frames; "easy" =
testsrc2, "noisy" = testsrc2 + temporal noise at a real-world bitrate, "noise" = pure noise,
92 MB at 360p — the floor no real footage reaches):**

| input → x264 | ultrafast | veryfast | medium |
|---|---|---|---|
| 360p MPEG-4 Part 2, easy | 392 fps | 122 fps | 43 fps |
| 360p MPEG-4 Part 2, noisy | 328 fps | 110 fps | — |
| 360p, pure noise | 160 fps | 50 fps | — |
| 720p H.264, noisy | 86 fps | 29 fps | — |
| 720p, pure noise | 27 fps | 10.5 fps | — |
| 720p → 360p downscale, noisy | 114 fps | — | — |

Core load 0.8 s once cached. So the 44.83 MB 360p clip that prompted this (8–12 minutes,
15–22k frames) is **2–4 minutes on veryfast, under a minute on ultrafast** — comfortable;
720p veryfast is the first rung that is a wait, and `medium` is off the table. Calibrate
per device with a two-second run and keep the rate locally; the ETA is arithmetic from it.
Not measured: real camera footage (between "noisy" and "noise"), a background tab, a
throttled phone. WebCodecs (hardware encode) is the rung after this one, only if a
measured device says wasm is too slow — it needs a demux/remux in JS (§3 becomes
load-bearing). The workspace architecture card widens from "a shared post" to "a shared
post or file" when this lands. [device: android] for the real-footage run (since 2026-09-14).
