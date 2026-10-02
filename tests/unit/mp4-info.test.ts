import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mp4Info } from '../../src/core/mp4-info';

const media = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../fixtures/media/${name}`, import.meta.url)));

/** A copy with the 32-bit field after `box`'s type at `offset` overwritten. */
function patch(bytes: Uint8Array, box: string, offset: number, value: number): Uint8Array {
  const out = new Uint8Array(bytes);
  const at = Buffer.from(out).indexOf(box, 0, 'latin1') + 4 + offset;
  new DataView(out.buffer).setInt32(at, value);
  return out;
}

describe('mp4Info — the length and size come from the container, not from a decoder', () => {
  it('a fragmented track (the CMAF shape Reddit serves; mvhd says 0) is summed from its fragments', () => {
    expect(mp4Info(media('video.mp4'))).toEqual({ duration: 2, width: 90, height: 160 });
  });

  it('a plain mp4 takes the duration moov states', () => {
    // mvhd v0: timescale at +12, duration at +16 (timescale is 1000 in the fixture).
    expect(mp4Info(patch(media('video.mp4'), 'mvhd', 16, 24_107))).toEqual({ duration: 24.107, width: 90, height: 160 });
  });

  it('a phone video stored sideways (rotation matrix 90°) reports the size it is shown at', () => {
    // tkhd v0 matrix starts at +40: a=0, b=1.0 (16.16), c=-1.0 is a 90° turn.
    let rotated = patch(media('video.mp4'), 'tkhd', 40, 0);
    rotated = patch(rotated, 'tkhd', 44, 0x10000);
    rotated = patch(rotated, 'tkhd', 52, -0x10000);
    rotated = patch(rotated, 'tkhd', 56, 0);
    expect(mp4Info(rotated)).toEqual({ duration: 2, width: 160, height: 90 });
  });

  it('a file with no video track is not a video', () => {
    expect(mp4Info(media('audio.mp4'))).toBeNull();
  });

  it('bytes that are not an mp4 are refused, not misread', () => {
    expect(mp4Info(new TextEncoder().encode('GIF89a not a video at all'))).toBeNull();
    expect(mp4Info(new Uint8Array(0))).toBeNull();
  });
});
