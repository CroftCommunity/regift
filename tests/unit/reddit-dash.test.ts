import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDashManifest, pickTracks, manifestUrl, trackUrl, DashParseError } from '../../src/core/reddit/dash';

// A real manifest, captured 2026-08-30 from v.redd.it (unsigned URL, 200, CORS-open).
const mpd = readFileSync(new URL('../fixtures/reddit/dash-manifest.mpd', import.meta.url), 'utf8');

describe('parseDashManifest', () => {
  it('lists every video and audio representation with its file name', () => {
    const tracks = parseDashManifest(mpd);
    expect(tracks.filter((t) => t.kind === 'video').map((t) => [t.file, t.height])).toEqual([
      ['CMAF_220.mp4', 392],
      ['CMAF_270.mp4', 480],
      ['CMAF_360.mp4', 640],
      ['CMAF_480.mp4', 854],
      ['CMAF_720.mp4', 1280],
    ]);
    expect(tracks.filter((t) => t.kind === 'audio').map((t) => [t.file, t.bandwidth])).toEqual([
      ['CMAF_AUDIO_64.mp4', 67461],
      ['CMAF_AUDIO_128.mp4', 131422],
    ]);
  });

  it('fails loud when there is no video representation', () => {
    expect(() => parseDashManifest('<MPD></MPD>')).toThrow(DashParseError);
    expect(() => parseDashManifest('Blocked')).toThrow(DashParseError);
  });
});

describe('pickTracks', () => {
  const tracks = parseDashManifest(mpd);

  it('takes the best video within the height cap and the best audio', () => {
    const picked = pickTracks(tracks, { maxHeight: 854 });
    expect(picked.video.file).toBe('CMAF_480.mp4');
    expect(picked.audio?.file).toBe('CMAF_AUDIO_128.mp4');
  });

  it('takes the best video overall when no cap is given', () => {
    expect(pickTracks(tracks).video.file).toBe('CMAF_720.mp4');
  });

  it('falls back to the smallest video when every one is over the cap', () => {
    expect(pickTracks(tracks, { maxHeight: 100 }).video.file).toBe('CMAF_220.mp4');
  });

  it('reports no audio when the manifest has none', () => {
    const silent = tracks.filter((t) => t.kind === 'video');
    expect(pickTracks(silent).audio).toBeNull();
  });
});

describe('track URLs', () => {
  it('are built on the unsigned v.redd.it path (measured: 200 without a signature)', () => {
    expect(manifestUrl('blke7z3ttolh1')).toBe('https://v.redd.it/blke7z3ttolh1/DASHPlaylist.mpd');
    expect(trackUrl('blke7z3ttolh1', 'CMAF_AUDIO_128.mp4')).toBe('https://v.redd.it/blke7z3ttolh1/CMAF_AUDIO_128.mp4');
  });
});
