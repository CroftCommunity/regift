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
