# Plan: more sources — Bluesky, Mastodon, Tumblr (and why not Pixelfed yet)

date: 2026-08-30
identity: chasemp (`chase@owasp.org`, `github-personal`), repo `CroftCommunity/regift`
Status: **built and gated (2026-08-30)** on `claude/sources`; Pixelfed refused with its reason
pending a full gram.social post link to probe the ActivityPub note endpoint.

## Problem Statement

regift reads one source. The owner asked for Bluesky, Mastodon, gram.social (Pixelfed) and
Tumblr, "all TDD". Each must fit the existing shape — a share arrives, media comes out
through the share sheet — without a server and without weakening what the Reddit path
proved.

## What was measured before designing (2026-08-30, `Origin: https://croftcommunity.github.io`)

| Source | Read | Bytes | Verdict |
|---|---|---|---|
| Bluesky | `public.api.bsky.app` getPostThread, resolveHandle; `plc.directory` — all `200, ACAO *` | PDS `com.atproto.sync.getBlob` `200, ACAO *`, the ORIGINAL upload (4.75 MB mp4); `cdn.bsky.app` sends **no** CORS; `video.bsky.app` HLS `ACAO *` | no mux, no step — blobs from the PDS for video and images alike |
| Mastodon | `/api/v1/statuses/:id` `200, ACAO *` (mastodon.social) | `files.mastodon.social` `200, ACAO *` | trivial |
| Tumblr | v2 API `401` without a key; **legacy** `<blog>.tumblr.com/api/read/json?id=` `200` as JavaScript (`var tumblr_api_read = {…}`), no ACAO — a `<script>` reads it from any origin, no cookies | `64.media.tumblr.com` and `va.media.tumblr.com` `200, ACAO *` | the same trick as Reddit's JSONP, minus the cookie dependency |
| Pixelfed | `accounts/lookup` `200, ACAO *`; `statuses`, `accounts/:id/statuses`, public timeline all `302 → /login` on gram.social AND pixelfed.social; AP outbox empty | — | a courier problem, not a CORS problem; refused with the reason |
| (Bluesky limit) | 10 min / 300 MB since 2026-08-26 | | regift never publishes; nothing to change |

Tumblr post shapes seen: `photo` (`photos[]` with `photo-url-*`), `regular` with inline
`<img srcset>` / `<video><source>` in the body (the owner's example is one image with a
seven-size srcset), `video` whose player is a YouTube embed (refused by name — the no-YouTube
rule).

## Approach

```
classifyLink(url) ─┬─ reddit   → readPost (JSONP / assisted)  → fromReddit   ┐
                   ├─ bluesky  → readBluesky (AppView → PDS blob URLs)        ├→ Post { items[] }
                   ├─ mastodon → readMastodon (statuses/:id)                  │
                   ├─ tumblr   → readTumblr (legacy JS read via script tag)   ┘
                   └─ pixelfed → NeedsSignInError
page: for each item — `file` → courier.bytes → File; `reddit-video` → regiftVideo (mux)
      previews per file · Share all · Save each · Copy credit
```

Web layer: `fetchCourier.canRead` is now "any host that is not reddit.com"; the composed
web courier adds a script-tag read for `*.tumblr.com/api/read/json`; CSP `connect-src`
becomes `'self' https:` (recorded in `build.mjs` with the why), `script-src` adds
`https://*.tumblr.com`; `img-src` adds `blob:` for previews.

## Reasoning

**Why the PDS blob and not the CDN or HLS for Bluesky** — the CDN sends no CORS; HLS would
need segment joining; the blob is the original file, CORS-open, and needs nothing. Images
come from the PDS for the same reason.

**Why `connect-src https:`** — the app's purpose is to fetch media from hosts the person
chose, which cannot be enumerated (any Mastodon instance, any PDS). The bytes become a File;
nothing is executed. The tight directive is `script-src`, which names exactly two legacy-read
origins. Both halves are in the same comment in `build.mjs` so they cannot drift apart.

**Why Pixelfed is refused rather than attempted** — measured on two instances, the read
endpoints demand a session. Attempting and failing would look like a bug; naming the reason
is the honest state until the ActivityPub note endpoint is probed with a real post id.

**Why one `Post` shape with `items[]`** — galleries (Tumblr photosets, Mastodon's four
attachments, Bluesky's four images) are the common case for images, and the share sheet
takes several files at once. Reddit's video keeps its own item kind because it alone needs
the mux.

## Not in this run

Pixelfed reading; Bluesky quote-posts' nested media beyond `recordWithMedia`; Mastodon
remote-instance CORS exceptions; Tumblr custom-domain blogs (their legacy endpoint is on the
custom domain, outside `script-src`).
