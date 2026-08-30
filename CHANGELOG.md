# Changelog — regift

What changed for someone who installs and uses regift. It deploys from `main` (Pages), so
landing *is* releasing: sections are months, each entry dated by its landing. Per
`CroftC/.claude/CHANGELOGS.md`, the branch that changes something a user runs adds its
entry here before it lands.

## 2026-08

- 2026-08-30 **first slice:** share a Reddit post (or paste its link) into regift, get a
  muxed MP4 with sound out through the Android share sheet or as a download. Reads the post
  through one assisted copy-and-paste (a page cannot read reddit.com; your browser can),
  fetches the video and audio tracks from v.redd.it in the page, joins them on-device with
  ffmpeg.wasm (stream copy, no re-encode). Croft chassis: installable PWA with a Web Share
  Target, offline shell, light/dark, CSP+SRI. (plans/2026-08-30-plan-regift-slice.md)
