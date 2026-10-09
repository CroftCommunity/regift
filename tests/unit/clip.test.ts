import { describe, it, expect } from 'vitest';
import { clipFilename, clipLength, formatTime, gifPlan, GIF_PIXEL_FRAME_BUDGET, MIN_CLIP, moveEnd, moveStart, parseTime, setEnd, setStart, wholeClip } from '../../src/core/clip';

describe('the two handles', () => {
  const whole = wholeClip(24);

  it('a fresh clip is the whole video', () => {
    expect(whole).toEqual({ start: 0, end: 24 });
    expect(clipLength(whole)).toBe(24);
  });

  it('the start handle moves freely below the end', () => {
    expect(moveStart(whole, 8.25)).toEqual({ start: 8.25, end: 24 });
  });

  it('the start handle stops a minimum length short of the end, and never goes below zero', () => {
    const c = { start: 0, end: 10 };
    expect(moveStart(c, 12)).toEqual({ start: 10 - MIN_CLIP, end: 10 });
    expect(moveStart(c, -3)).toEqual({ start: 0, end: 10 });
  });

  it('the end handle stops a minimum length past the start, and never passes the duration', () => {
    const c = { start: 5, end: 10 };
    expect(moveEnd(c, 2, 24)).toEqual({ start: 5, end: 5 + MIN_CLIP });
    expect(moveEnd(c, 30, 24)).toEqual({ start: 5, end: 24 });
  });

  it('a non-number from a slider leaves the clip as it was', () => {
    const c = { start: 5, end: 10 };
    expect(moveStart(c, Number.NaN)).toEqual(c);
    expect(moveEnd(c, Number.NaN, 24)).toEqual(c);
  });
});

describe('a time typed in a box', () => {
  it('reads seconds, m:ss and h:mm:ss, to the tenth', () => {
    expect(parseTime('83')).toBe(83);
    expect(parseTime('83.44')).toBe(83.4);
    expect(parseTime('1:23.4')).toBe(83.4);
    expect(parseTime('0:05')).toBe(5);
    expect(parseTime('1:02:03.5')).toBe(3723.5);
    expect(parseTime('  2:00 ')).toBe(120);
  });

  it('takes a comma as the decimal mark, and reads what formatTime writes', () => {
    expect(parseTime('1:23,4')).toBe(83.4);
    expect(parseTime(formatTime(62.06))).toBe(62.1);
  });

  it('refuses what is not a time', () => {
    for (const bad of ['', 'abc', '1:', ':30', '1:75', '-3', '1:2:3:4', '1.2.3']) expect(parseTime(bad), bad).toBeNull();
  });
});

describe('a typed start or end', () => {
  const c = { start: 10, end: 15 };

  it('a start past the end carries the end along, to the duration at most', () => {
    expect(setStart(c, 40, 60)).toEqual({ start: 40, end: 40 + MIN_CLIP });
    expect(setStart(c, 12, 60)).toEqual({ start: 12, end: 15 });
    expect(setStart(c, 99, 60)).toEqual({ start: 60 - MIN_CLIP, end: 60 });
    expect(setStart(c, -1, 60)).toEqual({ start: 0, end: 15 });
  });

  it('an end before the start carries the start back, to zero at least', () => {
    expect(setEnd(c, 4, 60)).toEqual({ start: 4 - MIN_CLIP, end: 4 });
    expect(setEnd(c, 30, 60)).toEqual({ start: 10, end: 30 });
    expect(setEnd(c, 99, 60)).toEqual({ start: 10, end: 60 });
    expect(setEnd(c, 0, 60)).toEqual({ start: 0, end: MIN_CLIP });
  });

  it('a non-number leaves the clip as it was', () => {
    expect(setStart(c, Number.NaN, 60)).toEqual(c);
    expect(setEnd(c, Number.NaN, 60)).toEqual(c);
  });
});

describe('formatTime', () => {
  it('reads as minutes, seconds and a tenth', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(3.44)).toBe('0:03.4');
    expect(formatTime(62.06)).toBe('1:02.1');
    expect(formatTime(59.97)).toBe('1:00.0');
  });
});

describe('gifPlan — a GIF is big, so the plan holds it near a size budget', () => {
  it('a short clip keeps the frame rate and the source size up to the cap', () => {
    // The example reel: 360×640 portrait.
    expect(gifPlan({ width: 360, height: 640 }, 3)).toEqual({ fps: 15, width: 270, height: 480 });
  });

  it('never upscales a small source', () => {
    expect(gifPlan({ width: 90, height: 160 }, 1)).toEqual({ fps: 15, width: 90, height: 160 });
  });

  it('a long clip drops the frame rate, then the size, to stay inside the pixel-frame budget', () => {
    const p = gifPlan({ width: 360, height: 640 }, 24);
    expect(p.fps).toBe(10);
    expect(p.width * p.height * p.fps * 24).toBeLessThanOrEqual(GIF_PIXEL_FRAME_BUDGET);
    expect(p.height).toBeGreaterThan(p.width);
    expect(p.width % 2 + (p.height % 2)).toBe(0);
  });

  it('a landscape source caps the long side, which is the width', () => {
    expect(gifPlan({ width: 1920, height: 1080 }, 4)).toEqual({ fps: 15, width: 480, height: 270 });
  });

  it('a very long clip bottoms out at a floor rather than a postage stamp', () => {
    const p = gifPlan({ width: 1920, height: 1080 }, 600);
    expect(p.width).toBe(240);
  });

  it('an unknown source size (0×0) still yields a usable plan', () => {
    expect(gifPlan({ width: 0, height: 0 }, 3)).toEqual({ fps: 15, width: 480, height: 480 });
  });
});

describe('clipFilename', () => {
  it('names the span and swaps the extension', () => {
    expect(clipFilename('regift-abc123.mp4', { start: 3.04, end: 8.5 }, 'gif')).toBe('regift-abc123-3.0s-8.5s.gif');
    expect(clipFilename('holiday', { start: 0, end: 2 }, 'mp4')).toBe('holiday-0.0s-2.0s.mp4');
  });
});
