// A span cut out of a video, and the plan for turning it into a GIF. Pure
// numbers: the page owns the slider and the <video>, the Clipper port does the
// encode; this file decides what the two handles may do and how big a GIF
// should be allowed to get.

/** Seconds from the start of the video. */
export interface Clip {
  readonly start: number;
  readonly end: number;
}

/** The handles never cross: a clip is at least this long (seconds). */
export const MIN_CLIP = 0.2;

export const wholeClip = (duration: number): Clip => ({ start: 0, end: duration });

export const clipLength = (clip: Clip): number => clip.end - clip.start;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** The start handle: anywhere from 0 up to MIN_CLIP short of the end. */
export function moveStart(clip: Clip, t: number): Clip {
  if (!Number.isFinite(t)) return clip;
  return { start: clamp(t, 0, Math.max(0, clip.end - MIN_CLIP)), end: clip.end };
}

/** The end handle: anywhere from MIN_CLIP past the start up to the duration. */
export function moveEnd(clip: Clip, t: number, duration: number): Clip {
  if (!Number.isFinite(t)) return clip;
  return { start: clip.start, end: clamp(t, Math.min(duration, clip.start + MIN_CLIP), duration) };
}

/**
 * A typed start, which may land anywhere: a start past the end carries the end
 * along (a box is not a handle, so there is nothing to bump into).
 */
export function setStart(clip: Clip, t: number, duration: number): Clip {
  if (!Number.isFinite(t)) return clip;
  const start = clamp(t, 0, Math.max(0, duration - MIN_CLIP));
  return { start, end: Math.min(duration, Math.max(clip.end, start + MIN_CLIP)) };
}

/** A typed end: an end before the start carries the start back. */
export function setEnd(clip: Clip, t: number, duration: number): Clip {
  if (!Number.isFinite(t)) return clip;
  const end = clamp(t, Math.min(duration, MIN_CLIP), duration);
  return { start: Math.max(0, Math.min(clip.start, end - MIN_CLIP)), end };
}

/** The part of the video the slider spans: the whole of it, or zoomed to the clip. */
export interface Span {
  readonly lo: number;
  readonly hi: number;
}

/** Room either side of a zoomed clip: a share of its length, never under this (seconds). */
const ZOOM_PAD_SHARE = 0.15;
const ZOOM_PAD_MIN = 2;

/**
 * Zoom: the slider spans the clip plus a margin, so on a long video a few
 * seconds become a visible distance (78 s of 58 min is 2% of the rail whole,
 * about 77% zoomed). Fixed when asked for, never live: a scale that moved
 * under a dragging finger would be worse than a coarse one.
 */
export function zoomWindow(clip: Clip, duration: number): Span {
  const pad = Math.max(ZOOM_PAD_MIN, clipLength(clip) * ZOOM_PAD_SHARE);
  // On tenths, so the slider's 0.1 steps land on the tenths the readout shows.
  const lo = Math.floor((clip.start - pad) * 10 + 1e-9) / 10;
  const hi = Math.ceil((clip.end + pad) * 10 - 1e-9) / 10;
  return { lo: Math.max(0, lo), hi: Math.min(duration, hi) };
}

const SECONDS = /^(\d+([.,]\d*)?|[.,]\d+)$/;
const WHOLE = /^\d+$/;

/**
 * What a person types in a time box: `83.4`, `1:23.4` or `1:02:03.5`, with a
 * comma allowed as the decimal mark. Rounded to the tenth formatTime shows;
 * null for anything else (an empty box, `1:75`, a negative).
 */
export function parseTime(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length > 3) return null;
  const secs = parts.pop() ?? '';
  if (!SECONDS.test(secs) || !parts.every((p) => WHOLE.test(p))) return null;
  const s = Number(secs.replace(',', '.'));
  const units = parts.map(Number);
  const m = units.pop() ?? 0;
  const h = units.pop() ?? 0;
  if (parts.length > 0 && s >= 60) return null;
  if (parts.length === 2 && m >= 60) return null;
  return Math.round((h * 3600 + m * 60 + s) * 10) / 10;
}

/** `m:ss.t` — a tenth is the slider's step, so that is the precision shown. */
export function formatTime(seconds: number): string {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/**
 * How many pixels × frames a GIF may carry. Measured 2026-10-02 on a real 360×640
 * Reddit reel (system ffmpeg, the same palettegen/paletteuse graph the adapter
 * runs): about 0.5 bytes per pixel-frame — 24 s at 270×480, 10 fps came to 15 MB.
 * So this budget is roughly a 10 MB GIF; busier footage runs larger.
 */
export const GIF_PIXEL_FRAME_BUDGET = 20_000_000;
/** The long side of a GIF: at most this (never upscaled), never squeezed below the floor. */
const GIF_LONG_SIDE = 480;
const GIF_LONG_SIDE_FLOOR = 240;

export interface GifPlan {
  readonly fps: number;
  readonly width: number;
  readonly height: number;
}

const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2);

/**
 * Frame rate falls with length first (15 → 12 → 10 fps), then the size shrinks
 * until the clip fits the pixel-frame budget, down to a floor. An unknown source
 * size (0×0, metadata not read) is planned as a square at the cap.
 */
export function gifPlan(source: { readonly width: number; readonly height: number }, length: number): GifPlan {
  const fps = length <= 6 ? 15 : length <= 12 ? 12 : 10;
  const w0 = source.width > 0 ? source.width : GIF_LONG_SIDE;
  const h0 = source.height > 0 ? source.height : GIF_LONG_SIDE;
  const long0 = Math.max(w0, h0);
  let scale = Math.min(1, GIF_LONG_SIDE / long0);
  const frames = fps * Math.max(length, MIN_CLIP);
  const pixels = w0 * scale * (h0 * scale);
  if (pixels * frames > GIF_PIXEL_FRAME_BUDGET) scale *= Math.sqrt(GIF_PIXEL_FRAME_BUDGET / (pixels * frames));
  scale = Math.max(scale, Math.min(1, GIF_LONG_SIDE_FLOOR / long0));
  // A source already at its own size keeps its exact (possibly odd) dimensions.
  if (scale >= 1) return { fps, width: w0, height: h0 };
  return { fps, width: even(w0 * scale), height: even(h0 * scale) };
}

/** `name-3.0s-8.5s.gif`: the span is in the name, so two cuts never collide. */
export function clipFilename(name: string, clip: Clip, ext: 'mp4' | 'gif'): string {
  const base = name.replace(/\.[a-z0-9]{2,4}$/i, '');
  return `${base}-${clip.start.toFixed(1)}s-${clip.end.toFixed(1)}s.${ext}`;
}
