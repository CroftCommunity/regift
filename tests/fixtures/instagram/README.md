# Instagram fixtures

`reel-embed-captioned.html` — real bytes cut (by a script, not by hand) from a capture of
`https://www.instagram.com/p/DdFoiaxEw6H/embed/captioned/`, 2026-09-23, headless
Chromium with a mobile Chrome UA and no cookies. Kept: the visible embed markup (header,
username, caption) and the `<script>` window around `"contextJSON":"…"` — the JSON-encoded
string whose `gql_data.shortcode_media` names the post (`__typename` `GraphVideo`,
`video_url`, `display_url`, `owner.username`, `edge_media_to_caption`). The ~100 KB page
bootstrap around it is elided with a comment. The signed CDN URLs inside expire; the parser
only reads their shape.

Measured the same day: `www.instagram.com` sends no `access-control-allow-origin` on any of
the post page, `/embed/` or `/embed/captioned/` (and a non-browser TLS client gets a bare
shell with no data), while the media CDN (`instagram.f*.fna.fbcdn.net`,
`scontent.cdninstagram.com`) sends `*` and answers an OPTIONS preflight on the mp4.
