import { describe, it, expect } from 'vitest';
import { fetchCourier } from '../../src/adapters/web/fetch-courier';

// `canRead` is the seam the core routes on: a host that sends no CORS header is
// declined up front, so the core throws CourierBlockedError instead of letting a
// fetch fail. Measured 2026-08-30 (reddit.com) and 2026-09-23 (instagram.com).
describe('fetchCourier.canRead', () => {
  it('declines the hosts that send no CORS header', () => {
    expect(fetchCourier.canRead('https://www.reddit.com/r/a/comments/1abc/t/.json')).toBe(false);
    expect(fetchCourier.canRead('https://www.instagram.com/p/DdFoiaxEw6H/embed/captioned/')).toBe(false);
    expect(fetchCourier.canRead('https://instagram.com/reels/DdFoiaxEw6H/')).toBe(false);
  });

  it('reads the media CDNs that do', () => {
    expect(fetchCourier.canRead('https://v.redd.it/abc/DASHPlaylist.mpd')).toBe(true);
    expect(fetchCourier.canRead('https://instagram.fmkc1-1.fna.fbcdn.net/o1/v/t2/f2/m86/x.mp4?oh=1')).toBe(true);
    expect(fetchCourier.canRead('https://scontent.cdninstagram.com/v/t51.82787-19/x.jpg')).toBe(true);
  });
});
