# Changelog — regift

What changed for someone who installs and uses regift. It deploys from `main` (Pages), so
landing *is* releasing: sections are months, each entry dated by its landing. Per
`CroftC/.claude/CHANGELOGS.md`, the branch that changes something a user runs adds its
entry here before it lands.

## 2026-09

- 2026-09-16 **Reddit pictures get in — share the picture, not the link:** regift now
  receives the FILE itself from the share sheet, not only a link. Open a picture in Reddit,
  tap Share, pick regift, and it comes across with nothing fetched and nothing leaving your
  device; share the post link alongside it and the credit still rides inside the file. This
  is the only route there is: re-measured 2026-09-16, `i.redd.it` (and `preview.redd.it`,
  `external-preview.redd.it`) send no CORS header at all, while `v.redd.it` sends `*` —
  Reddit's own player needs CORS for video and never needed it for pictures — so no page
  anywhere can fetch a Reddit picture, and the page now says so and points at the share
  route instead of promising an app. Video, galleries and the other sources are unchanged.
  **One-off:** this ships a new share target, which only the updated service worker knows;
  until you tap **Update** (or reopen regift), a file share can arrive before the worker
  does and be lost. Sharing it again after the update works.
- 2026-09-13 **older Reddit videos:** a video posted in 2019 or earlier failed with "no video
  representation" — its manifest has the same tracks under an older shape (the kind on each
  representation, bare `DASH_720` / `audio` names), which the parser now reads; the tracks
  answer unsigned and CORS-open like current ones. Also, sharing from a feed can send the
  subreddit's address instead of the post's; regift now says that is a reddit.com link but
  not a post, rather than "not a reddit post or video link".

## 2026-08

- 2026-08-30 **the credit rides inside the file:** images carry it as EXIF (JPEG, WebP),
  iTXt (PNG) or a comment block (GIF), and videos carry it in the MP4 container tags —
  visible in Google Photos' info panel. Social platforms strip metadata on upload, so the
  visible credit on a repost still comes from Copy credit. A tagging failure never costs
  the file; you get the untagged bytes.
- 2026-08-30 **Reddit pictures:** an image post or a gallery comes out as its original
  files from i.redd.it, in gallery order — *if* Reddit's image host lets a page read it,
  which was not confirmed when this shipped; if it refuses, regift says so and that
  pictures from Reddit need the app. Video is unchanged. *Confirmed same day, on the
  Pixel and from a second network: i.redd.it refuses a page (CORS), so the words are
  what ships until the app.*
- 2026-08-30 **three more sources:** share a **Bluesky** post (video or images — the
  original files, straight from the PDS), a **Mastodon** status (its attachments), or a
  **Tumblr** post (photos, inline images and Tumblr-hosted video) into regift and get the
  files out; several files share together. A Tumblr post that embeds YouTube is refused by
  name. **Pixelfed** links are recognised and refused with the reason (the instance shows
  posts only to signed-in members). The credit line speaks each platform's dialect
  (`@handle on Bluesky`, `@user@instance`). (plans/2026-08-30-plan-sources.md)
- 2026-08-30 **install from Chrome:** the page and README now say so — only a Chrome-minted
  WebAPK registers a share target; Brave/Firefox/Samsung add a shortcut that never appears
  in the share sheet (the first device install was from Brave, and regift was not offered).
  The manifest also carries 192/512 PNG icons (any + maskable), which Chrome documents for
  WebAPK minting, and the share target declares its enctype. A **Start over** button
  purges a try in progress in one tap, and the words for a link from Reddit's share
  button now say the one habit that removes the step: share from Chrome's ⋮ menu instead.
- 2026-08-30 **no more select-all:** regift reads a post by itself (JSONP, with your
  browser's own Reddit cookies) — share the post in, get the video out, no paste. When
  that is refused (signed out, third-party cookies blocked), the assisted step now leads
  with the quickest route — open on old Reddit, long-press the title, Share link to regift
  — and accepts post data shared as text, not only pasted. Also: a quality choice (best /
  ≤720p / ≤480p), a **Copy credit** line for the post you make next, and an install tip
  when running in a browser tab. (plans/2026-08-30-plan-regift-slice.md; TODO §1 records
  the app decision — hidden-WebView courier first)
- 2026-08-30 **first slice:** share a Reddit post (or paste its link) into regift, get a
  muxed MP4 with sound out through the Android share sheet or as a download. Reads the post
  through one assisted copy-and-paste (a page cannot read reddit.com; your browser can),
  fetches the video and audio tracks from v.redd.it in the page, joins them on-device with
  ffmpeg.wasm (stream copy, no re-encode). Croft chassis: installable PWA with a Web Share
  Target, offline shell, light/dark, CSP+SRI. (plans/2026-08-30-plan-regift-slice.md)
