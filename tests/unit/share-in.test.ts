import { describe, it, expect } from 'vitest';
import { sharedUrl } from '../../src/core/share-in';

// What the Android share sheet hands a Web Share Target. Measured 2026-08-30:
// Reddit's mobile web share button calls navigator.share({ url }) with only the
// /s/ link; other apps put the link in `text` (often with words around it).
describe('sharedUrl: the one URL out of a share payload', () => {
  it('prefers the url field when it is a URL', () => {
    expect(sharedUrl({ url: 'https://www.reddit.com/r/x/s/AbC', text: 'ignored' })).toBe(
      'https://www.reddit.com/r/x/s/AbC',
    );
  });

  it('falls back to the first URL inside text', () => {
    expect(sharedUrl({ text: 'look at this https://www.reddit.com/r/x/comments/1abc/t/ lol' })).toBe(
      'https://www.reddit.com/r/x/comments/1abc/t/',
    );
  });

  it('then the title', () => {
    expect(sharedUrl({ title: 'https://v.redd.it/abc123' })).toBe('https://v.redd.it/abc123');
  });

  it('returns null when nothing shared is a URL', () => {
    expect(sharedUrl({ url: 'not a url', text: 'nor this', title: null })).toBeNull();
    expect(sharedUrl({})).toBeNull();
  });

  it('ignores non-http schemes', () => {
    expect(sharedUrl({ url: 'javascript:alert(1)', text: 'ftp://x/y' })).toBeNull();
  });
});
