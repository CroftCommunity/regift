# Plan: regift — the first slice, a pure PWA from share-in to share-out

date: 2026-08-30
identity: chasemp (`chase@owasp.org`, `github-personal`), repo `CroftCommunity/regift`
Status: **landed and device-verified (2026-08-30)** — share from Chrome's menu → regift → video,
on the Pixel as a Chrome WebAPK. Open: the large-input measurement (TODO §2).

## Problem Statement

Reposting a Reddit video elsewhere (Google Photos, Bluesky) means an ad-filled downloader
app today (the Viddit screenshots, 2026-08-30). The owner wants regift: share a post in,
get the video out, **as a PWA first**, built so the same core ships as a native app later.

Goal #1, verbatim: *"share from reddit to the regift pwa and then use it to upload the
extracted content to google photos ... as a pwa not a native app."* The owner reads Reddit
through the **mobile web page**, not the app.

## What was measured before designing (real Chromium, residential IP, 2026-08-30)

| Fact | Result | Consequence |
|---|---|---|
| `curl` to `www.reddit.com/…/.json` | 403 (TLS fingerprint gate) | a server-side relay is the thing Reddit blocks |
| Chromium, cold, `old.reddit.com` then `.json` | `loid` cookie set, **200**, real `reddit_video` | a browser passes; the person's browser is the courier of last resort |
| second cold profile minutes later | 403 | reputation counts cold bootstraps; keep one profile's cookies |
| page `fetch()` of `.json` cross-origin | `Failed to fetch` (no CORS) | the one link a pure page cannot do |
| `v.redd.it/<id>/DASHPlaylist.mpd` **unsigned**, cross-origin | **200**, ACAO `*` | the page can read the track list itself |
| `CMAF_720.mp4` / `CMAF_AUDIO_128.mp4` unsigned | 200 (2.0 MB / 200 KB; `vide` / `soun`) | the page can fetch the tracks itself |
| `DASH_96.mp4` | 403 | wrong name, not a block — the manifest is the source of names |
| `packaged-media.redd.it` pre-muxed MP4s | no CORS | a page cannot skip the mux |
| Reddit mobile-web share button | `navigator.share({url: "/s/…"})` only | share-in is one link, often a redirect |
| `/s/<id>.json` | 307 to the subreddit root | a `/s/` link cannot be turned into JSON by suffixing |
| Brave Android extensions | none ("TBD", July 2026); Edge curated only; Firefox yes | no extension courier on the owner's phone browser |

## Approach

One repo on the croft-pwa chassis; a platform-free core behind three ports; web adapters
now, native adapters later.

```
core: sharedUrl → classifyRedditLink → readPost(courier) → regiftVideo(courier, muxer)
                    │ share  → NeedsBrowserError        (open it; share from the browser menu)
                    │ post   → courier.canRead? no → CourierBlockedError (the assisted paste)
                    │ video  → straight to the tracks
web:  Courier = fetch (v.redd.it only) · Muxer = ffmpeg.wasm, vendored same-origin ·
      ShareOut = navigator.share({files}) with a download fallback
```

Phases, each leaving the gate green:

1. **Chassis + core (done).** Copy the croft-pwa chassis; write the core RED-first against
   fixtures (a captured manifest, shaped listings); ports; pipeline.
2. **Web adapters + page (done).** fetch courier, ffmpeg muxer, share-out; the page's three
   unresolvable states rendered as words + one action each.
3. **Gate (done).** Unit 61; e2e: the real mux from the share-target query to a downloaded
   file with `vide` + `soun`; the assisted paste path; the `/s/` hand-off; no-video; CSP,
   mobile-fit (element geometry), subpath, a11y both themes incl. the assisted state.
4. **Ship.** Create `CroftCommunity/regift`, Pages from `gh-pages`, PR, land.
5. **Device (owed).** Install on the Pixel from Pages; share a post from the mobile web;
   Photos receives a clip with sound. Then the large-input measurement (TODO §2). [device done 2026-08-30: Pixel, Chrome WebAPK; a Brave install never appeared in the share sheet; sharing the post from Chrome's ⋮ menu to regift produced the video — owner: "worked well". Large-input measurement still open (TODO §2)]

## Reasoning

**Why a PWA can do this at all** — the surprising measurement is that the *bytes* are
CORS-open and unsigned; only the metadata read is walled. So the wall is one narrow read,
and a person's own browser is allowed through it. Designing the courier as a port with
`canRead` lets that one read be the only thing that changes per shell.

**Why the assisted step and not a relay** — a relay is a server (against the workspace's
backendless decision) *and* its TLS fingerprint is exactly what Reddit 403s. The
copy-and-paste is ugly and honest; it never breaks in the way impersonation does.

**Why no publisher** — the Viddit screenshots showed the product: download, then the OS
share sheet; Photos and Bluesky do their own upload. That removed OAuth, the video-upload
API, attribution facets and a hosted client-metadata from v1 in one stroke, and made the
output target-agnostic for free.

**Why ffmpeg.wasm and not a hand-written muxer, for now** — proven, and the SW caches the
31 MB core after one download. The pure-JS fMP4 join is TODO §4, to be measured, not assumed.

**Why the `/s/` link is handed back** — the redirect is opaque to a page and suffixing
`.json` lands on the wrong document (measured). The owner uses the mobile web page, whose
*browser* share gives the canonical URL directly; the words on the page say to use that.

## Not in this run

Any extension or native shell; Facebook; a quality picker; trim; a Bluesky publisher.
